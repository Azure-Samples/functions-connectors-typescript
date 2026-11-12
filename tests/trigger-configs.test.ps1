# Copyright (c) .NET Foundation. All rights reserved.
# Licensed under the MIT License.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Assert-Condition {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw $Message }
}

function Read-ScriptAst {
    param([string] $Path)
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref] $tokens, [ref] $errors)
    Assert-Condition ($errors.Count -eq 0) "PowerShell syntax errors in ${Path}: $errors"
    return $ast
}

$metadataScript = @'
import * as office365 from '@azure/connectors/generated/Office365Extensions';
import * as sharepoint from '@azure/connectors/generated/SharepointonlineExtensions';
import * as onedrive from '@azure/connectors/generated/OnedriveforbusinessExtensions';
import * as teams from '@azure/connectors/generated/TeamsExtensions';
const metadata = { operations: {}, folderPaths: {} };
for (const [prefix, sdk] of [['Office365', office365], ['Sharepointonline', sharepoint], ['Onedriveforbusiness', onedrive], ['Teams', teams]]) {
    metadata.operations[prefix] = Object.fromEntries(Object.entries(sdk[`${prefix}TriggerOperations`]).map(([key, operation]) => [
        operation, Object.values(sdk[`${prefix}TriggerParameters`][key] ?? {}).map(({ name, type, required }) => ({ name, type, required })),
    ]));
}
const client = new onedrive.OnedriveforbusinessClient('https://example.azureconnectors.com', {
    getToken() { throw new Error('Offline route inspection must not authenticate.'); },
});
// Inspect the real SDK route construction without making a request.
client.createPageable = (requestPath) => requestPath;
metadata.folderPaths = {
    root: client.listRootFolder(),
    child: client.listFolder('child/+id'),
    leaf: client.listFolder('leaf/+id'),
};
console.log(JSON.stringify(metadata));
'@

Push-Location (Join-Path $root 'teamsApp/webhook')
try {
    $json = $metadataScript | node --input-type=module -
    Assert-Condition ($LASTEXITCODE -eq 0) 'Unable to load trigger metadata from the installed SDK.'
    $metadata = $json | ConvertFrom-Json -AsHashtable
} finally {
    Pop-Location
}

function Get-TriggerConfigurations {
    param([string] $App, [hashtable] $Values)
    $project = if ($App -in @('office365App', 'sharepointApp', 'teamsApp')) { "$App\webhook" } else { $App }
    $ast = Read-ScriptAst (Join-Path $root "$project\infra\scripts\postdeploy.ps1")
    $variables = @('triggers', 'sharedMailboxAddress', 'sharepointListName', 'sharepointLibraryName', 'sharepointFolderPath', 'sharepointEnableDeletionTriggers', 'sharepointEnableSyntexTrigger', 'sharepointFormId', 'sharepointDigestSchedule', 'listParameters', 'libraryParameters')
    $statements = @($ast.EndBlock.Statements | Where-Object {
        ($_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -in $variables) -or
        ($_ -is [System.Management.Automation.Language.IfStatementAst] -and ($_.Extent.Text.Contains('$triggers +=') -or $_.Extent.Text.Contains('$libraryParameters +=')))
    })
    Assert-Condition ($statements.Count -gt 0) "No trigger configuration statements found in $App."
    # Never execute consent, CLI operations, or interactive pickers from a hook.
    foreach ($statement in $statements) {
        foreach ($command in $statement.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)) {
            Assert-Condition ($command.GetCommandName() -eq 'Write-Host') "Unexpected command in a trigger configuration block: $command"
        }
    }
    $defaults = @{ sharepointLibraryName = 'Documents'; sharepointListName = 'Documents' }
    foreach ($key in $Values.Keys) { $defaults[$key] = $Values[$key] }
    $outputs = [pscustomobject] $defaults
    $sharepointSiteAddress = 'https://example.sharepoint.com/sites/test'
    $onedriveFolderId = 'test-folder'
    $teamsGroupId = 'test-team'
    $teamsChannelId = 'test-channel'
    $triggers = @()
    Invoke-Expression (($statements | ForEach-Object { $_.Extent.Text }) -join "`n") 6>$null
    return $triggers
}

$cases = @(
    @{ app = 'office365App'; sdk = 'Office365'; label = 'default'; count = 7; values = @{} },
    @{ app = 'office365App'; sdk = 'Office365'; label = 'shared mailbox'; count = 8; values = @{ OFFICE365_SHARED_MAILBOX_ADDRESS = 'shared@example.com' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'default'; count = 5; values = @{} },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'list and library'; count = 5; values = @{ sharepointListName = 'Tasks'; sharepointLibraryName = 'Archive' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'deletion'; count = 7; values = @{ sharepointEnableDeletionTriggers = 'true' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'syntex'; count = 6; values = @{ sharepointEnableSyntexTrigger = 'true' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'form'; count = 6; values = @{ sharepointFormId = 'test-form' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'digest'; count = 6; values = @{ sharepointDigestSchedule = '*' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'all'; count = 10; values = @{ sharepointListName = 'Tasks'; sharepointLibraryName = 'Archive'; sharepointFolderPath = '/Shared Documents/Test'; sharepointEnableDeletionTriggers = 'true'; sharepointEnableSyntexTrigger = 'true'; sharepointFormId = 'test-form'; sharepointDigestSchedule = '*' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'false strings'; count = 5; values = @{ sharepointEnableDeletionTriggers = 'false'; sharepointEnableSyntexTrigger = 'false' } },
    @{ app = 'onedriveApp'; sdk = 'Onedriveforbusiness'; label = 'content and metadata'; count = 4; values = @{} },
    @{ app = 'teamsApp'; sdk = 'Teams'; label = 'original triggers before interactive webhook setup'; count = 4; values = @{} }
)

foreach ($case in $cases) {
    $configs = @(Get-TriggerConfigurations -App $case.app -Values $case.values)
    $label = "$($case.app): $($case.label)"
    Assert-Condition ($configs.Count -eq $case.count) "$label must configure $($case.count) triggers, not $($configs.Count)."
    if ($case.app -eq 'office365App') {
        $calendarConfigs = @($configs | Where-Object { $_.operationName -eq 'CalendarGetOnNewItemsV3' })
        Assert-Condition ($calendarConfigs.Count -eq 1) "$label must configure exactly one new-calendar subscription."
        Assert-Condition ($calendarConfigs[0].functionName -eq 'OnCalendarNewItems') "$label must route new calendar events to OnCalendarNewItems."
    }
    if ($case.app -eq 'onedriveApp') {
        $operations = @($configs.operationName | Sort-Object)
        $expected = @('OnNewFileV2', 'OnNewFilesV2', 'OnUpdatedFileV2', 'OnUpdatedFilesV2') | Sort-Object
        Assert-Condition (($operations -join '|') -ceq ($expected -join '|')) "$label must configure both content and both metadata operations."
        foreach ($config in $configs) {
            $folder = @($config.parameters | Where-Object { $_.name -eq 'folderId' })
            Assert-Condition ($folder.Count -eq 1 -and $folder[0].value -eq 'test-folder') "$label must use the selected folder for every subscription."
        }
    }
    $names = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($config in $configs) {
        if ($case.app -eq 'sharepointApp') {
            Assert-Condition ($config.operationName -notin @('OnNewFile', 'OnUpdatedFile')) "$label must not configure deprecated file triggers."
            $library = $config.functionName -match 'File|Digest'
            $table = @($config.parameters | Where-Object name -EQ 'table')
            $expectedTable = if ($library -and $case.values.sharepointLibraryName) { $case.values.sharepointLibraryName } elseif (-not $library -and $case.values.sharepointListName) { $case.values.sharepointListName } else { 'Documents' }
            Assert-Condition ($table.Count -eq 1 -and $table[0].value -eq $expectedTable) "$label must select the configured list or library."
            $folder = @($config.parameters | Where-Object name -EQ 'folderPath')
            if ($library -and $case.values.sharepointFolderPath) {
                Assert-Condition ($folder.Count -eq 1 -and $folder[0].value -eq $case.values.sharepointFolderPath) "$label must apply the folder filter to file/digest triggers."
            } else {
                Assert-Condition ($folder.Count -eq 0) "$label must not filter whole-list item/form triggers by folder."
            }
        }
        Assert-Condition ($names.Add($config.functionName)) "$label has a duplicate function name."
        $descriptors = $metadata.operations[$case.sdk][$config.operationName]
        Assert-Condition ($null -ne $descriptors) "$label uses an unknown SDK operation: $($config.operationName)"
        foreach ($descriptor in $descriptors | Where-Object { $_.required }) {
            $matches = @($config.parameters | Where-Object { $_.name -eq $descriptor.name })
            Assert-Condition ($matches.Count -eq 1) "$label / $($config.functionName) must supply $($descriptor.name) exactly once."
        }
        foreach ($parameter in $config.parameters) {
            $descriptor = @($descriptors | Where-Object { $_.name -eq $parameter.name })
            Assert-Condition ($descriptor.Count -eq 1) "$label has an unknown parameter: $($parameter.name)"
            $valid = switch ($descriptor[0].type) {
                'string' { $parameter.value -is [string] -and -not [string]::IsNullOrWhiteSpace($parameter.value) }
                'integer' { $parameter.value -is [int] -or $parameter.value -is [long] }
                'boolean' { $parameter.value -is [bool] }
                default { throw "Unsupported SDK parameter type: $($descriptor[0].type)" }
            }
            Assert-Condition $valid "$label / $($parameter.name) has the wrong value type."
        }
    }
    Write-Output "PASS: $label ($($configs.Count) triggers)"
}

function Test-SharepointSiteEntry {
    $hook = Get-Content -Raw (Join-Path $root 'sharepointApp\webhook\infra\scripts\postdeploy.ps1')
    $end = $hook.IndexOf('# --- Verify the connector-namespace')
    Assert-Condition ($end -gt 0) 'Isolate SharePoint configuration before connector setup.'
    function az { throw 'Site configuration must not call Azure CLI for Graph discovery.' }
    function azd {
        $call = $args -join ' '
        if ($call -eq 'env get-values --output json') {
            return (@{
                resourceGroupName = 'test'
                connectorNamespaceName = 'test'
                sharepointConnectionName = 'test'
                functionAppName = 'test'
                sharepointSiteUrl = 'https://example.sharepoint.com/sites/test'
            } | ConvertTo-Json -Compress)
        }
        throw "Unexpected azd call: $call"
    }
    function Read-Host {
        throw 'Deployment setup must not prompt for a site URL.'
    }
    Invoke-Expression $hook.Substring(0, $end) 6>$null
    Assert-Condition ($sharepointSiteAddress -eq 'https://example.sharepoint.com/sites/test') 'Read the provisioned site URL without prompting or changing the environment.'
    Write-Output 'PASS: SharePoint provisioned site configuration without prompts or Graph'
}

Test-SharepointSiteEntry

function Test-SharepointTriggerSetup {
    $state = @{ calls = [Collections.Generic.List[object]]::new() }
    function azd {
        Assert-Condition (($args -join ' ') -eq 'env get-values --output json') 'Setup must only read provisioned azd values.'
        return (@{
            resourceGroupName = 'test'
            connectorNamespaceName = 'test'
            sharepointConnectionName = 'sharepoint-test'
            functionAppName = 'test'
            sharepointSiteUrl = 'https://example.sharepoint.com/sites/test'
            sharepointLibraryName = 'Documents'
            sharepointListName = 'Documents'
            sharepointEnableDeletionTriggers = 'false'
            sharepointEnableSyntexTrigger = 'false'
        } | ConvertTo-Json -Compress)
    }
    function az {
        $global:LASTEXITCODE = 0
        $call = $args[0..2] -join ' '
        switch ($call) {
            'extension show --name' { return 'connector-namespace' }
            'connector-namespace connection show' {
                if ($args -notcontains 'none') { return 'Connected' }
                return
            }
            'functionapp keys list' { return 'offline-test-key' }
            'connector-namespace trigger list' { return '["sharepoint-test-onsharepointnewitems","sharepoint-test-onsharepointdeleteditems"]' }
            { $_ -in @('connector-namespace trigger create', 'connector-namespace trigger update') } {
                $name = $args[[array]::IndexOf($args, '-n') + 1]
                $status = $args[[array]::IndexOf($args, '--state') + 1]
                $parameters = if ($status -eq 'Enabled') {
                    $path = $args[[array]::IndexOf($args, '--parameters') + 1].TrimStart('@')
                    Get-Content -Raw $path | ConvertFrom-Json
                } else { @() }
                $state.calls.Add(@{ verb = $args[2]; name = $name; status = $status; parameters = $parameters })
                return
            }
            default { throw "Unexpected Azure call: $call" }
        }
    }
    function Read-Host { throw 'Post-deployment setup must not prompt for configuration.' }
    & (Join-Path $root 'sharepointApp/webhook/infra/scripts/postdeploy.ps1') 6>$null
    $enabled = @($state.calls | Where-Object status -EQ 'Enabled')
    $disabled = @($state.calls | Where-Object status -EQ 'Disabled')
    Assert-Condition ($enabled.Count -eq 5) 'PowerShell must configure five default subscriptions.'
    $updated = @($enabled | Where-Object verb -EQ 'update')
    Assert-Condition ($updated.Count -eq 1 -and $updated[0].name -eq 'sharepoint-test-onsharepointnewitems') 'Update an existing selected trigger without deleting it.'
    Assert-Condition ($disabled.Count -eq 1 -and $disabled[0].name -eq 'sharepoint-test-onsharepointdeleteditems') 'Disable a deselected optional trigger without deleting it.'
    foreach ($config in $enabled) {
        $table = @($config.parameters | Where-Object name -EQ 'table')
        Assert-Condition ($table.Count -eq 1 -and $table[0].value -eq 'Documents') 'Default subscriptions must target Documents.'
    }
    Write-Output 'PASS: SharePoint PowerShell default setup, existing-trigger update, and opt-in deselection'
}

Test-SharepointTriggerSetup

function Test-BlobManagedIdentityConfiguration {
    $ast = Read-ScriptAst (Join-Path $root 'azureblobApp\infra\scripts\postdeploy.ps1')
    $outputs = [pscustomobject] @{
        CONNECTOR_NAMESPACE_LOCATION = 'brazilsouth'
        connectorNamespacePrincipalId = 'namespace-principal'
        monitoredStorageAccountName = 'testmonitoredaccount'
        monitoredContainerName = 'testcontainer'
    }
    $variables = @('namespaceLocation', 'namespacePrincipalId', 'accountInput', 'containerInput', 'urlEncodedPath', 'folderIdBytes', 'folderId', 'triggers')
    foreach ($statement in $ast.EndBlock.Statements) {
        if ($statement -is [System.Management.Automation.Language.AssignmentStatementAst] -and $statement.Left.VariablePath.UserPath -in $variables) {
            Invoke-Expression $statement.Extent.Text
        }
    }
    Assert-Condition ($triggers.Count -eq 1) 'Blob must configure one trigger.'
    $dataset = @($triggers[0].parameters | Where-Object name -eq 'dataset')
    $folder = @($triggers[0].parameters | Where-Object name -eq 'folderId')
    Assert-Condition ($dataset.Count -eq 1 -and $dataset[0].value -eq 'testmonitoredaccount') 'Blob must watch the provisioned monitored account.'
    Assert-Condition ($folder.Count -eq 1 -and [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($folder[0].value)) -ceq '%2Ftestcontainer') 'Blob must encode the provisioned testcontainer path.'
    Assert-Condition (@($ast.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Read-Host'
    }, $true)).Count -eq 0) 'MI setup must not prompt for credentials.'

    $definition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-ConnectionManagedIdentityAuth'
    }, $false)
    Assert-Condition ($null -ne $definition) 'Blob MI request builder not found.'
    $state = @{ exitCode = 0; path = ''; body = $null }
    function az {
        $cliArgs = @($args)
        $index = [Array]::IndexOf($cliArgs, '--body')
        Assert-Condition ($index -ge 0) 'Expected a connection PUT request.'
        $state.path = $cliArgs[$index + 1].Substring(1)
        $state.body = Get-Content -Raw $state.path | ConvertFrom-Json
        $global:LASTEXITCODE = $state.exitCode
    }
    Invoke-Expression $definition.Extent.Text
    foreach ($exitCode in @(0, 1)) {
        $state.exitCode = $exitCode
        $success = Set-ConnectionManagedIdentityAuth
        Assert-Condition ($success -eq ($exitCode -eq 0)) 'Blob MI builder must propagate Azure PUT failures.'
        Assert-Condition (-not (Test-Path $state.path)) 'Blob MI request file must be removed after success or failure.'
        Assert-Condition ($state.body.location -eq 'brazilsouth') 'Connection location must match the namespace, not the Function App.'
        Assert-Condition ($state.body.properties.parameterValueSet.name -eq 'managedIdentityAuth') 'Blob must use MI authentication.'
        Assert-Condition (@($state.body.properties.parameterValueSet.values.PSObject.Properties).Count -eq 0) 'Blob MI must not send user credentials.'
        Assert-Condition ($state.body.properties.connectionProperties.authentication.type -eq 'ManagedServiceIdentity') 'Blob must configure managed service identity authentication.'
        Assert-Condition ($null -eq $state.body.properties.connectionProperties.authentication.identity) 'System-assigned auth must not specify another identity.'
    }
    Write-Output 'PASS: Blob namespace MI payload, cleanup, and provisioned test storage'
}

Test-BlobManagedIdentityConfiguration

function Test-BlobConnectionReadiness {
    $ast = Read-ScriptAst (Join-Path $root 'azureblobApp\infra\scripts\postdeploy.ps1')
    $state = @{ mode = '' }
    function az {
        $call = $args -join ' '
        $global:LASTEXITCODE = 0
        if ($call -like 'connector-namespace connection show *') { return $state.mode }
        throw "Unexpected Azure command: $call"
    }
    $waitDefinition = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-ConnectionReady'
    }, $false)
    Invoke-Expression $waitDefinition.Extent.Text
    foreach ($status in @('Ready', 'Connected', 'Error')) {
        $state.mode = $status
        Assert-Condition ((Wait-ConnectionReady -TimeoutSeconds 1 6>$null) -eq $status) 'Return terminal MI connection status.'
    }
    Write-Output 'PASS: Blob managed identity connection readiness'
}

Test-BlobConnectionReadiness

function Test-OneDriveFolderPicker {
    param([switch] $InvalidPayload)
    $ast = Read-ScriptAst (Join-Path $root 'onedriveApp\infra\scripts\postdeploy.ps1')
    $selector = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Select-OneDriveFolderInteractive'
    }, $false)
    Assert-Condition ($null -ne $selector) 'OneDrive folder picker not found.'
    $state = @{ step = 0; paths = [System.Collections.Generic.List[string]]::new() }
    function Invoke-ConnectionRequest {
        param([string] $Path)
        $state.paths.Add($Path)
        if ($InvalidPayload) { return [pscustomobject] @{ value = 'invalid' } }
        switch ($state.step) {
            0 { return ,@([pscustomobject] @{ Id = 'child/+id'; Name = 'Child'; IsFolder = $true }) }
            1 { return [pscustomobject] @{ value = @([pscustomobject] @{ Id = 'leaf/+id'; Name = 'Leaf'; IsFolder = $true }) } }
            2 { return [pscustomobject] @{ value = @() } }
            default { throw 'Unexpected folder request.' }
        }
    }
    function Select-FromList {
        param([string] $Title, [object[]] $Items, [string] $LabelProperty)
        Assert-Condition (-not $InvalidPayload) 'The picker must abort an invalid listing before prompting.'
        Assert-Condition (@($Items | Where-Object { $_.targetId -eq 'root' }).Count -eq 0) 'The root placeholder must never be selectable or reusable.'
        if ($state.step -eq 0) {
            Assert-Condition (@($Items | Where-Object { $_.action -eq 'pick' -or $_.action -eq 'keep' }).Count -eq 0) 'The drive root must only be a navigation entry point.'
        }
        $action = if ($state.step -lt 2) { 'down' } else { 'pick' }
        $choices = @($Items | Where-Object { $_.action -eq $action })
        Assert-Condition ($choices.Count -eq 1) 'The folder picker must expose the returned folder.'
        $state.step++
        return $choices[0]
    }
    Invoke-Expression $selector.Extent.Text
    if ($InvalidPayload) {
        $records = @(Select-OneDriveFolderInteractive -CurrentSavedId '' 6>&1)
        Assert-Condition ([bool]($records | Where-Object { "$_" -like '*ERROR: Unexpected OneDrive folder listing*' })) 'Invalid listing must produce an explicit error.'
        Assert-Condition ($state.paths.Count -eq 1) 'Invalid listing must stop folder traversal.'
        Write-Output 'PASS: OneDrive invalid listing is reported'
    } else {
        $selected = Select-OneDriveFolderInteractive -CurrentSavedId 'root' 6>$null
        Assert-Condition ($selected -eq 'leaf/+id') 'OneDrive must support root arrays and paged folder bodies.'
        $expected = @($metadata.folderPaths.root, $metadata.folderPaths.child, $metadata.folderPaths.leaf)
        Assert-Condition (($state.paths -join '|') -eq ($expected -join '|')) 'OneDrive folder paths must match SDK double-encoding and foldersV2 routes.'
        Write-Output 'PASS: OneDrive root and paged folder selection matches SDK routes'
    }
}

Test-OneDriveFolderPicker
Test-OneDriveFolderPicker -InvalidPayload

function Test-OneDriveManualFolderId {
    param([string] $ManualId)
    $ast = Read-ScriptAst (Join-Path $root 'onedriveApp\infra\scripts\postdeploy.ps1')
    $selector = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Select-OneDriveFolderInteractive'
    }, $false)
    $state = @{ step = 0 }
    function Invoke-ConnectionRequest { return ,@() }
    function Read-Host { return $ManualId }
    function Select-FromList {
        param([string] $Title, [object[]] $Items, [string] $LabelProperty)
        $action = if ($state.step++ -eq 0) { 'manual' } else { 'cancel' }
        return $Items | Where-Object { $_.action -eq $action }
    }
    Invoke-Expression $selector.Extent.Text
    $selected = Select-OneDriveFolderInteractive -CurrentSavedId '' 6>$null
    if ($ManualId.Trim() -eq 'root') {
        Assert-Condition ($null -eq $selected -and $state.step -eq 2) 'A manually entered root must be rejected before cancellation.'
    } else {
        Assert-Condition ($selected -eq $ManualId -and $state.step -eq 1) 'A real manual connector ID must remain selectable.'
    }
    Write-Output 'PASS: OneDrive manual folder ID validation'
}

Test-OneDriveManualFolderId -ManualId ' root '
Test-OneDriveManualFolderId -ManualId 'manual-folder-id'
