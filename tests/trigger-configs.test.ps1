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
const metadata = { operations: {}, folderPaths: {} };
for (const [prefix, sdk] of [['Office365', office365], ['Sharepointonline', sharepoint], ['Onedriveforbusiness', onedrive]]) {
    metadata.operations[prefix] = Object.fromEntries(Object.entries(sdk[`${prefix}TriggerOperations`]).map(([key, operation]) => [
        operation, Object.values(sdk[`${prefix}TriggerParameters`][key]).map(({ name, type, required }) => ({ name, type, required })),
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

Push-Location (Join-Path $root 'teamsApp')
try {
    $json = $metadataScript | node --input-type=module -
    Assert-Condition ($LASTEXITCODE -eq 0) 'Unable to load trigger metadata from the installed SDK.'
    $metadata = $json | ConvertFrom-Json -AsHashtable
} finally {
    Pop-Location
}

function Get-TriggerConfigurations {
    param([string] $App, [hashtable] $Values)
    $ast = Read-ScriptAst (Join-Path $root "$App\infra\scripts\postdeploy.ps1")
    $variables = @('triggers', 'sharedMailboxAddress', 'sharepointListId', 'sharepointLibraryId', 'sharepointFormId', 'sharepointDigestSchedule')
    $statements = @($ast.EndBlock.Statements | Where-Object {
        ($_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.VariablePath.UserPath -in $variables) -or
        ($_ -is [System.Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.Contains('$triggers +='))
    })
    Assert-Condition ($statements.Count -gt 0) "No trigger configuration statements found in $App."
    # Never execute consent, CLI operations, or interactive pickers from a hook.
    foreach ($statement in $statements) {
        foreach ($command in $statement.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)) {
            Assert-Condition ($command.GetCommandName() -eq 'Write-Host') "Unexpected command in a trigger configuration block: $command"
        }
    }
    $outputs = [pscustomobject] $Values
    $sharepointSiteAddress = 'https://example.sharepoint.com/sites/test'
    $onedriveFolderId = 'test-folder'
    $triggers = @()
    Invoke-Expression (($statements | ForEach-Object { $_.Extent.Text }) -join "`n") 6>$null
    return $triggers
}

$cases = @(
    @{ app = 'office365App'; sdk = 'Office365'; label = 'default'; count = 7; values = @{} },
    @{ app = 'office365App'; sdk = 'Office365'; label = 'shared mailbox'; count = 8; values = @{ OFFICE365_SHARED_MAILBOX_ADDRESS = 'shared@example.com' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'default'; count = 0; values = @{} },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'list'; count = 4; values = @{ SHAREPOINT_LIST_ID = 'test-list' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'library'; count = 4; values = @{ SHAREPOINT_LIBRARY_ID = 'test-library' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'list and library'; count = 8; values = @{ SHAREPOINT_LIST_ID = 'test-list'; SHAREPOINT_LIBRARY_ID = 'test-library' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'form'; count = 5; values = @{ SHAREPOINT_LIST_ID = 'test-list'; SHAREPOINT_FORM_ID = 'test-form' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'digest'; count = 5; values = @{ SHAREPOINT_LIST_ID = 'test-list'; SHAREPOINT_DIGEST_SCHEDULE = 'test-schedule' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'all'; count = 10; values = @{ SHAREPOINT_LIST_ID = 'test-list'; SHAREPOINT_LIBRARY_ID = 'test-library'; SHAREPOINT_FORM_ID = 'test-form'; SHAREPOINT_DIGEST_SCHEDULE = 'test-schedule' } },
    @{ app = 'sharepointApp'; sdk = 'Sharepointonline'; label = 'form and digest without list'; count = 0; values = @{ SHAREPOINT_FORM_ID = 'test-form'; SHAREPOINT_DIGEST_SCHEDULE = 'test-schedule' } },
    @{ app = 'onedriveApp'; sdk = 'Onedriveforbusiness'; label = 'metadata'; count = 2; values = @{} }
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
    $names = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($config in $configs) {
        if ($case.app -eq 'sharepointApp') {
            Assert-Condition ($config.operationName -notin @('OnNewFile', 'OnUpdatedFile')) "$label must not configure deprecated file triggers."
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
        $selected = Select-OneDriveFolderInteractive -CurrentSavedId '' 6>$null
        Assert-Condition ($selected -eq 'leaf/+id') 'OneDrive must support root arrays and paged folder bodies.'
        $expected = @($metadata.folderPaths.root, $metadata.folderPaths.child, $metadata.folderPaths.leaf)
        Assert-Condition (($state.paths -join '|') -eq ($expected -join '|')) 'OneDrive folder paths must match SDK double-encoding and foldersV2 routes.'
        Write-Output 'PASS: OneDrive root and paged folder selection matches SDK routes'
    }
}

Test-OneDriveFolderPicker
Test-OneDriveFolderPicker -InvalidPayload
