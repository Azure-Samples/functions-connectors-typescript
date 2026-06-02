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
# Both SharePoint triggers used in this app are scoped to a specific site and
# folder. These cannot be inferred at provisioning time, so we either read
# them from azd env vars or prompt the user.
$sharepointSiteAddress = $outputs.SHAREPOINT_SITE_ADDRESS
$sharepointFolderId    = $outputs.SHAREPOINT_FOLDER_ID

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
            throw "No input available. Re-run with 'interactive: true' on the hook, or set SHAREPOINT_SITE_ADDRESS / SHAREPOINT_FOLDER_ID via 'azd env set'."
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

function Test-IsGraphForbidden {
    param([string] $ErrorText)
    if (-not $ErrorText) { return $false }
    return ($ErrorText -match '(?i)forbidden|accessDenied|InvalidAuthenticationToken|AuthenticationError|401|403')
}

function Invoke-AzLoginForGraph {
    Write-Host ""
    Write-Host "Re-authenticating Azure CLI with Microsoft Graph 'Sites.Read.All' scope..." -ForegroundColor Yellow
    Write-Host "  Running: az login --scope https://graph.microsoft.com/Sites.Read.All" -ForegroundColor DarkGray
    & az login --scope https://graph.microsoft.com/Sites.Read.All --only-show-errors | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Read-ManualSharepointInputs {
    Write-Host ""
    Write-Host "Falling back to manual site entry. The library and folder pickers will still run via Microsoft Graph." -ForegroundColor Yellow
    $site = Read-Host "SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/MySite)"
    if (-not $site) { return $null }
    return @{ site = $site }
}

if (-not $sharepointSiteAddress -or -not $sharepointFolderId) {
    Write-Host ""
    Write-Host "Fetching SharePoint sites accessible to your account from Microsoft Graph..." -ForegroundColor Yellow

    # /sites?search=* enumerates sites the signed-in user has access to.
    $sitesResponse = Invoke-Graph -Url 'https://graph.microsoft.com/v1.0/sites' -UriParameters @('search=*', '$select=id,displayName,webUrl', '$top=100')

    # NOTE: We deliberately do NOT attempt 'az login --scope https://graph.microsoft.com/Sites.Read.All'.
    # Many tenants block that flow with AADSTS65002 (the Azure CLI first-party app is not
    # pre-authorized for Microsoft Graph). Fall back to manual site URL entry instead and let
    # the library/folder pickers run via Graph against that specific site.

    if (-not $sitesResponse -or -not $sitesResponse.value -or $sitesResponse.value.Count -eq 0) {
        Write-Host ""
        Write-Host "NOTE: The Azure CLI access token cannot enumerate SharePoint sites via Microsoft Graph search." -ForegroundColor Yellow
        Write-Host "      (This is expected when the tenant has not pre-authorized the Azure CLI for 'Sites.Read.All'.)" -ForegroundColor DarkGray
        Write-Host "      You can paste the site URL directly; the library and folder pickers will still run." -ForegroundColor Yellow
        Write-Host ""
        $manual = Read-ManualSharepointInputs
        if (-not $manual) {
            Write-Host "ERROR: No site provided. Set the values manually and re-run:" -ForegroundColor Red
            Write-Host "         azd env set SHAREPOINT_SITE_ADDRESS https://contoso.sharepoint.com/sites/MySite" -ForegroundColor Red
            Write-Host "         azd env set SHAREPOINT_FOLDER_ID    '/Shared Documents'" -ForegroundColor Red
            exit 1
        }
        $sharepointSiteAddress = $manual.site
        azd env set SHAREPOINT_SITE_ADDRESS $sharepointSiteAddress | Out-Null
        Write-Host "Saved SHAREPOINT_SITE_ADDRESS=$sharepointSiteAddress" -ForegroundColor Green
        $sitesResponse = $null
    }

    # Filter out entries with empty displayName (e.g. tenant root) and sort.
    $sites = @()
    if ($sitesResponse) {
        $sites = @($sitesResponse.value | Where-Object { $_.displayName } | Sort-Object displayName)
        if ($sites.Count -eq 0) { $sites = @($sitesResponse.value) }
    }

    $selectedSite = $null
    if (-not $sharepointSiteAddress) {
        $selectedSite = Select-FromList -Title 'Select a SharePoint site:' -Items $sites -LabelProperty 'displayName' -SubLabelProperty 'webUrl'
        $sharepointSiteAddress = $selectedSite.webUrl
        azd env set SHAREPOINT_SITE_ADDRESS $sharepointSiteAddress | Out-Null
        Write-Host "Saved SHAREPOINT_SITE_ADDRESS=$sharepointSiteAddress" -ForegroundColor Green
    } else {
        $selectedSite = $sites | Where-Object { $_.webUrl -eq $sharepointSiteAddress } | Select-Object -First 1
    }

    if (-not $sharepointFolderId) {
        # Resolve the Graph site id, either from the search result or by URL.
        $siteId = $null
        if ($selectedSite -and $selectedSite.id) {
            $siteId = $selectedSite.id
        } else {
            $uri = [Uri]$sharepointSiteAddress
            $relPath = $uri.AbsolutePath.TrimEnd('/')
            $resolveUrl = "https://graph.microsoft.com/v1.0/sites/$($uri.Host):$($relPath)"
            $resolved = Invoke-Graph -Url $resolveUrl -UriParameters @('$select=id')
            if ($resolved -and $resolved.id) { $siteId = $resolved.id }
        }

        if (-not $siteId) {
            Write-Host "NOTE: Microsoft Graph could not resolve the site id (likely 'Sites.Read.All' is not consented for the Azure CLI)." -ForegroundColor Yellow
            $manualFolder = Read-Host "Document library / folder path (press Enter for '/Shared Documents')"
            if ([string]::IsNullOrWhiteSpace($manualFolder)) { $manualFolder = '/Shared Documents' }
            $sharepointFolderId = $manualFolder
        } else {
            $drivesResponse = Invoke-Graph -Url "https://graph.microsoft.com/v1.0/sites/$siteId/drives" -UriParameters @('$select=id,name,webUrl')
            if (-not $drivesResponse -or -not $drivesResponse.value -or $drivesResponse.value.Count -eq 0) {
                Write-Host "NOTE: Microsoft Graph returned no document libraries for this site." -ForegroundColor Yellow
                $manualFolder = Read-Host "Document library / folder path (press Enter for '/Shared Documents')"
                if ([string]::IsNullOrWhiteSpace($manualFolder)) { $manualFolder = '/Shared Documents' }
                $sharepointFolderId = $manualFolder
            } else {
                $drive = Select-FromList -Title 'Select a document library:' -Items $drivesResponse.value -LabelProperty 'name'
                # The connector folderId accepts the human-readable
                # server-relative path. The default 'Documents' library
                # surfaces under '/Shared Documents' in the site URL.
                $libraryRoot = if ($drive.name -eq 'Documents') { '/Shared Documents' } else { "/$($drive.name)" }

                # Let the user pick the library root or drill into a subfolder.
                $folderChoices = @(
                    [pscustomobject]@{ name = "(library root: $libraryRoot)"; relativePath = '' }
                )
                $childrenResponse = Invoke-Graph -Url "https://graph.microsoft.com/v1.0/drives/$($drive.id)/root/children" -UriParameters @('$select=name,folder', '$top=200') -Quiet
                if ($childrenResponse -and $childrenResponse.value) {
                    foreach ($child in $childrenResponse.value) {
                        if ($child.folder) {
                            $folderChoices += [pscustomobject]@{ name = $child.name; relativePath = "/$($child.name)" }
                        }
                    }
                }

                if ($folderChoices.Count -eq 1) {
                    $sharepointFolderId = $libraryRoot
                } else {
                    $picked = Select-FromList -Title 'Select a folder (or library root):' -Items $folderChoices -LabelProperty 'name'
                    $sharepointFolderId = $libraryRoot + $picked.relativePath
                }
            }
        }
        azd env set SHAREPOINT_FOLDER_ID $sharepointFolderId | Out-Null
        Write-Host "Saved SHAREPOINT_FOLDER_ID=$sharepointFolderId" -ForegroundColor Green
    }
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
$triggers = @(
    @{ functionName = 'OnSharepointNewFile';     operationName = 'OnNewFile';     parameters = @(@{ name = 'dataset'; value = $sharepointSiteAddress }, @{ name = 'folderId'; value = $sharepointFolderId }) },
    @{ functionName = 'OnSharepointUpdatedFile'; operationName = 'OnUpdatedFile'; parameters = @(@{ name = 'dataset'; value = $sharepointSiteAddress }, @{ name = 'folderId'; value = $sharepointFolderId }) }
)

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
}

Write-Host ""
Write-Host "✅ Post-deployment configuration complete." -ForegroundColor Green
Write-Host ""
