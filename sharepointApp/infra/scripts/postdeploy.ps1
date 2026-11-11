# Post-deployment configuration for the sharepointApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the SharePoint Online
#      connection by opening the consent link in a browser and polling
#      until the connection flips to `Connected`.
#
# Connection access policies for the function-app MI and the deployer
# user are created by Bicep (infra/connectorNamespace.bicep).

Write-Host "Post-deployment configuration..." -ForegroundColor Yellow

# --- Read azd outputs --------------------------------------------------------
$outputs = azd env get-values --output json | ConvertFrom-Json

$resourceGroupName             = $outputs.resourceGroupName
$connectorNamespaceName        = $outputs.connectorNamespaceName
$sharepointConnectionName      = $outputs.sharepointConnectionName
$functionAppName               = $outputs.functionAppName

if (-not $resourceGroupName -or -not $connectorNamespaceName -or -not $sharepointConnectionName -or -not $functionAppName) {
    Write-Host "ERROR: required azd outputs missing. Run 'azd provision' first." -ForegroundColor Red
    exit 1
}

# --- Required SharePoint identifiers ----------------------------------------
$sharepointSiteAddress = $outputs.sharepointSiteUrl

if (-not $sharepointSiteAddress) {
    Write-Host "ERROR: Missing provisioned SharePoint site URL." -ForegroundColor Red
    Write-Host "Set SHAREPOINT_SITE_URL with 'azd env set', then run 'azd provision' before rerunning this hook." -ForegroundColor Red
    exit 1
}

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

# --- Trigger configs --------------------------------------------------------
# One entry per Functions trigger in this app. operationName values come from
# the SharePoint Online connector swagger:
#   https://learn.microsoft.com/en-us/connectors/sharepointonline/
$triggers = @()

$sharepointLibraryName = $outputs.sharepointLibraryName
$sharepointListName = $outputs.sharepointListName
$sharepointFolderPath = $outputs.sharepointFolderPath
$sharepointEnableDeletionTriggers = "$($outputs.sharepointEnableDeletionTriggers)" -eq 'true'
$sharepointEnableSyntexTrigger = "$($outputs.sharepointEnableSyntexTrigger)" -eq 'true'
$sharepointFormId = $outputs.sharepointFormId
$sharepointDigestSchedule = $outputs.sharepointDigestSchedule

$listParameters = @(@{ name = 'dataset'; value = $sharepointSiteAddress }, @{ name = 'table'; value = $sharepointListName })
$libraryParameters = @(@{ name = 'dataset'; value = $sharepointSiteAddress }, @{ name = 'table'; value = $sharepointLibraryName })
if ($sharepointFolderPath) {
    $libraryParameters += @{ name = 'folderPath'; value = $sharepointFolderPath }
}

$triggers += @(
    @{ functionName = 'OnSharepointChangedItems'; operationName = 'GetOnChangedItems'; parameters = $listParameters },
    @{ functionName = 'OnSharepointNewItems'; operationName = 'GetOnNewItems'; parameters = $listParameters },
    @{ functionName = 'OnSharepointUpdatedItems'; operationName = 'GetOnUpdatedItems'; parameters = $listParameters },
    @{ functionName = 'OnSharepointNewFileItems'; operationName = 'GetOnNewFileItems'; parameters = $libraryParameters },
    @{ functionName = 'OnSharepointUpdatedFileItems'; operationName = 'GetOnUpdatedFileItems'; parameters = $libraryParameters }
)

if ($sharepointEnableDeletionTriggers) {
    $triggers += @(
        @{ functionName = 'OnSharepointDeletedItems'; operationName = 'GetOnDeletedItems'; parameters = $listParameters },
        @{ functionName = 'OnSharepointDeletedFileItems'; operationName = 'GetOnDeletedFileItems'; parameters = $libraryParameters }
    )
}

if ($sharepointEnableSyntexTrigger) {
    $triggers += @{ functionName = 'OnSharepointUpdatedFileClassifiedTimes'; operationName = 'GetOnUpdatedFileClassifiedTimes'; parameters = $libraryParameters }
}

if ($sharepointFormId) {
    $triggers += @{ functionName = 'OnSharepointNewItemsFromForm'; operationName = 'GetOnNewItemsFromForm'; parameters = $listParameters + @(@{ name = 'form'; value = $sharepointFormId }) }
}

if ($sharepointDigestSchedule) {
    $triggers += @{ functionName = 'OnSharepointRecurrenceDigest'; operationName = 'GetOnRecurrenceDigest'; parameters = $libraryParameters + @(@{ name = 'add'; value = $true }, @{ name = 'update'; value = $true }, @{ name = 'runSchedule'; value = $sharepointDigestSchedule }) }
}

# --- Authorize the SharePoint connection (OAuth consent) --------------------
function Test-ConnectionExists {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    az connector-namespace connection show `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $ConnectionName -o none 2>$null
    return ($LASTEXITCODE -eq 0)
}

function New-SharepointConnection {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    Write-Host "-> Creating SharePoint connection '$ConnectionName' on namespace '$connectorNamespaceName'..." -ForegroundColor Yellow
    az connector-namespace connection create `
        -g $resourceGroupName `
        --namespace $connectorNamespaceName `
        -n $ConnectionName `
        --connector-name 'sharepointonline'
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   Failed to create connection '$ConnectionName'." -ForegroundColor Red
        return $false
    }

    $functionAppPrincipalId = az functionapp identity show -g $resourceGroupName -n $functionAppName --query principalId -o tsv 2>$null
    if ($functionAppPrincipalId) {
        $tenantId = az account show --query tenantId -o tsv
        Write-Host "   Granting function-app MI ($functionAppPrincipalId) access to connection..." -ForegroundColor Cyan
        az connector-namespace connection access-policy create `
            -g $resourceGroupName `
            --namespace $connectorNamespaceName `
            --connection-name $ConnectionName `
            -n 'functionapp-msi' `
            --principal-type 'ActiveDirectory' `
            --principal-object-id $functionAppPrincipalId `
            --principal-tenant-id $tenantId 2>$null | Out-Null
    } else {
        Write-Host "   WARNING: function-app MI principalId not found; skipping access policy." -ForegroundColor Yellow
    }

    $userPrincipalId = az ad signed-in-user show --query id -o tsv 2>$null
    if ($userPrincipalId) {
        $tenantId = az account show --query tenantId -o tsv
        Write-Host "   Granting deployer user ($userPrincipalId) access to connection..." -ForegroundColor Cyan
        az connector-namespace connection access-policy create `
            -g $resourceGroupName `
            --namespace $connectorNamespaceName `
            --connection-name $ConnectionName `
            -n 'dev-user' `
            --principal-type 'ActiveDirectory' `
            --principal-object-id $userPrincipalId `
            --principal-tenant-id $tenantId 2>$null | Out-Null
    }
    return $true
}

function Invoke-AuthorizeConnection {
    param(
        [Parameter(Mandatory)] [string] $ConnectionName,
        [Parameter(Mandatory)] [string] $Description
    )
    Write-Host "-> Authorizing $Description connection: $ConnectionName" -ForegroundColor Cyan

    if (-not (Test-ConnectionExists -ConnectionName $ConnectionName)) {
        Write-Host "   Connection '$ConnectionName' not found on namespace '$connectorNamespaceName'." -ForegroundColor Yellow
        if (-not (New-SharepointConnection -ConnectionName $ConnectionName)) {
            return $false
        }
    }

    $currentStatus = az connector-namespace connection show `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $ConnectionName --query "properties.overallStatus" -o tsv 2>$null
    if ($currentStatus -and $currentStatus.ToLower() -eq "connected") {
        Write-Host "   already Connected; skipping consent flow" -ForegroundColor Green
        return $true
    }

    $paramsFile = Join-Path ([System.IO.Path]::GetTempPath()) ("consent-params-" + [guid]::NewGuid().ToString() + ".json")
    '[{"parameterName":"token","redirectUrl":"https://portal.azure.com"}]' | Set-Content -Path $paramsFile -Encoding utf8
    try {
        $consentJson = $null
        for ($i = 0; $i -lt 5; $i++) {
            $consentJson = az connector-namespace connection list-consent-links `
                -g $resourceGroupName --namespace $connectorNamespaceName `
                --connection-name $ConnectionName --parameters "@$paramsFile" -o json
            if ($LASTEXITCODE -eq 0 -and $consentJson) { break }
            Write-Host "   list-consent-links attempt $($i + 1) failed; retrying in 5s..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    } finally {
        Remove-Item $paramsFile -ErrorAction SilentlyContinue
    }
    if (-not $consentJson) {
        Write-Host "   list-consent-links returned no output after retries" -ForegroundColor Red
        return $false
    }
    $parsed = $consentJson | ConvertFrom-Json
    $link = $null
    if ($parsed.value -and $parsed.value.Count -gt 0) {
        $link = $parsed.value[0].link
    } elseif ($parsed.link) {
        $link = $parsed.link
    }
    if (-not $link) {
        Write-Host "   list-consent-links returned no link. Raw response:" -ForegroundColor Red
        Write-Host "   $consentJson" -ForegroundColor DarkGray
        return $false
    }

    Write-Host "   opening browser for OAuth consent..." -ForegroundColor Cyan
    Write-Host "   (if no tab opens, paste this URL manually:" -ForegroundColor Cyan
    Write-Host "      $link)" -ForegroundColor Cyan
    try { Start-Process $link | Out-Null } catch { Write-Host "   Start-Process failed: $_" -ForegroundColor Yellow }

    $deadline = (Get-Date).AddMinutes(5)
    $lastStatus = ""
    while ((Get-Date) -lt $deadline) {
        $s = az connector-namespace connection show `
            -g $resourceGroupName --namespace $connectorNamespaceName `
            -n $ConnectionName --query "properties.overallStatus" -o tsv 2>$null
        if ($s -ne $lastStatus) {
            Write-Host "   status: $(if ($s) { $s } else { '?' })" -ForegroundColor Cyan
            $lastStatus = $s
        }
        if ($s -and $s.ToLower() -eq "connected") {
            Write-Host "   ✓ $ConnectionName authenticated" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Write-Host "   timed out waiting for consent (5 min)." -ForegroundColor Yellow
    return $false
}

Write-Host ""
Write-Host "Authorizing SharePoint Online connection via Azure CLI..." -ForegroundColor Yellow
$authorized = Invoke-AuthorizeConnection -ConnectionName $sharepointConnectionName -Description "SharePoint Online"
if (-not $authorized) {
    Write-Host ""
    Write-Host "ERROR: SharePoint connection is not Connected. Cannot create triggers." -ForegroundColor Red
    Write-Host "       Complete the OAuth consent flow, then re-run: azd hooks run postdeploy" -ForegroundColor Red
    exit 1
}

# --- Create Connector Namespace trigger configs -----------------------------
Write-Host ""
Write-Host "Fetching connector extension key for $functionAppName..." -ForegroundColor Cyan
$connectorExtensionKey = (az functionapp keys list -g $resourceGroupName -n $functionAppName --query "systemKeys.connector_extension" -o tsv)
if (-not $connectorExtensionKey) {
    Write-Host "ERROR: could not fetch connector_extension system key from $functionAppName." -ForegroundColor Red
    exit 1
}

$connectionDetails = (@{ connectorName = 'sharepointonline'; connectionName = $sharepointConnectionName } | ConvertTo-Json -Compress)
$script:triggerFailures = @()

$existingTriggers = az connector-namespace trigger list -g $resourceGroupName --namespace $connectorNamespaceName --query '[].name' -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not list existing SharePoint trigger configurations.' }
$existingNames = ($existingTriggers -join "`n") | ConvertFrom-Json
$optionalFunctions = @('OnSharepointDeletedItems', 'OnSharepointDeletedFileItems', 'OnSharepointUpdatedFileClassifiedTimes', 'OnSharepointNewItemsFromForm', 'OnSharepointRecurrenceDigest')
foreach ($functionName in $optionalFunctions) {
    $triggerName = "$sharepointConnectionName-$($functionName.ToLower())"
    if ($functionName -notin $triggers.functionName -and $triggerName -in $existingNames) {
        Write-Host "Disabling opt-in trigger: $functionName"
        az connector-namespace trigger update -g $resourceGroupName --namespace $connectorNamespaceName -n $triggerName --state Disabled -o none
        if ($LASTEXITCODE -ne 0) { throw "Could not disable trigger $triggerName." }
    }
}

function New-JsonArgFile {
    param([Parameter(Mandatory)] [string] $Json)
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("trigger-arg-" + [guid]::NewGuid().ToString() + ".json")
    Set-Content -Path $path -Value $Json -Encoding utf8
    return $path
}

foreach ($t in $triggers) {
    $functionName = $t.functionName
    $operationName = $t.operationName
    if ($t.parameters.Count -eq 0) {
        $parameters = '[]'
    } else {
        $parameters = ($t.parameters | ConvertTo-Json -Compress -Depth 5 -AsArray)
    }

    $triggerName = "$sharepointConnectionName-$($functionName.ToLower())"
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

    $verb = if ($triggerName -in $existingNames) { 'update' } else { 'create' }

    $connFile   = New-JsonArgFile -Json $connectionDetails
    $paramsFile = New-JsonArgFile -Json $parameters
    $notifFile  = New-JsonArgFile -Json $notificationDetails
    try {
        az connector-namespace trigger $verb `
            -g $resourceGroupName `
            --namespace $connectorNamespaceName `
            -n $triggerName `
            --connection-details "@$connFile" `
            --operation-name $operationName `
            --parameters "@$paramsFile" `
            --notification-details "@$notifFile" `
            --state 'Enabled' `
            --description "SharePoint $operationName -> $functionName"
    } finally {
        Remove-Item $connFile, $paramsFile, $notifFile -ErrorAction SilentlyContinue
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: Failed to create trigger '$triggerName'. Continuing with remaining triggers." -ForegroundColor Yellow
        $script:triggerFailures += $triggerName
    }
}

Write-Host ""
if ($triggerFailures.Count -eq 0) {
    Write-Host "✅ Connector Namespace trigger configs created successfully." -ForegroundColor Green
} else {
    Write-Host "⚠  Some trigger configs failed: $($triggerFailures -join ', ')" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "✅ Post-deployment configuration complete." -ForegroundColor Green
Write-Host ""
