// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { webhookTriggers } from '../teamsApp/infra/scripts/setup-webhook-triggers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const samples = {
    azureblobApp: ['OnAzureBlobUpdatedFile'],
    dataflowsApp: ['OnDataflowRefreshComplete'],
    genericApp: ['OnGenericAzureBlobUpdated', 'OnGenericCustomConnectorEvent', 'OnGenericOffice365NewEmail', 'OnGenericOffice365NewEmailPoll', 'OnGenericSharepointNewFile', 'OnGenericTeamsChannelMessage'],
    office365App: ['OnCalendarChangedItems', 'OnCalendarNewItems', 'OnCalendarUpdatedItems', 'OnFlaggedEmail', 'OnNewEmail', 'OnNewEmailPoll', 'OnNewMentionMeEmail', 'OnSharedMailboxNewEmail', 'OnUpcomingEvent'],
    onedriveApp: ['OnOneDriveNewFile', 'OnOneDriveUpdatedFile', 'OnOneDriveNewFileContent', 'OnOneDriveUpdatedFileContent'],
    plannerApp: ['OnPlannerCompleteTask', 'OnPlannerNewTask', 'OnPlannerTaskAssignedToMe'],
    salesforceApp: ['OnSalesforceNewItems', 'OnSalesforceUpdatedItems'],
    sharepointApp: [
        'OnSharepointChangedItems', 'OnSharepointDeletedFileItems', 'OnSharepointDeletedItems',
        'OnSharepointNewFileItems', 'OnSharepointNewItems',
        'OnSharepointNewItemsFromForm', 'OnSharepointRecurrenceDigest',
        'OnSharepointUpdatedFileClassifiedTimes', 'OnSharepointUpdatedFileItems', 'OnSharepointUpdatedItems',
    ],
    teamsApp: [
        'OnGroupMembershipAdd', 'OnGroupMembershipRemoval', 'OnNewChannelMessage', 'OnNewChannelMessageMentioningMe',
        'OnWebhookAtMention', 'OnWebhookMessageReaction', 'OnTranscriptAvailable', 'OnRecordingAvailable',
        'OnWebhookChatMessage', 'OnWebhookKeyword', 'OnWebhookNewMessage',
    ],
    vstsApp: [
        'OnVstsBuildCompleted', 'OnVstsGitPullClosed', 'OnVstsGitPullCreated', 'OnVstsGitPush',
        'OnVstsTfvcCheckIn', 'OnVstsWorkItemAssigned', 'OnVstsWorkItemClosed',
        'OnVstsWorkItemCreated', 'OnVstsWorkItemUpdated',
    ],
};
const pollingSamples = {
    genericApp: { name: 'OnGenericOffice365NewEmailPoll', file: 'onGenericOffice365NewEmailPoll.js', maxBatchSize: 1, maxConcurrentCalls: 4 },
    office365App: { name: 'OnNewEmailPoll', file: 'onNewEmailPoll.js', cardinality: 'many', maxBatchSize: 4 },
};
const connectorSamples = {
    dataflowsApp: { namespace: 'dataflows', sdk: 'Dataflows' },
    office365App: { namespace: 'office365', sdk: 'Office365' },
    onedriveApp: { namespace: 'onedriveforbusiness', sdk: 'Onedriveforbusiness' },
    plannerApp: { namespace: 'planner', sdk: 'Planner' },
    salesforceApp: { namespace: 'salesforce', sdk: 'Salesforce' },
    sharepointApp: { namespace: 'sharepoint', sdk: 'Sharepointonline' },
    teamsApp: { namespace: 'teams', sdk: 'Teams' },
    vstsApp: { namespace: 'vsts', sdk: 'Visualstudioteamservices' },
};
const dependencies = {
    '@azure/connectors': '0.4.0-preview',
    '@azure/functions': '^4.17.1',
    '@azure/functions-extensions-connectors': '0.2.0-preview',
};
const appsWithHooks = new Set(['office365App', 'onedriveApp', 'sharepointApp', 'teamsApp']);
const publishedApis = new Set();
const coveredApis = new Set();
const excludedApis = new Set(['sharepoint.onNewFile', 'sharepoint.onUpdatedFile', 'office365.onNewCalendarEvent', 'kusto.onQueryResult']);
const oneDriveContentOperations = {
    OnOneDriveNewFileContent: 'OnNewFile',
    OnOneDriveUpdatedFileContent: 'OnUpdatedFile',
};

function itemFor(appName, name, index) {
    const marker = `sample-item-${index}`;
    if (appName === 'teamsApp' && webhookTriggers.some((trigger) => trigger.functionName === name)) {
        if (name === 'OnWebhookChatMessage') return { messageId: marker, conversationId: 'test-chat' };
        if (name === 'OnWebhookMessageReaction') return { messageId: marker, messageReaction: 'test-reaction', threadType: 'groupchat' };
        if (name === 'OnTranscriptAvailable') return { id: marker, meetingId: 'test-meeting', transcriptContentUrl: 'https://example.com/transcript' };
        if (name === 'OnRecordingAvailable') return { id: marker, meetingId: 'test-meeting', recordingContentUrl: 'https://example.com/recording' };
        return { eventId: marker, message: { arbitraryField: marker } };
    }
    if (/Email|Calendar|Upcoming/.test(name)) {
        return { id: marker, subject: marker, from: 'sender@example.com', importance: 'normal', hasAttachments: false, organizer: 'organizer@example.com', start: '2026-10-23T10:00:00Z', end: '2026-10-23T11:00:00Z', ActionType: 'updated', IsUpdated: true };
    }
    if (/Message/.test(name)) {
        return { id: marker, from: { user: { displayName: marker } }, body: { content: marker } };
    }
    if (appName === 'dataflowsApp') {
        return { dataflowId: marker, dataflowName: marker, status: 'Success', startTime: '2026-10-23T10:00:00Z', endTime: '2026-10-23T11:00:00Z' };
    }
    if (appName === 'plannerApp') {
        return { id: marker, title: marker, planId: 'test-plan', percentComplete: /Complete/.test(name) ? 100 : 0, _assignments: [{ userId: marker }] };
    }
    if (appName === 'sharepointApp' && /Deleted/.test(name)) {
        return { ID: index, Name: marker, FileNameWithExtension: marker, TimeDeleted: '2026-10-23T10:00:00Z', DeletedByUserName: 'test-user' };
    }
    if (appName === 'salesforceApp' || (appName === 'sharepointApp' && !/File$/.test(name))) {
        return { dynamicProperties: { record: { id: marker, title: marker } } };
    }
    if (appName === 'vstsApp') {
        if (/Build/.test(name)) {
            return { id: index, buildNumber: marker, status: 'completed', result: 'succeeded' };
        }
        if (/GitPull/.test(name)) {
            return { pullRequestId: index, title: marker, sourceRefName: 'refs/heads/test', targetRefName: 'refs/heads/main' };
        }
        if (/GitPush/.test(name)) {
            return { pushId: index, repository: { name: marker }, refUpdates: [{ name: 'refs/heads/test' }] };
        }
        if (/Tfvc/.test(name)) {
            return { changesetId: index, comment: marker, author: { displayName: 'test-user' } };
        }
        return { id: index, rev: 1, fields: { 'System.Title': marker, 'System.State': 'Active' } };
    }
    return { id: marker, name: marker, Name: marker, Path: `/files/${marker}`, Size: 42, LastModified: '2026-10-23T10:00:00Z' };
}

// Running from an app via npm test selects that app. Running from the repository
// root exercises all ten apps, each with its own installed dependencies.
const cwd = path.resolve(process.cwd());
const selected = Object.entries(samples).filter(([appName]) => cwd === path.resolve(root) || cwd === path.resolve(root, appName));
assert.ok(selected.length, 'Run tests from the repository root or a sample app directory.');
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'The connector extension requires Node.js 24+.');

for (const [appName, expectedNames] of selected) {
    await test(appName, async (t) => {
        const appRoot = path.join(root, appName);
        const require = createRequire(path.join(appRoot, 'package.json'));

        await t.test('manifests, lockfiles, and installed packages match the requested releases', async () => {
            const manifest = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
            const lock = JSON.parse(await readFile(path.join(appRoot, 'package-lock.json'), 'utf8'));
            assert.equal(manifest.engines.node, '>=24.0.0');
            for (const [name, version] of Object.entries(dependencies)) {
                const installed = JSON.parse(await readFile(path.join(appRoot, 'node_modules', name, 'package.json'), 'utf8'));
                assert.equal(manifest.dependencies[name], version);
                assert.equal(lock.packages[''].dependencies[name], version);
                assert.equal(lock.packages[`node_modules/${name}`].version, installed.version);
                assert.ok(!lock.packages[`node_modules/${name}`].resolved?.startsWith('file:'), 'Lockfiles must not depend on local tarball paths.');
                if (name === '@azure/functions') {
                    const match = installed.version.match(/^4\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/);
                    assert.ok(match, 'The sample requires a stable Functions v4 release.');
                    assert.ok(Number(match[1]) > 17 || (Number(match[1]) === 17 && Number(match[2]) >= 1), 'The sample requires Functions 4.17.1 or later.');
                } else {
                    assert.equal(installed.version, version);
                }
            }
            const extensionRequire = createRequire(require.resolve('@azure/functions-extensions-connectors'));
            assert.equal(extensionRequire.resolve('@azure/connectors'), require.resolve('@azure/connectors'), 'The extension and app must share the requested SDK.');
            // Check both published runtime entry points, not just TypeScript types.
            assert.equal(typeof require('@azure/connectors').ConnectorError, 'function');
            const esm = await import(pathToFileURL(path.join(appRoot, 'node_modules/@azure/connectors/dist/esm/azureConnectors/index.js')).href);
            assert.equal(typeof esm.ConnectorError, 'function');
        });

        await t.test('host and deployment runtime configuration match the extension', async () => {
            const azureYaml = await readFile(path.join(appRoot, 'azure.yaml'), 'utf8');
            const projectName = azureYaml.match(/^name:\s*(\S+)\s*$/m)?.[1];
            assert.ok(projectName && projectName.length >= 2, 'The azd project must have a name.');
            assert.match(projectName, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'The azd schema requires a lowercase project-name slug.');
            if (appsWithHooks.has(appName) && process.platform !== 'win32') {
                await assert.doesNotReject(
                    access(path.join(appRoot, 'infra/scripts/postdeploy.sh'), constants.X_OK),
                    'The POSIX postdeploy hook must be executable because azd invokes it directly.',
                );
            }
            const ignored = (await readFile(path.join(appRoot, '.funcignore'), 'utf8')).split(/\r?\n/);
            for (const entry of ['.azure/', 'local.settings.json', '__azurite_db_*.json', '__blobstorage__/', '__queuestorage__/']) {
                assert.ok(ignored.includes(entry), `Deployment packages must exclude ${entry}.`);
            }
            const host = JSON.parse(await readFile(path.join(appRoot, 'host.json'), 'utf8'));
            assert.equal(host.version, '2.0');
            assert.equal(host.extensionBundle.id, 'Microsoft.Azure.Functions.ExtensionBundle.Preview');
            const runtimeApp = connectorSamples[appName] && !appsWithHooks.has(appName) ? 'genericApp' : appName;
            const infrastructure = await readFile(path.join(root, runtimeApp, 'infra/resources.bicep'), 'utf8');
            assert.match(infrastructure, /runtime:\s*\{\s*name:\s*'node'\s*version:\s*'24'/);
        });

        const { app, trigger, DeliveryMode, Cardinality } = require('@azure/functions');
        const extensionManifest = JSON.parse(await readFile(path.join(appRoot, 'node_modules/@azure/functions-extensions-connectors/package.json'), 'utf8'));
        const extension = await import(pathToFileURL(path.join(appRoot, 'node_modules/@azure/functions-extensions-connectors', extensionManifest.module)).href);
        const original = app.connectorTrigger;
        const originalNamespaces = new Map(Object.entries(extension.connectors));
        const registrations = new Map();
        const apiCalls = new Map();
        // Observe which public helpers the samples actually call; the helpers
        // still execute their real normalization and named-context wrappers.
        for (const [namespace, methods] of originalNamespaces) {
            extension.connectors[namespace] = Object.fromEntries(Object.entries(methods).map(([method, register]) => {
                if (typeof register !== 'function') {
                    return [method, register];
                }
                const api = `${namespace}.${method}`;
                publishedApis.add(api);
                return [method, (name, options) => {
                    apiCalls.set(name, api);
                    coveredApis.add(api);
                    return register(name, options);
                }];
            }));
        }
        // Keep the real extension's normalization and named-context wrappers.
        // Replace only host registration; no Azure service or credentials are used.
        app.connectorTrigger = (name, options) => {
            assert.ok(!registrations.has(name), `Duplicate function: ${name}`);
            registrations.set(name, options);
        };
        const previousPollingEnabled = process.env.EnablePollingSamples;
        try {
            const functionsDir = path.join(appRoot, 'dist/functions');
            const polling = pollingSamples[appName];
            if (polling) {
                await t.test('polling samples are opt-in', async () => {
                    delete process.env.EnablePollingSamples;
                    await import(`${pathToFileURL(path.join(functionsDir, polling.file)).href}?disabled`);
                    assert.equal(registrations.size, 0, 'Unconfigured polling samples must not register listeners.');
                });
            }
            process.env.EnablePollingSamples = 'true';
            for (const file of (await readdir(functionsDir)).filter((file) => file.endsWith('.js')).sort()) {
                await import(pathToFileURL(path.join(functionsDir, file)).href);
            }
        } finally {
            if (previousPollingEnabled === undefined) {
                delete process.env.EnablePollingSamples;
            } else {
                process.env.EnablePollingSamples = previousPollingEnabled;
            }
            app.connectorTrigger = original;
            for (const [namespace, methods] of originalNamespaces) {
                extension.connectors[namespace] = methods;
            }
        }

        await t.test('all expected functions register', () => {
            assert.deepEqual([...registrations.keys()].sort(), [...expectedNames].sort());
        });

        await t.test('polling options reach the host without changing webhook defaults', () => {
            assert.deepEqual(DeliveryMode, { Webhook: 'Webhook', Poll: 'Poll' });
            assert.deepEqual(Cardinality, { One: 'one', Many: 'many' });
            const polling = pollingSamples[appName];
            for (const [name, { handler, ...options }] of registrations) {
                const binding = trigger.connectorTrigger(options);
                assert.equal(binding.deliveryMode, name === polling?.name ? DeliveryMode.Poll : DeliveryMode.Webhook);
                assert.equal(binding.cardinality, options.cardinality ?? Cardinality.One);
                if (name !== polling?.name) {
                    assert.equal(options.deliveryMode, undefined, `${name} must retain default Webhook delivery.`);
                    continue;
                }
                const { name: pollingName, file, ...batchOptions } = polling;
                assert.deepEqual(options, {
                    deliveryMode: DeliveryMode.Poll,
                    connection: 'ConnectorNamespace',
                    triggerConfigName: '%OnNewEmailPollTriggerConfigName%',
                    ...batchOptions,
                    targetPendingEventThreshold: 16,
                });
            }
        });

        await t.test('every public helper except deprecated operations and duplicate aliases is exercised', () => {
            const connector = connectorSamples[appName];
            const expected = connector
                ? Object.entries(originalNamespaces.get(connector.namespace))
                    .filter(([, register]) => typeof register === 'function')
                    .map(([method]) => `${connector.namespace}.${method}`)
                    .filter((api) => !excludedApis.has(api))
                : [];
            assert.deepEqual([...new Set(apiCalls.values())].sort(), expected.sort());
            const nonHelperCount = appName === 'onedriveApp' ? Object.keys(oneDriveContentOperations).length
                : appName === 'teamsApp' ? webhookTriggers.length : 0;
            assert.equal(apiCalls.size, connector ? expectedNames.length - nonHelperCount : 0);
        });

        if (['azureblobApp', 'onedriveApp'].includes(appName) && process.platform !== 'win32') {
            await t.test('request builders use portable temporary files and stop if creation fails', async () => {
                const hook = await readFile(path.join(appRoot, 'infra/scripts/postdeploy.sh'), 'utf8');
                const builders = appName === 'azureblobApp'
                    ? [
                        ['set_connection_managed_identity_auth', '', { location: 'test', properties: { connectorName: 'azureblob', parameterValueSet: { name: 'managedIdentityAuth', values: {} }, connectionProperties: { authentication: { type: 'ManagedServiceIdentity' } } } }],
                        ['set_connection_access_policy', "'test-policy' 'test-principal'", { properties: { principal: { type: 'ActiveDirectory', identity: { objectId: 'test-principal', tenantId: 'test' } } } }],
                    ]
                    : [['connection_invoke', "'/datasets/default/folders' 'get'", { method: 'get', path: '/datasets/default/folders' }]];
                for (const [name, args, expected] of builders) {
                    const definition = hook.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
                    assert.ok(definition, `Find ${name} without running the full hook.`);
                    for (const fail of [false, true]) {
                        const mocks = `
mktemp() {
    if [[ $# -ne 0 || '${fail}' == true ]]; then
        echo 'TEST: temporary file creation failed' >&2
        return 1
    fi
    local file
    file=$(command mktemp) || return 1
    echo "TEST: temporary file $file" >&2
    printf '%s\\n' "$file"
}
az() {
    echo 'TEST: Azure request' >&3
    while [[ $# -gt 0 ]]; do
        if [[ "$1" == --body || "$1" == --request ]]; then
            jq -c . "\${2#@}" >&3 || return 1
            echo '{"response":{"statusCode":"OK","body":[]}}'
            return 0
        fi
        shift
    done
    return 1
}
namespaceLocation=test
tenantId=test`;
                        const result = spawnSync('bash', ['-c', `exec 3>&2\n${mocks}\n${definition}\n${name} ${args}`], { encoding: 'utf8', timeout: 5000 });
                        assert.ifError(result.error);
                        assert.equal(result.status, fail ? 1 : 0, result.stderr);
                        if (fail) {
                            assert.doesNotMatch(result.stderr, /TEST: Azure request/);
                        } else {
                            assert.match(result.stderr, /TEST: Azure request/);
                            const payload = result.stderr.split('\n').find((line) => line.startsWith('{'));
                            assert.deepEqual(JSON.parse(payload), expected);
                            const file = result.stderr.match(/TEST: temporary file (.+)/)?.[1];
                            assert.ok(file);
                            await assert.rejects(access(file), { code: 'ENOENT' }, 'The request file must be removed.');
                        }
                    }
                }
            });
        }
        if (appName === 'azureblobApp' && process.platform !== 'win32') {
            await t.test('Blob hook uses namespace MI and provisioned test storage', () => {
                const values = {
                    resourceGroupName: 'test-rg', connectorNamespaceName: 'test-namespace',
                    azureblobConnectionName: 'test-connection', functionAppName: 'test-function',
                    CONNECTOR_NAMESPACE_LOCATION: 'brazilsouth', AZURE_LOCATION: 'westus3',
                    connectorNamespacePrincipalId: 'namespace-principal', functionAppPrincipalId: 'function-principal',
                    AZURE_PRINCIPAL_ID: 'deployer-principal',
                    monitoredStorageAccountName: 'testmonitoredaccount', monitoredContainerName: 'testcontainer',
                };
                const mocks = `
azd() {
    [[ "$*" == 'env get-values --output json' ]] || return 1
    printf '%s\\n' "$BLOB_TEST_OUTPUTS"
}
az() {
    local call="$*" body='' parameters=''
    echo "TEST: command $call" >&2
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --body) body="$2"; shift ;;
            --parameters) parameters="$2"; shift ;;
        esac
        shift
    done
    case "$call" in
        'account show '*) echo test ;;
        'extension show '*) echo connector-namespace ;;
        'rest --method put '*)
            echo "TEST: body $(jq -c . "\${body#@}")" >&2
            if [[ "$BLOB_TEST_FAILURE" == connection && "$call" != *accessPolicies* ]]; then return 1; fi
            if [[ "$BLOB_TEST_FAILURE" == policy && "$call" == *accessPolicies* ]]; then return 1; fi
            ;;
        'rest --method get '*) echo 'https://example.azureconnectors.com/runtime' ;;
        'connector-namespace connection show '*)
            if [[ "$BLOB_TEST_FAILURE" == ready ]]; then echo Ready
            else echo Connected; fi
            ;;
        'functionapp keys list '*) echo test-extension-key ;;
        'functionapp config appsettings set '*) ;;
        'connector-namespace trigger delete '*) ;;
        'connector-namespace trigger create '*)
            echo "TEST: parameters $parameters" >&2
            [[ "$BLOB_TEST_FAILURE" != trigger ]] || return 1
            ;;
        *) echo "Unexpected Azure command: $call" >&2; return 1 ;;
    esac
}
source "$BLOB_TEST_HOOK"`;
                for (const failure of ['', 'ready', 'missing', 'connection', 'policy', 'trigger']) {
                    const outputs = { ...values };
                    if (failure === 'missing') delete outputs.monitoredStorageAccountName;
                    const result = spawnSync('bash', ['-c', mocks], {
                        encoding: 'utf8', timeout: 5000,
                        env: {
                            ...process.env, BLOB_TEST_FAILURE: failure, BLOB_TEST_OUTPUTS: JSON.stringify(outputs),
                            BLOB_TEST_HOOK: path.join(appRoot, 'infra/scripts/postdeploy.sh'),
                        },
                    });
                    assert.ifError(result.error);
                    assert.equal(result.status, ['', 'ready'].includes(failure) ? 0 : 1, result.stdout + result.stderr);
                    assert.doesNotMatch(result.stderr, /Unexpected Azure command/);
                    assert.doesNotMatch(result.stderr, /TEST: command rest --method delete/);
                    const bodies = result.stderr.split('\n').filter((line) => line.startsWith('TEST: body '))
                        .map((line) => JSON.parse(line.slice('TEST: body '.length)));
                    if (failure === 'missing') {
                        assert.equal(bodies.length, 0, 'Missing outputs must stop before updating the connection.');
                    } else {
                        assert.deepEqual(bodies[0], {
                            location: 'brazilsouth',
                            properties: {
                                connectorName: 'azureblob', parameterValueSet: { name: 'managedIdentityAuth', values: {} },
                                connectionProperties: { authentication: { type: 'ManagedServiceIdentity' } },
                            },
                        });
                    }
                    if (['', 'ready', 'trigger'].includes(failure)) {
                        assert.deepEqual(bodies.slice(1).map((body) => body.properties.principal.identity.objectId),
                            ['namespace-principal', 'function-principal', 'deployer-principal']);
                        const parameters = result.stderr.split('\n').find((line) => line.startsWith('TEST: parameters '));
                        assert.ok(parameters);
                        assert.deepEqual(JSON.parse(parameters.slice('TEST: parameters '.length)), [
                            { name: 'dataset', value: 'testmonitoredaccount' },
                            { name: 'folderId', value: Buffer.from('%2Ftestcontainer').toString('base64') },
                        ]);
                    } else {
                        assert.doesNotMatch(result.stderr, /TEST: parameters/);
                    }
                }
            });
        }
        if (appName === 'onedriveApp' && process.platform !== 'win32') {
            await t.test('folder picker rejects root and returns the selected connector folder ID', async () => {
                const hook = await readFile(path.join(appRoot, 'infra/scripts/postdeploy.sh'), 'utf8');
                const definition = hook.match(/^select_onedrive_folder\(\) \{[\s\S]*?^\}/m)?.[0];
                assert.ok(definition);
                const mocks = `
connection_invoke() {
    case "$1" in
        /datasets/default/folders) echo '[{"Name":"Child","Id":"child-id","IsFolder":true}]' ;;
        /datasets/default/foldersV2/child-id) echo '{"value":[]}' ;;
        *) return 1 ;;
    esac
}
urlencode() { printf '%s' "$1"; }
select_from_list() {
    printf '%s\\n' "$@" >&2
    local choice
    read -r choice || return 1
    printf '%s' "$choice"
}`;
                for (const [saved, input, expected] of [
                    ['root', '1\nroot\n0\n0\n', 'child-id'],
                    ['saved-id', '0\n', 'saved-id'],
                    ['root', '2\n', ''],
                ]) {
                    const result = spawnSync('bash', ['-c', `${mocks}\n${definition}\nselect_onedrive_folder '${saved}'`], { input, encoding: 'utf8', timeout: 5000 });
                    assert.ifError(result.error);
                    assert.equal(result.status, expected ? 0 : 1, result.stderr);
                    assert.equal(result.stdout, expected);
                    assert.doesNotMatch(result.stderr, /Use this folder \(\/\)|keep current saved: root/);
                    if (expected === 'child-id') {
                        assert.match(result.stderr, /Enter a folder Id returned by the connector/);
                        assert.equal(result.stderr.match(/\[OK\] Use this folder \(\/Child\)/g)?.length, 1, 'Rebuild the menu after navigation.');
                    }
                }
            });
        }
        if (appsWithHooks.has(appName)) {
            await t.test('both deployment hooks map functions to the SDK operation IDs', async (hookTest) => {
                const { sdk } = connectorSamples[appName];
                const sdkModule = await import(pathToFileURL(path.join(appRoot, 'node_modules/@azure/connectors/dist/esm/generated', `${sdk}Extensions.js`)).href);
                const operations = sdkModule[`${sdk}TriggerOperations`];
                const operationKeys = new Map([...apiCalls].map(([name, api]) => [name, `O${api.split('.')[1].slice(1)}`]));
                if (appName === 'onedriveApp') {
                    for (const [name, key] of Object.entries(oneDriveContentOperations)) {
                        operationKeys.set(name, key);
                    }
                }
                if (appName === 'teamsApp') {
                    for (const trigger of webhookTriggers) {
                        operationKeys.set(trigger.functionName, Object.keys(operations).find((key) => operations[key] === trigger.operationName));
                    }
                }
                assert.equal(operationKeys.size, expectedNames.length, 'Every registered function must have an SDK operation mapping.');
                for (const suffix of ['ps1', 'sh']) {
                    const hook = await readFile(path.join(appRoot, 'infra/scripts', `postdeploy.${suffix}`), 'utf8');
                    if (appName === 'sharepointApp') {
                        assert.doesNotMatch(hook, /\bOnSharepoint(?:New|Updated)File\b|\bSHAREPOINT_FOLDER_ID\b/);
                        assert.doesNotMatch(hook, /Read-Host|read -r sharepointSiteAddress|graph\.microsoft\.com/);
                        if (suffix === 'sh' && process.platform !== 'win32') {
                            const end = hook.indexOf('# --- Verify the connector-namespace');
                            assert.ok(end > 0, 'Isolate required configuration checks without executing connector setup.');
                            for (const savedSite of ['', 'https://example.sharepoint.com/sites/saved']) {
                                const values = { resourceGroupName: 'test', connectorNamespaceName: 'test', sharepointConnectionName: 'test', functionAppName: 'test', sharepointSiteUrl: savedSite };
                                const mocks = `
azd() {
    if [[ "$1 $2" == "env get-values" ]]; then
        printf '%s\\n' '${JSON.stringify(values)}'
    else
        return 91
    fi
}
az() {
    echo 'TEST: unexpected Azure call' >&2
    return 92
}`;
                                const result = spawnSync('bash', ['-c', `${mocks}\n${hook.slice(0, end)}`], { input: '', encoding: 'utf8', timeout: 5000 });
                                assert.ifError(result.error);
                                assert.equal(result.status, savedSite ? 0 : 1, result.stderr);
                                assert.doesNotMatch(result.stderr, /TEST: unexpected Azure call/, 'Site configuration must not call Azure CLI for Graph discovery.');
                                assert.doesNotMatch(result.stdout + result.stderr, /SharePoint site URL \(e\.g\./);
                                if (savedSite) {
                                    assert.doesNotMatch(result.stdout + result.stderr, /ERROR/);
                                } else {
                                    assert.match(result.stderr, /SHAREPOINT_SITE_URL.*azd env set/);
                                }
                            }
                            for (const all of [false, true]) {
                                await hookTest.test(`SharePoint Bash setup: ${all ? 'all opt-ins' : 'defaults and deselection'}`, () => {
                                    const values = {
                                        resourceGroupName: 'test', connectorNamespaceName: 'test', sharepointConnectionName: 'sharepoint-test', functionAppName: 'test',
                                        sharepointSiteUrl: 'https://example.sharepoint.com/sites/test',
                                        sharepointLibraryName: all ? 'Archive' : 'Documents',
                                        sharepointListName: all ? 'Tasks' : 'Documents',
                                        sharepointFolderPath: all ? '/Shared Documents/Test' : '',
                                        sharepointEnableDeletionTriggers: String(all), sharepointEnableSyntexTrigger: String(all),
                                        sharepointFormId: all ? 'test-form' : '', sharepointDigestSchedule: all ? '*' : '',
                                    };
                                    const mocks = `
azd() {
    [[ "$1 $2" == "env get-values" ]] || return 91
    printf '%s\\n' "$TEST_OUTPUTS"
}
az() {
    case "$1 $2 $3" in
        "extension show --name") echo connector-namespace ;;
        "connector-namespace connection show")
            if [[ "$*" != *"-o none"* ]]; then echo Connected; fi ;;
        "functionapp keys list") echo offline-test-key ;;
        "connector-namespace trigger list") printf '%s\\n' "$TEST_EXISTING" ;;
        "connector-namespace trigger create"|"connector-namespace trigger update")
            printf 'CAPTURE '
            jq -cn --args '$ARGS.positional' -- "$@"
            if [[ "$TEST_FAIL" == "true" && "$3" == "create" ]]; then return 37; fi ;;
        *) echo "Unexpected Azure call: $1 $2 $3" >&2; return 92 ;;
    esac
}`;
                                    const run = (fail) => spawnSync('bash', ['-c', `${mocks}\n${hook}`], {
                                        input: '', encoding: 'utf8', timeout: 15000,
                                        env: { ...process.env, TEST_OUTPUTS: JSON.stringify(values), TEST_EXISTING: JSON.stringify(['sharepoint-test-onsharepointnewitems', 'sharepoint-test-onsharepointdeleteditems']), TEST_FAIL: String(fail) },
                                    });
                                    const result = run(false);
                                    assert.ifError(result.error);
                                    assert.equal(result.status, 0, result.stderr);
                                    const calls = result.stdout.split('\n').filter((line) => line.startsWith('CAPTURE ')).map((line) => JSON.parse(line.slice(8)));
                                    const valueOf = (args, key) => args[args.indexOf(key) + 1];
                                    const enabled = calls.filter((args) => valueOf(args, '--state') === 'Enabled');
                                    const selectedNames = all ? expectedNames : expectedNames.filter((name) => !/Deleted|Classified|FromForm|Digest/.test(name));
                                    assert.deepEqual(enabled.map((args) => valueOf(args, '-n')).sort(), selectedNames.map((name) => `sharepoint-test-${name.toLowerCase()}`).sort());
                                    assert.equal(enabled.find((args) => valueOf(args, '-n') === 'sharepoint-test-onsharepointnewitems')[2], 'update');
                                    const disabled = calls.filter((args) => valueOf(args, '--state') === 'Disabled');
                                    assert.equal(disabled.length, all ? 0 : 1);
                                    if (!all) assert.equal(valueOf(disabled[0], '-n'), 'sharepoint-test-onsharepointdeleteditems');
                                    for (const args of enabled) {
                                        const functionName = selectedNames.find((name) => `sharepoint-test-${name.toLowerCase()}` === valueOf(args, '-n'));
                                        assert.equal(valueOf(args, '--operation-name'), operations[operationKeys.get(functionName)]);
                                        const parameters = Object.fromEntries(JSON.parse(valueOf(args, '--parameters')).map(({ name, value }) => [name, value]));
                                        const library = /File|Digest/.test(functionName);
                                        assert.equal(parameters.dataset, values.sharepointSiteUrl);
                                        assert.equal(parameters.table, library ? values.sharepointLibraryName : values.sharepointListName);
                                        assert.equal(parameters.folderPath, all && library ? values.sharepointFolderPath : undefined);
                                        if (/FromForm/.test(functionName)) assert.equal(parameters.form, 'test-form');
                                        if (/Digest/.test(functionName)) assert.deepEqual([parameters.add, parameters.update, parameters.runSchedule], [true, true, '*']);
                                    }
                                    if (!all) {
                                        const failed = run(true);
                                        assert.ifError(failed.error);
                                        assert.equal(failed.status, 1, failed.stderr);
                                        assert.match(failed.stdout, /Some trigger configs failed/);
                                        assert.doesNotMatch(failed.stdout, /Post-deployment configuration complete/);
                                    }
                                });
                            }
                        }
                    }
                    if (appName === 'office365App') {
                        assert.doesNotMatch(hook, /\bOnNewCalendarEvent\b|\bCreateOnNewEmailSubscription\b/);
                        assert.equal(hook.match(/\bCalendarGetOnNewItemsV3\b/g)?.length, 1, 'Create only one new-calendar subscription.');
                    }
                    for (const [name, key] of operationKeys) {
                        if (registrations.get(name).deliveryMode === 'Poll') {
                            assert.ok(!hook.includes(name), 'Webhook deployment hooks must not provision polling samples.');
                            continue;
                        }
                        const operation = operations[key];
                        assert.equal(typeof operation, 'string', `Missing SDK operation for ${name}.`);
                        const matches = appName === 'teamsApp' && webhookTriggers.some((trigger) => trigger.functionName === name)
                            ? hook.includes('setup-webhook-triggers.mjs')
                            : suffix === 'ps1'
                            ? new RegExp(`functionName = '${name}';\\s+operationName = '${operation}'`).test(hook)
                            : hook.includes(`${name}|${operation}|`);
                        assert.ok(matches, `${suffix} hook must route ${name} to ${operation}.`);
                    }
                    if (appName === 'onedriveApp') {
                        assert.ok(hook.includes("connector-name 'onedriveforbusiness'"));
                    }
                }
                if (appName === 'onedriveApp') {
                    const namespace = await readFile(path.join(appRoot, 'infra/connectorNamespace.bicep'), 'utf8');
                    assert.match(namespace, /connectorName:\s*'onedriveforbusiness'/);
                }
            });
        }

        for (const [name, { handler }] of registrations) {
            if (appName === 'onedriveApp' && Object.hasOwn(oneDriveContentOperations, name)) {
                const binaryEnvelope = { body: { '$content-type': 'application/octet-stream', '$content': 'AP8B' }, headers: { 'x-test': 'preserved' } };
                const contentCases = [
                    ['binary content', Buffer.from([0, 255, 1])],
                    ['binary envelope', binaryEnvelope],
                    ['text envelope', { body: 'private-file-content' }],
                    ['JSON envelope', JSON.stringify(binaryEnvelope)],
                    ['raw text', 'private-file-content'],
                    ['JSON file content', '{"value":"private-file-content"}'],
                    ['empty content', { body: '' }],
                    ['null payload', null],
                ];
                for (const [label, input] of contentCases) {
                    await t.test(`${name}: ${label}`, async () => {
                        const logs = [];
                        const result = await handler(input, {
                            log: (...args) => logs.push(args.join(' ')),
                            warn: () => assert.fail('Opaque content must not be parsed as a metadata payload.'),
                        });
                        assert.strictEqual(result, input, 'Content and its envelope must be preserved unchanged.');
                        assert.deepEqual(logs, [`${name} content trigger received.`], 'Do not log file contents.');
                    });
                }
                continue;
            }
            const items = [itemFor(appName, name, 1), itemFor(appName, name, 2)];
            const batch = { body: { value: items }, headers: { 'x-test': 'preserved' } };
            const single = { body: items[0] };
            const pollBatch = [
                { body: items[0], headers: { 'x-test': 'first' } },
                { body: { value: [items[1]] }, headers: { 'x-test': 'second' } },
            ];
            const pollCollection = [{ body: { value: items }, headers: { 'x-test': 'preserved' } }];
            const cases = [
                ['batch object', batch, batch, 2],
                ['batch JSON', JSON.stringify(batch), batch, 2],
                ['single object', single, single, 1],
                ['single JSON', JSON.stringify(single), single, 1],
                ['empty batch', { body: { value: [] } }, { body: { value: [] } }, 0],
                ['missing body', {}, {}, 0],
                ['null payload', null, {}, 0],
                ['malformed JSON', '{invalid', '{invalid', 0],
                ['poll envelopes object', pollBatch, pollBatch, 2],
                ['poll envelopes JSON', JSON.stringify(pollBatch), pollBatch, 2],
                ['poll collection envelope', pollCollection, pollCollection, 2],
                ['empty poll batch', [], [], 0],
            ];

            if (appName === 'salesforceApp' || (appName === 'sharepointApp' && !/File$|Deleted/.test(name))) {
                const flatItems = items.map((_, index) => ({ arbitraryField: `sample-item-${index + 1}` }));
                const flatBatch = { body: { value: flatItems } };
                const flatSingle = { body: flatItems[0] };
                cases.push(['flat record batch', flatBatch, flatBatch, 2], ['flat record single', flatSingle, flatSingle, 1]);
            }

            for (const [label, input, expected, count] of cases) {
                await t.test(`${name}: ${label}`, async () => {
                    const logs = [];
                    const warnings = [];
                    const result = await handler(input, {
                        log: (...args) => logs.push(args.join(' ')),
                        warn: (...args) => warnings.push(args.join(' ')),
                    });
                    assert.deepEqual(result, expected, 'The original payload must be returned unchanged.');
                    if (input && typeof input === 'object') {
                        assert.strictEqual(result, input);
                    }

                    assert.ok(logs.some((line) => line.includes(`${name} `)), 'The sample handler must run.');
                    for (let index = 1; index <= count; index++) {
                        assert.ok(logs.some((line) => line.includes(`sample-item-${index}`)), `Item ${index} must reach the handler.`);
                    }
                    if (label.startsWith('poll ') && count === 2) {
                        assert.ok(
                            logs.findIndex((line) => line.includes('sample-item-1')) < logs.findIndex((line) => line.includes('sample-item-2')),
                            'Polling must preserve envelope and item order.',
                        );
                    }
                    if (name === 'OnCalendarChangedItems' && count > 0) {
                        assert.ok(logs.some((line) => line.includes("Action: 'updated'")), 'Calendar changes must use the SDK ActionType field.');
                    }
                    assert.equal(warnings.length, label === 'malformed JSON' ? 1 : 0);
                });
            }
        }
    });
}

if (cwd === path.resolve(root)) {
    await test('all 39 supported non-deprecated, non-duplicate typed trigger registrations are covered across the sample apps', () => {
        assert.equal(publishedApis.size, 43);
        assert.deepEqual([...coveredApis].sort(), [...publishedApis].filter((api) => !excludedApis.has(api)).sort());
        assert.equal(Object.values(samples).reduce((count, names) => count + names.length, 0), 56);
    });
}