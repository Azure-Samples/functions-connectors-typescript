# Post-deployment configuration for the onedriveApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the OneDrive for Business
#      connection by opening the consent link in a browser and polling
#      until the connection flips to `Connected`.
#
# Connection access policies for the function-app MI and the deployer
# user are created by Bicep (infra/connectorNamespace.bicep).

Write-Host "Post-deployment configuration..." -ForegroundColor Yellow

# --- Read azd outputs --------------------------------------------------------
$outputs = azd env get-values --output json | ConvertFrom-Json

$resourceGroupName        = $outputs.resourceGroupName
$connectorNamespaceName   = $outputs.connectorNamespaceName
$onedriveConnectionName   = $outputs.onedriveConnectionName
$functionAppName          = $outputs.functionAppName

if (-not $resourceGroupName -or -not $connectorNamespaceName -or -not $onedriveConnectionName -or -not $functionAppName) {
    Write-Host "ERROR: required azd outputs missing. Run 'azd provision' first." -ForegroundColor Red
    exit 1
}

# --- Required OneDrive identifiers ------------------------------------------
# OneDrive triggers are scoped to a folder within the user's OneDrive.
# folderId can be a server-relative path (e.g. '/' for root, '/Documents/MyFolder').
$onedriveFolderId = $outputs.ONEDRIVE_FOLDER_ID

function Select-FromList {
    param(
        [Parameter(Mandatory)] [string] $Title,
        [Parameter(Mandatory)] [object[]] $Items,
        [Parameter(Mandatory)] [string] $LabelProperty,
        [string] $SubLabelProperty
    )
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $label = $Items[$i].$LabelProperty
        if ($SubLabelProperty -and $Items[$i].$SubLabelProperty) {
            Write-Host ("  [{0}] {1}  ({2})" -f ($i + 1), $label, $Items[$i].$SubLabelProperty)
        } else {
            Write-Host ("  [{0}] {1}" -f ($i + 1), $label)
        }
    }
    while ($true) {
        $answer = Read-Host "Enter number (1-$($Items.Count))"
        if ($null -eq $answer) {
            throw "No input available. Re-run with 'interactive: true' on the hook, or set ONEDRIVE_FOLDER_ID via 'azd env set'."
        }
        $num = 0
        if ([int]::TryParse($answer, [ref]$num) -and $num -ge 1 -and $num -le $Items.Count) {
            return $Items[$num - 1]
        }
        Write-Host "Invalid selection." -ForegroundColor Yellow
    }
}

$script:LastGraphError = $null

function Invoke-Graph {
    param(
        [Parameter(Mandatory)][string] $Url,
        [string[]] $UriParameters,
        [switch] $Quiet
    )
    $script:LastGraphError = $null
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        # PowerShell -> az.cmd -> cmd.exe re-parses args; cmd treats '&' as a
        # command separator, which mangles URLs with query strings. Pass query
        # params via --uri-parameters so az builds them server-side.
        $azArgs = @('rest', '--method', 'get', '--url', $Url, '--resource', 'https://graph.microsoft.com')
        if ($UriParameters -and $UriParameters.Count -gt 0) {
            $azArgs += '--uri-parameters'
            $azArgs += $UriParameters
        }
        $raw = & az @azArgs 2>$errFile
        if ($LASTEXITCODE -ne 0 -or -not $raw) {
            $err = (Get-Content $errFile -Raw).Trim()
            $script:LastGraphError = $err
            if (-not $Quiet) {
                if ($err) { Write-Host "   Graph call failed: $err" -ForegroundColor DarkGray }
            }
            return $null
        }
        return ($raw | ConvertFrom-Json)
    } finally {
        Remove-Item $errFile -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if ($onedriveFolderId) {
    Write-Host "Current ONEDRIVE_FOLDER_ID: $onedriveFolderId" -ForegroundColor DarkGray
}

# Folder selection happens AFTER OAuth consent — see Phase 2 near the end of
# this script. The connection itself does not need a folder id; only the
# triggers do, so we authorize first and pick the folder afterwards (Graph
# tends to work better once the user has signed in via the consent flow).

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

# --- Authorize the OneDrive connection (OAuth consent) ----------------------
function Test-ConnectionExists {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    az connector-namespace connection show `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $ConnectionName -o none 2>$null
    return ($LASTEXITCODE -eq 0)
}

function New-OneDriveConnection {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    Write-Host "-> Creating OneDrive connection '$ConnectionName' on namespace '$connectorNamespaceName'..." -ForegroundColor Yellow
    az connector-namespace connection create `
        -g $resourceGroupName `
        --namespace $connectorNamespaceName `
        -n $ConnectionName `
        --connector-name 'onedrive'
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
        if (-not (New-OneDriveConnection -ConnectionName $ConnectionName)) {
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
Write-Host "Authorizing OneDrive for Business connection via Azure CLI..." -ForegroundColor Yellow
$authorized = Invoke-AuthorizeConnection -ConnectionName $onedriveConnectionName -Description "OneDrive for Business"
if (-not $authorized) {
    Write-Host ""
    Write-Host "ERROR: OneDrive connection is not Connected. Cannot create triggers." -ForegroundColor Red
    Write-Host "       Complete the OAuth consent flow, then re-run: azd hooks run postdeploy" -ForegroundColor Red
    exit 1
}

# --- Phase 2: select OneDrive folder + create triggers ----------------------
# Connection is now authorized. Pick the folder Id for trigger 'folderId'.
# We list folders by forwarding requests THROUGH the authorized connection
# ('az connector-namespace connection invoke'), so this works even when the
# Azure CLI's own Graph token lacks Files.Read consent in the tenant.
# Supports drilling down into subfolders.
Write-Host ""
Write-Host "Listing OneDrive folders via the authorized connection..." -ForegroundColor Yellow

# Invoke an arbitrary HTTP request through the authorized connection. Returns
# the parsed JSON response body, or $null on failure. The connector-namespace
# CLI extension's 200-handler chokes on array bodies, so we run with --debug
# and parse the wrapped {response:{statusCode,body,headers}} envelope from
# the debug log.
function Invoke-ConnectionRequest {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [string] $Method = 'get'
    )
    $reqFile = Join-Path ([System.IO.Path]::GetTempPath()) ("conninvoke-" + [guid]::NewGuid().ToString() + ".json")
    (@{ method = $Method; path = $Path } | ConvertTo-Json -Compress) | Set-Content -Path $reqFile -Encoding utf8
    try {
        $raw = az connector-namespace connection invoke `
            -g $resourceGroupName `
            --namespace $connectorNamespaceName `
            --connection-name $onedriveConnectionName `
            --request "@$reqFile" --debug 2>&1 | Out-String
    } finally {
        Remove-Item $reqFile -ErrorAction SilentlyContinue
    }

    foreach ($line in ($raw -split "`r?`n")) {
        $idx = $line.IndexOf('{"response":')
        if ($idx -ge 0) {
            $jsonText = $line.Substring($idx)
            try {
                $env = $jsonText | ConvertFrom-Json
                $sc = $env.response.statusCode
                if ($sc -eq 'OK' -or $sc -eq 'Created' -or $sc -eq 'Accepted' -or $sc -eq 'NoContent') {
                    return $env.response.body
                }
                Write-Host "   connection invoke returned status: $sc" -ForegroundColor DarkGray
                return $null
            } catch {
                # try next line
            }
        }
    }
    return $null
}

function Select-OneDriveFolderInteractive {
    param([string] $CurrentSavedId)
    # Stack of [pscustomobject]@{ id = ...; path = ... }. id 'root' is the
    # special OneDrive connector token for the drive root.
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push([pscustomobject]@{ id = 'root'; path = '/' })

    while ($true) {
        $current = $stack.Peek()
        Write-Host ""
        Write-Host "Current folder: $($current.path)  [id: $($current.id)]" -ForegroundColor Cyan

        $listingPath = if ($current.id -eq 'root') {
            '/datasets/default/folders'
        } else {
            "/datasets/default/folders/$([System.Web.HttpUtility]::UrlEncode($current.id))"
        }
        $items = Invoke-ConnectionRequest -Path $listingPath
        $subfolders = @()
        if ($items) {
            $subfolders = @($items | Where-Object { $_.IsFolder })
        }

        $choices = @()
        $pickId = if ($current.id -eq 'root') { 'root' } else { $current.id }
        $choices += [pscustomobject]@{ display = "[OK] Use this folder ($($current.path))"; action = 'pick'; targetId = $pickId; target = $null }
        if ($CurrentSavedId -and $stack.Count -eq 1) {
            $choices += [pscustomobject]@{ display = "(keep current saved: $CurrentSavedId)"; action = 'keep'; targetId = $CurrentSavedId; target = $null }
        }
        if ($stack.Count -gt 1) {
            $choices += [pscustomobject]@{ display = '.. (go up)'; action = 'up'; targetId = $null; target = $null }
        }
        foreach ($sf in $subfolders) {
            $choices += [pscustomobject]@{
                display = "-> $($sf.Name)"
                action  = 'down'
                targetId = $null
                target  = [pscustomobject]@{
                    id   = $sf.Id
                    path = if ($current.path -eq '/') { "/$($sf.Name)" } else { "$($current.path)/$($sf.Name)" }
                }
            }
        }
        $choices += [pscustomobject]@{ display = '(Enter folder id manually...)'; action = 'manual'; targetId = $null; target = $null }
        $choices += [pscustomobject]@{ display = '(Cancel — skip trigger creation)'; action = 'cancel'; targetId = $null; target = $null }

        $picked = Select-FromList -Title 'Choose an action:' -Items $choices -LabelProperty 'display'
        switch ($picked.action) {
            'pick'   { return $picked.targetId }
            'keep'   { return $picked.targetId }
            'up'     { [void]$stack.Pop() }
            'down'   { $stack.Push($picked.target) }
            'manual' {
                $manual = Read-Host 'OneDrive folder id'
                if (-not [string]::IsNullOrWhiteSpace($manual)) { return $manual.Trim() }
            }
            'cancel' { return $null }
        }
    }
}

Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
$selected = Select-OneDriveFolderInteractive -CurrentSavedId $onedriveFolderId
if (-not $selected) {
    Write-Host "Skipping trigger creation." -ForegroundColor Yellow
    Write-Host "✅ Connection authorized; triggers pending." -ForegroundColor Green
    exit 0
}
$onedriveFolderId = $selected

azd env set ONEDRIVE_FOLDER_ID $onedriveFolderId | Out-Null
Write-Host "Saved ONEDRIVE_FOLDER_ID=$onedriveFolderId" -ForegroundColor Green

# Trigger configs (operationName values from the OneDrive connector swagger:
# https://learn.microsoft.com/en-us/connectors/onedrive/).
$triggers = @(
    @{ functionName = 'OnOneDriveNewFile';     operationName = 'OnNewFileV2';     parameters = @(@{ name = 'folderId'; value = $onedriveFolderId }) },
    @{ functionName = 'OnOneDriveUpdatedFile'; operationName = 'OnUpdatedFileV2'; parameters = @(@{ name = 'folderId'; value = $onedriveFolderId }) }
)

# --- Create Connector Namespace trigger configs -----------------------------
Write-Host ""
Write-Host "Fetching connector extension key for $functionAppName..." -ForegroundColor Cyan
$connectorExtensionKey = (az functionapp keys list -g $resourceGroupName -n $functionAppName --query "systemKeys.connector_extension" -o tsv)
if (-not $connectorExtensionKey) {
    Write-Host "ERROR: could not fetch connector_extension system key from $functionAppName." -ForegroundColor Red
    exit 1
}

$connectionDetails = (@{ connectorName = 'onedrive'; connectionName = $onedriveConnectionName } | ConvertTo-Json -Compress)
$script:triggerFailures = @()

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

    $triggerName = "$onedriveConnectionName-$($functionName.ToLower())"
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
            --description "OneDrive $operationName -> $functionName"
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
}

Write-Host ""
Write-Host "✅ Post-deployment configuration complete." -ForegroundColor Green
Write-Host ""
