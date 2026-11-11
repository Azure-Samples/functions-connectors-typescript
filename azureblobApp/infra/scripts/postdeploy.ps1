# Post-deployment configuration for the azureblobApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Configure the Azure Blob connection with the namespace's managed identity.
#   2. Create one Connector Namespace trigger config per Functions trigger,
#      each POSTing to the function's connector webhook URL with the
#      provisioned test container as the trigger's `folderId`.

$ErrorActionPreference = 'Stop'

Write-Host "Post-deployment configuration..." -ForegroundColor Yellow

# --- Read azd outputs --------------------------------------------------------
$outputs = azd env get-values --output json | ConvertFrom-Json

$resourceGroupName        = $outputs.resourceGroupName
$connectorNamespaceName   = $outputs.connectorNamespaceName
$azureblobConnectionName  = $outputs.azureblobConnectionName
$functionAppName          = $outputs.functionAppName
$namespaceLocation        = $outputs.CONNECTOR_NAMESPACE_LOCATION
$namespacePrincipalId     = $outputs.connectorNamespacePrincipalId
$accountInput             = $outputs.monitoredStorageAccountName
$containerInput           = $outputs.monitoredContainerName
$functionAppPrincipalId   = $outputs.functionAppPrincipalId
$userPrincipalId          = $outputs.AZURE_PRINCIPAL_ID
$tenantId                 = az account show --query tenantId -o tsv

if (-not $resourceGroupName -or -not $connectorNamespaceName -or -not $azureblobConnectionName -or -not $functionAppName -or -not $namespaceLocation -or -not $namespacePrincipalId -or -not $accountInput -or -not $containerInput) {
    Write-Host "ERROR: required azd outputs missing. Run 'azd provision' first." -ForegroundColor Red
    exit 1
}

$subscriptionId = az account show --query id -o tsv

# --- Verify the connector-namespace az CLI extension is installed ----------
$extInstalled = az extension show --name connector-namespace --query name -o tsv 2>$null
if (-not $extInstalled) {
    Write-Host "ERROR: 'connector-namespace' Azure CLI extension is not installed." -ForegroundColor Red
    Write-Host "       Download the latest 'connector_namespace-*.whl' from" -ForegroundColor Red
    Write-Host "       https://github.com/Azure/Connectors/releases and run:" -ForegroundColor Red
    Write-Host "         az extension add --source <wheel-url-or-path>" -ForegroundColor Red
    Write-Host "       Then re-run: azd hooks run postup" -ForegroundColor Red
    exit 2
}

function Set-ConnectionManagedIdentityAuth {
    $url = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Web/connectorGateways/$connectorNamespaceName/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    $body = @{
        location   = $namespaceLocation
        properties = @{
            connectorName     = 'azureblob'
            parameterValueSet = @{
                name   = 'managedIdentityAuth'
                values = @{}
            }
            connectionProperties = @{
                authentication = @{ type = 'ManagedServiceIdentity' }
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress

    $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) ("conn-" + [guid]::NewGuid().ToString() + ".json")
    Set-Content -Path $bodyFile -Value $body -Encoding utf8
    try {
        az rest --method put --url $url --body "@$bodyFile" -o none
        return ($LASTEXITCODE -eq 0)
    } finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
}

function Wait-ConnectionReady {
    param([int] $TimeoutSeconds = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastStatus = ""
    while ((Get-Date) -lt $deadline) {
        $s = az connector-namespace connection show `
            -g $resourceGroupName --namespace $connectorNamespaceName `
            -n $azureblobConnectionName --query "properties.overallStatus" -o tsv 2>$null
        if ($s -ne $lastStatus) {
            Write-Host "   status: $(if ($s) { $s } else { '?' })" -ForegroundColor Cyan
            $lastStatus = $s
        }
        $sLower = if ($s) { $s.ToLower() } else { "" }
        if ($sLower -eq "connected") { return "Connected" }
        if ($sLower -eq "ready") { return "Ready" }
        if ($sLower -eq "error") { return "Error" }
        Start-Sleep -Seconds 3
    }
    return $lastStatus
}

function Show-ConnectionError {
    $url = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Web/connectorGateways/$connectorNamespaceName/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    $raw = az rest --method get --url $url -o json 2>$null
    if (-not $raw) {
        Write-Host "   (failed to fetch connection resource for diagnostics)" -ForegroundColor DarkRed
        return
    }
    try {
        $conn = $raw | ConvertFrom-Json
    } catch {
        Write-Host "   (failed to parse connection JSON)" -ForegroundColor DarkRed
        return
    }

    $printed = $false
    if ($conn.properties.error) {
        Write-Host ("   detail: {0}: {1}" -f $conn.properties.error.code, $conn.properties.error.message) -ForegroundColor Red
        $printed = $true
    }
    foreach ($st in @($conn.properties.statuses)) {
        if ($null -eq $st) { continue }
        if ($st.error) {
            Write-Host ("   detail: {0}: {1}" -f $st.error.code, $st.error.message) -ForegroundColor Red
            $printed = $true
        } elseif ($st.statusReason) {
            Write-Host ("   detail: {0}" -f $st.statusReason) -ForegroundColor Red
            $printed = $true
        } elseif ($st.status -and $st.status -ne 'Error') {
            Write-Host ("   detail: status={0}" -f $st.status) -ForegroundColor Red
            $printed = $true
        }
    }
    if (-not $printed) {
        Write-Host "   (connector did not return a structured error)" -ForegroundColor DarkYellow
    }
}

Write-Host "-> Configuring '$azureblobConnectionName' with the namespace's system-assigned identity..." -ForegroundColor Yellow
if (-not (Set-ConnectionManagedIdentityAuth)) {
    Write-Host "ERROR: failed to update Azure Blob connection (ARM PUT failed)." -ForegroundColor Red
    exit 1
}

$finalStatus = Wait-ConnectionReady -TimeoutSeconds 90
if ($finalStatus -notin @('Connected', 'Ready')) {
    Write-Host "ERROR: managed identity connection status is '$finalStatus'." -ForegroundColor Red
    Show-ConnectionError
    Write-Host "Verify the namespace identity and retry: azd hooks run postup" -ForegroundColor Yellow
    exit 1
}

# --- Create connection access policies --------------------------------------
function Set-ConnectionAccessPolicy {
    param(
        [Parameter(Mandatory)] [string] $PolicyName,
        [Parameter(Mandatory)] [string] $ObjectId
    )
    $url = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Web/connectorGateways/$connectorNamespaceName/connections/$azureblobConnectionName/accessPolicies/${PolicyName}?api-version=2026-05-01-preview"
    $body = @{
        properties = @{
            principal = @{
                type     = 'ActiveDirectory'
                identity = @{ objectId = $ObjectId; tenantId = $tenantId }
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress
    $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) ("ap-" + [guid]::NewGuid().ToString() + ".json")
    Set-Content -Path $bodyFile -Value $body -Encoding utf8
    try {
        az rest --method put --url $url --body "@$bodyFile" -o none
        if ($LASTEXITCODE -ne 0) { throw "Could not grant connection access to $PolicyName." }
    } finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
}

Set-ConnectionAccessPolicy -PolicyName 'namespace-msi' -ObjectId $namespacePrincipalId | Out-Null
if ($functionAppPrincipalId) {
    Write-Host "-> Granting function-app managed identity access to the connection..." -ForegroundColor Cyan
    Set-ConnectionAccessPolicy -PolicyName 'functionapp-msi' -ObjectId $functionAppPrincipalId | Out-Null
}
if ($userPrincipalId) {
    Write-Host "-> Granting deployer user access to the connection..." -ForegroundColor Cyan
    Set-ConnectionAccessPolicy -PolicyName 'dev-user' -ObjectId $userPrincipalId | Out-Null
}

# --- Wire AzureBlobConnection app setting -----------------------------------
$connRuntimeUrl = az rest --method get `
    --url "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Web/connectorGateways/$connectorNamespaceName/connections/${azureblobConnectionName}?api-version=2026-05-01-preview" `
    --query "properties.connectionRuntimeUrl" -o tsv 2>$null
if ($connRuntimeUrl) {
    Write-Host "-> Setting AzureBlobConnection app setting on $functionAppName..." -ForegroundColor Cyan
    az functionapp config appsettings set -g $resourceGroupName -n $functionAppName --settings "AzureBlobConnection=$connRuntimeUrl" -o none
    if ($LASTEXITCODE -ne 0) { throw 'Could not set AzureBlobConnection.' }
} else {
    throw 'Could not fetch connection runtime URL.'
}

# --- Compute folderId for the trigger --------------------------------------
# The azureblob connector encodes the container path as base64 of the
# url-encoded virtual path: '/<container>' -> '%2F<container>' -> base64.
$urlEncodedPath = "%2F$containerInput"
$folderIdBytes  = [System.Text.Encoding]::UTF8.GetBytes($urlEncodedPath)
$folderId       = [Convert]::ToBase64String($folderIdBytes)

Write-Host ""
Write-Host "Container '$containerInput' -> folderId '$folderId'" -ForegroundColor DarkGray

# --- Create Connector Namespace trigger configs -----------------------------
Write-Host ""
Write-Host "Fetching connector extension key for $functionAppName..." -ForegroundColor Cyan
$connectorExtensionKey = (az functionapp keys list -g $resourceGroupName -n $functionAppName --query "systemKeys.connector_extension" -o tsv)
if (-not $connectorExtensionKey) {
    Write-Host "ERROR: could not fetch connector_extension system key from $functionAppName." -ForegroundColor Red
    exit 1
}

$connectionDetails = (@{ connectorName = 'azureblob'; connectionName = $azureblobConnectionName } | ConvertTo-Json -Compress)

# Trigger configs (operationName values from the Azure Blob connector swagger:
# https://learn.microsoft.com/en-us/connectors/azureblob/#triggers).
$triggers = @(
    @{
        functionName  = 'OnAzureBlobUpdatedFile'
        operationName = 'OnUpdatedFiles_V2'
        parameters    = @(
            @{ name = 'dataset';  value = $accountInput }
            @{ name = 'folderId'; value = $folderId }
        )
    }
)

$script:triggerFailures = @()

function New-JsonArgFile {
    param([Parameter(Mandatory)] [string] $Json)
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("trigger-arg-" + [guid]::NewGuid().ToString() + ".json")
    Set-Content -Path $path -Value $Json -Encoding utf8
    return $path
}

foreach ($t in $triggers) {
    $functionName  = $t.functionName
    $operationName = $t.operationName
    $parameters    = ($t.parameters | ConvertTo-Json -Compress -Depth 5 -AsArray)

    $triggerName = "$azureblobConnectionName-$($functionName.ToLower())"
    $callbackUrl = "https://$functionAppName.azurewebsites.net/runtime/webhooks/connector?functionName=$functionName"
    $notificationDetails = (@{
        callbackUrl = $callbackUrl
        httpMethod = 'Post'
        authentication = @{
            type = "QueryString"
            name = "code"
            value = $connectorExtensionKey
        }
    } | ConvertTo-Json -Depth 3 -Compress)

    Write-Host ""
    Write-Host "Creating trigger '$triggerName' for $functionName ($operationName)..." -ForegroundColor Yellow

    az connector-namespace trigger delete `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $triggerName --yes 2>$null | Out-Null

    $connFile   = New-JsonArgFile -Json $connectionDetails
    $paramsFile = New-JsonArgFile -Json $parameters
    $notifFile  = New-JsonArgFile -Json $notificationDetails
    try {
        az connector-namespace trigger create `
            -g $resourceGroupName `
            --namespace $connectorNamespaceName `
            -n $triggerName `
            --connection-details "@$connFile" `
            --operation-name $operationName `
            --parameters "@$paramsFile" `
            --notification-details "@$notifFile" `
            --state 'Enabled' `
            --description "Azure Blob $operationName -> $functionName" `
            -o none
        $triggerExitCode = $LASTEXITCODE
    } finally {
        Remove-Item $connFile, $paramsFile, $notifFile -ErrorAction SilentlyContinue
    }

    if ($triggerExitCode -ne 0) {
        Write-Host "WARNING: Failed to create trigger '$triggerName'." -ForegroundColor Yellow
        $script:triggerFailures += $triggerName
    }
}

Write-Host ""
if ($triggerFailures.Count -eq 0) {
    Write-Host "✅ Connector Namespace trigger configs created successfully." -ForegroundColor Green
} else {
    Write-Host "ERROR: Some trigger configs failed: $($triggerFailures -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Post-deployment configuration complete." -ForegroundColor Green
Write-Host "Upload blobs to '$containerInput' in storage account '$accountInput' to test the trigger."
Write-Host ""
