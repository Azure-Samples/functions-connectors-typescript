# Post-deployment configuration for the teamsApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the Microsoft Teams
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
$teamsConnectionName           = $outputs.teamsConnectionName
$functionAppName               = $outputs.functionAppName

if (-not $resourceGroupName -or -not $connectorNamespaceName -or -not $teamsConnectionName -or -not $functionAppName) {
    Write-Host "ERROR: required azd outputs missing. Run 'azd provision' first." -ForegroundColor Red
    exit 1
}

# --- Required Teams identifiers --------------------------------------------
# All Microsoft Teams triggers used in this app are scoped to a specific team
# (and most also to a specific channel). These IDs cannot be inferred at
# provisioning time, so we either read them from azd env vars or prompt
# the user to pick a team / channel via Microsoft Graph.
$teamsGroupId   = $outputs.TEAMS_GROUP_ID
$teamsChannelId = $outputs.TEAMS_CHANNEL_ID

function Select-FromList {
    param(
        [Parameter(Mandatory)] [string] $Title,
        [Parameter(Mandatory)] [object[]] $Items,
        [Parameter(Mandatory)] [string] $LabelProperty
    )
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("  [{0}] {1}" -f ($i + 1), $Items[$i].$LabelProperty)
    }
    while ($true) {
        $answer = Read-Host "Enter number (1-$($Items.Count))"
        if ($null -eq $answer) {
            throw "No input available. Re-run with 'interactive: true' on the hook, or set TEAMS_GROUP_ID / TEAMS_CHANNEL_ID via 'azd env set'."
        }
        $num = 0
        if ([int]::TryParse($answer, [ref]$num) -and $num -ge 1 -and $num -le $Items.Count) {
            return $Items[$num - 1]
        }
        Write-Host "Invalid selection." -ForegroundColor Yellow
    }
}

function Invoke-Graph {
    param([Parameter(Mandatory)][string] $Url)
    $raw = az rest --method get --url $Url --resource https://graph.microsoft.com 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return ($raw | ConvertFrom-Json)
}

if (-not $teamsGroupId -or -not $teamsChannelId) {
    Write-Host ""
    Write-Host "TEAMS_GROUP_ID / TEAMS_CHANNEL_ID not set. Fetching your Teams from Microsoft Graph..." -ForegroundColor Yellow

    $teamsResponse = Invoke-Graph -Url 'https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id,displayName'
    if (-not $teamsResponse -or -not $teamsResponse.value -or $teamsResponse.value.Count -eq 0) {
        Write-Host "ERROR: Could not list your joined teams via Microsoft Graph." -ForegroundColor Red
        Write-Host "       Ensure 'az login' was run with a user account that is a member of at least one team," -ForegroundColor Red
        Write-Host "       or set the values manually:" -ForegroundColor Red
        Write-Host "         azd env set TEAMS_GROUP_ID   <team / Microsoft 365 group object id>" -ForegroundColor Red
        Write-Host "         azd env set TEAMS_CHANNEL_ID <channel id, e.g. 19:abcd...@thread.tacv2>" -ForegroundColor Red
        exit 1
    }

    if (-not $teamsGroupId) {
        $team = Select-FromList -Title 'Select a team:' -Items $teamsResponse.value -LabelProperty 'displayName'
        $teamsGroupId = $team.id
        azd env set TEAMS_GROUP_ID $teamsGroupId | Out-Null
        Write-Host "Saved TEAMS_GROUP_ID=$teamsGroupId" -ForegroundColor Green
    }

    if (-not $teamsChannelId) {
        $channelsResponse = Invoke-Graph -Url "https://graph.microsoft.com/v1.0/teams/$teamsGroupId/channels?`$select=id,displayName"
        if (-not $channelsResponse -or -not $channelsResponse.value -or $channelsResponse.value.Count -eq 0) {
            Write-Host "ERROR: Could not list channels for team $teamsGroupId." -ForegroundColor Red
            exit 1
        }
        $channel = Select-FromList -Title 'Select a channel:' -Items $channelsResponse.value -LabelProperty 'displayName'
        $teamsChannelId = $channel.id
        azd env set TEAMS_CHANNEL_ID $teamsChannelId | Out-Null
        Write-Host "Saved TEAMS_CHANNEL_ID=$teamsChannelId" -ForegroundColor Green
    }
}

# --- Verify the connector-namespace az CLI extension is installed ----------
# This script does NOT auto-install the extension. Install it once with:
#   az extension add --source <connector_namespace-*.whl URL from
#                              https://github.com/Azure/Connectors/releases>
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
# the Microsoft Teams connector swagger:
#   https://learn.microsoft.com/en-us/connectors/teams/
$triggers = @(
    @{ functionName = 'OnNewChannelMessage';             operationName = 'OnNewChannelMessage';             parameters = @(@{ name = 'groupId'; value = $teamsGroupId }, @{ name = 'channelId'; value = $teamsChannelId }) },
    @{ functionName = 'OnNewChannelMessageMentioningMe'; operationName = 'OnNewChannelMessageMentioningMe'; parameters = @(@{ name = 'groupId'; value = $teamsGroupId }, @{ name = 'channelId'; value = $teamsChannelId }) },
    @{ functionName = 'OnGroupMembershipAdd';            operationName = 'OnGroupMembershipAdd';            parameters = @(@{ name = 'groupId'; value = $teamsGroupId }) },
    @{ functionName = 'OnGroupMembershipRemoval';        operationName = 'OnGroupMembershipRemoval';        parameters = @(@{ name = 'groupId'; value = $teamsGroupId }) }
)

# --- Authorize the Teams connection (OAuth consent) -------------------------
# Portal authorization UX is not yet available for Connector Namespace
# connections, so we drive OAuth consent through the CLI:
#   1. `connection list-consent-links` returns a one-shot consent URL.
#   2. We open it in a browser; the user signs in.
#   3. Poll `connection show` until overallStatus = `Connected`.
# Authorization runs BEFORE trigger creation: trigger create fails if the
# connection isn't Connected.
function Test-ConnectionExists {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    az connector-namespace connection show `
        -g $resourceGroupName --namespace $connectorNamespaceName `
        -n $ConnectionName -o none 2>$null
    return ($LASTEXITCODE -eq 0)
}

function New-TeamsConnection {
    param([Parameter(Mandatory)] [string] $ConnectionName)
    Write-Host "-> Creating Teams connection '$ConnectionName' on namespace '$connectorNamespaceName'..." -ForegroundColor Yellow
    az connector-namespace connection create `
        -g $resourceGroupName `
        --namespace $connectorNamespaceName `
        -n $ConnectionName `
        --connector-name 'teams'
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
        if (-not (New-TeamsConnection -ConnectionName $ConnectionName)) {
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

    # az CLI parses inline strings starting with '[' as its shorthand syntax,
    # which mangles JSON containing ':' (URLs). Pass JSON via a temp file (@path).
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
Write-Host "Authorizing Microsoft Teams connection via Azure CLI..." -ForegroundColor Yellow
$authorized = Invoke-AuthorizeConnection -ConnectionName $teamsConnectionName -Description "Microsoft Teams"
if (-not $authorized) {
    Write-Host ""
    Write-Host "ERROR: Microsoft Teams connection is not Connected. Cannot create triggers." -ForegroundColor Red
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

$connectionDetails = (@{ connectorName = 'teams'; connectionName = $teamsConnectionName } | ConvertTo-Json -Compress)
$script:triggerFailures = @()

# az CLI parses inline values starting with '[' or '{' using shorthand syntax,
# which mangles JSON containing ':' (URLs). Always pass JSON via temp files (@path).
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

    $triggerName = "$teamsConnectionName-$($functionName.ToLower())"
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
            --description "Teams $operationName -> $functionName"
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
