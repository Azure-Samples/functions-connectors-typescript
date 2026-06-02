# Post-deployment configuration for the azureblobApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Configure the Azure Blob connection with the user's storage account
#      name (or blob endpoint) and access key, so the connector can
#      authenticate to blob storage.
#   2. Create one Connector Namespace trigger config per Functions trigger,
#      each POSTing to the function's connector webhook URL with the
#      selected container as the trigger's `folderId`.
#
# Connection access policies for the function-app MI and the deployer
# user are created by Bicep (infra/connectorNamespace.bicep).

Write-Host "Post-deployment configuration..." -ForegroundColor Yellow

# --- Read azd outputs --------------------------------------------------------
$outputs = azd env get-values --output json | ConvertFrom-Json

$resourceGroupName        = $outputs.resourceGroupName
$connectorNamespaceName   = $outputs.connectorNamespaceName
$azureblobConnectionName  = $outputs.azureblobConnectionName
$functionAppName          = $outputs.functionAppName

if (-not $resourceGroupName -or -not $connectorNamespaceName -or -not $azureblobConnectionName -or -not $functionAppName) {
    Write-Host "ERROR: required azd outputs missing. Run 'azd provision' first." -ForegroundColor Red
    exit 1
}

$subscriptionId = az account show --query id -o tsv

# Persisted across runs (non-secret).
$savedAccount   = $outputs.BLOB_ACCOUNT
$savedContainer = $outputs.BLOB_CONTAINER

# --- Verify the connector-namespace az CLI extension is installed ----------
$extInstalled = az extension show --name connector-namespace --query name -o tsv 2>$null
if (-not $extInstalled) {
    Write-Host "ERROR: 'connector-namespace' Azure CLI extension is not installed." -ForegroundColor Red
    Write-Host "       Download the latest 'connector_namespace-*.whl' from" -ForegroundColor Red
    Write-Host "       https://github.com/Azure/Connectors/releases and run:" -ForegroundColor Red
    Write-Host "         az extension add --source <wheel-url-or-path>" -ForegroundColor Red
    Write-Host "       Then re-run: azd hooks run postdeploy" -ForegroundColor Red
    exit 2
}

# --- Prompt for connection inputs ------------------------------------------
Write-Host ""
Write-Host "Configure the Azure Blob connection." -ForegroundColor Cyan
Write-Host "  Reference: https://learn.microsoft.com/en-us/connectors/azureblob/" -ForegroundColor DarkGray
Write-Host ""

if ([Console]::IsInputRedirected) {
    Write-Host "ERROR: postdeploy needs an interactive terminal to prompt for storage account / access key / container." -ForegroundColor Red
    Write-Host "       Re-run interactively:  azd hooks run postdeploy" -ForegroundColor Red
    exit 1
}

function Test-AccountInput {
    param([string] $Value)
    $v = $Value.Trim()
    if ($v -match '^https?://') {
        if ($v -notmatch '\.blob\.core\.windows\.net') {
            Write-Host "WARNING: blob endpoint URL does not contain '.blob.core.windows.net' — typo? Got: $v" -ForegroundColor Yellow
            $confirm = Read-Host "Use it anyway? [y/N]"
            if ($confirm -notmatch '^[Yy]') { return $null }
        }
    } elseif ($v -notmatch '^[a-z0-9]{3,24}$') {
        Write-Host "WARNING: '$v' does not look like a valid storage account name (3-24 lowercase alphanumeric)." -ForegroundColor Yellow
        $confirm = Read-Host "Use it anyway? [y/N]"
        if ($confirm -notmatch '^[Yy]') { return $null }
    }
    return $v
}

function Read-AccountInput {
    param([string] $Saved)
    while ($true) {
        $prompt = if ($Saved) {
            "Storage account name OR blob endpoint URL [$Saved]"
        } else {
            "Storage account name OR blob endpoint URL (e.g. 'mystorage' or 'https://mystorage.blob.core.windows.net/')"
        }
        $val = Read-Host $prompt
        if ([string]::IsNullOrWhiteSpace($val)) {
            if ($Saved) { return $Saved }
            Write-Host "Required." -ForegroundColor Yellow
            continue
        }
        $valid = Test-AccountInput -Value $val
        if ($valid) { return $valid }
    }
}

function Read-AccessKey {
    while ($true) {
        $secure = Read-Host "Storage account access key" -AsSecureString
        $plain  = [System.Net.NetworkCredential]::new('', $secure).Password
        if (-not [string]::IsNullOrWhiteSpace($plain)) { return $plain }
        Write-Host "Required." -ForegroundColor Yellow
    }
}

function Read-ContainerName {
    param([string] $Saved)
    while ($true) {
        $prompt = if ($Saved) { "Container name to watch [$Saved]" } else { "Container name to watch (e.g. 'samples')" }
        $val = Read-Host $prompt
        if ([string]::IsNullOrWhiteSpace($val)) {
            if ($Saved) { return $Saved }
            Write-Host "Required." -ForegroundColor Yellow
            continue
        }
        return $val.Trim()
    }
}

function Set-ConnectionKeyBasedAuth {
    param(
        [Parameter(Mandatory)] [string] $AccountInput,
        [Parameter(Mandatory)] [string] $AccessKey
    )
    $url = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Web/connectorGateways/$connectorNamespaceName/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    $body = @{
        location   = $outputs.AZURE_LOCATION
        properties = @{
            connectorName     = 'azureblob'
            parameterValueSet = @{
                name   = 'keyBasedAuth'
                values = @{
                    accountName = @{ value = $AccountInput }
                    accessKey   = @{ value = $AccessKey }
                }
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

function Wait-ConnectionConnected {
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
        if ($sLower -eq "error") { return "Error" }
        Start-Sleep -Seconds 3
    }
    return $lastStatus
}

function Show-ConnectionError {
    $detailJson = az connector-namespace connection show `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $azureblobConnectionName --query "properties.statuses" -o json 2>$null
    if ($detailJson) {
        try {
            $statuses = $detailJson | ConvertFrom-Json
            foreach ($st in @($statuses)) {
                if ($st.error -and $st.error.message) {
                    Write-Host "   detail: $($st.error.code): $($st.error.message)" -ForegroundColor Red
                } elseif ($st.status) {
                    Write-Host "   detail: status=$($st.status)" -ForegroundColor Red
                }
            }
        } catch { }
    }
}

$accountInput   = $null
$accessKeyPlain = $null
$containerInput = $null
$maxAttempts    = 3
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $accountInput   = Read-AccountInput -Saved $savedAccount
    $accessKeyPlain = Read-AccessKey
    if ($attempt -eq 1) {
        $containerInput = Read-ContainerName -Saved $savedContainer
    }

    Write-Host ""
    Write-Host "-> Updating connection '$azureblobConnectionName' with key-based auth (attempt $attempt/$maxAttempts)..." -ForegroundColor Yellow
    if (-not (Set-ConnectionKeyBasedAuth -AccountInput $accountInput -AccessKey $accessKeyPlain)) {
        Write-Host "ERROR: failed to update Azure Blob connection (ARM PUT failed)." -ForegroundColor Red
        exit 1
    }

    $finalStatus = Wait-ConnectionConnected -TimeoutSeconds 90
    if ($finalStatus -eq "Connected") {
        Write-Host "   Azure Blob connection is Connected." -ForegroundColor Green
        break
    }

    Write-Host "ERROR: connection status is '$finalStatus' — credentials or endpoint rejected." -ForegroundColor Red
    Show-ConnectionError
    if ($attempt -lt $maxAttempts) {
        Write-Host ""
        Write-Host "Re-enter the storage account / endpoint / access key and try again." -ForegroundColor Yellow
        $savedAccount = $accountInput
    } else {
        Write-Host ""
        Write-Host "Giving up after $maxAttempts attempts. Verify the storage account name, blob endpoint, and access key, then re-run: azd hooks run postdeploy" -ForegroundColor Red
        exit 1
    }
}

# Persist non-secret values for next run (only after Connected).
azd env set BLOB_ACCOUNT   $accountInput  | Out-Null
azd env set BLOB_CONTAINER $containerInput | Out-Null

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
    $callbackUrl = "https://$functionAppName.azurewebsites.net/runtime/webhooks/connector?functionName=$functionName&code=$connectorExtensionKey"
    $notificationDetails = (@{ callbackUrl = $callbackUrl; httpMethod = 'Post' } | ConvertTo-Json -Compress)

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
            --description "Azure Blob $operationName -> $functionName"
    } finally {
        Remove-Item $connFile, $paramsFile, $notifFile -ErrorAction SilentlyContinue
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: Failed to create trigger '$triggerName'." -ForegroundColor Yellow
        $script:triggerFailures += $triggerName
    }
}

Write-Host ""
if ($triggerFailures.Count -eq 0) {
    Write-Host "✅ Connector Namespace trigger configs created successfully." -ForegroundColor Green
} else {
    Write-Host "⚠  Some trigger configs failed: $($triggerFailures -join ', ')" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ Post-deployment configuration complete." -ForegroundColor Green
Write-Host ""
