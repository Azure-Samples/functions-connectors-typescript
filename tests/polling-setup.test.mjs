// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['onedriveApp', 'office365App', 'sharepointApp', 'teamsApp'];
const selected = apps.filter((app) => process.cwd() === root || process.cwd() === path.join(root, app, 'polling'));

function fixture(config) {
    const swagger = { paths: {} };
    for (const trigger of config.triggers) {
        swagger.paths[`/{connectionId}/${trigger.operationName}`] = { post: {
            operationId: trigger.operationName,
            parameters: [
                { name: 'child', in: 'query', required: true, type: 'string',
                    'x-ms-dynamic-list': { operationId: 'Children', parameters: { source: { parameterReference: 'source' } },
                        itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'name' } },
                { name: 'source', in: 'query', required: false, type: 'string',
                    'x-ms-dynamic-values': { operationId: 'Sources', 'value-collection': 'value', 'value-path': 'id', 'value-title': 'name' } },
                { name: 'optionalFilter', in: 'query', required: false, type: 'string' },
                { name: 'internalValue', in: 'query', required: true, type: 'string', 'x-ms-visibility': 'internal' },
                { name: 'requestBody', in: 'body', required: true, schema: {
                    type: 'object', required: ['notificationUrl', 'selector'],
                    properties: {
                        notificationUrl: { type: 'string', 'x-ms-notification-url': true },
                        selector: { type: 'string', 'x-ms-dynamic-list': {
                            operationId: 'Children', parameters: { source: { parameterReference: 'source' } },
                            itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'name',
                        } },
                    },
                } },
            ],
        } };
    }
    swagger.paths['/{connectionId}/sources'] = { get: { operationId: 'Sources', parameters: [] } };
    swagger.paths['/{connectionId}/sources/{source}/children'] = { get: {
        operationId: 'Children', parameters: [{ name: 'source', in: 'path', required: true }],
    } };
    return swagger;
}

function environment(config) {
    const outputs = {
        resourceGroupName: 'rg-test-poll',
        functionAppName: 'func-test-poll',
        connectorNamespaceName: 'cn-test-poll',
        connectorNamespaceResourceId: '/subscriptions/test-sub/resourceGroups/rg-test-poll/providers/Microsoft.Web/connectorGateways/cn-test-poll',
        connectorNamespaceConnectionName: `${config.connectorName}-test`,
        CONNECTOR_NAMESPACE_LOCATION: 'brazilsouth',
    };
    const resources = new Map();
    const calls = [];
    let connected = false;
    let settings;
    let consentCompletes = true;
    let failedSource = false;
    let optional = false;
    let failedPicker = false;
    return {
        outputs, resources, calls,
        set consentCompletes(value) { consentCompletes = value; },
        set failedSource(value) { failedSource = value; },
        set optional(value) { optional = value; },
        set failedPicker(value) { failedPicker = value; },
        get settings() { return settings; },
        choose: async (label, choices) => label.startsWith('Configure On') ? optional : choices[0].value,
        prompt: async (label) => assert.fail(`Unexpected free-form source selector: ${label}`),
        open: async (url) => {
            assert.equal(url, 'https://consent.example/authorize');
            connected = consentCompletes;
        },
        wait: async () => {},
        log: () => {},
        run: async (command, args) => {
            const body = args.includes('--body')
                ? JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8')) : undefined;
            calls.push({ command, args, body });
            if (command === 'azd') {
                if (args[2] === 'POLLING_TRIGGER_INPUTS') outputs.POLLING_TRIGGER_INPUTS = args[3];
                return '';
            }
            if (args[0] === 'extension') return '';
            assert.equal(args[args.indexOf('--subscription') + 1], 'test-sub');
            if (args.includes('list-consent-links')) {
                assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--parameters') + 1].slice(1), 'utf8')),
                    [{ parameterName: 'token', redirectUrl: 'https://portal.azure.com' }]);
                return JSON.stringify({ value: [{ link: 'https://consent.example/authorize' }] });
            }
            if (args[0] === 'functionapp') {
                settings = JSON.parse(await readFile(args[args.indexOf('--settings') + 1].slice(1), 'utf8'));
                return '';
            }
            assert.equal(args[0], 'rest');
            const method = args[args.indexOf('--method') + 1];
            const url = new URL(args[args.indexOf('--url') + 1]);
            if (/\/managedApis\//.test(url.pathname)) {
                return JSON.stringify({ properties: { apiDefinitions: { value: fixture(config) } } });
            }
            if (url.pathname.endsWith('/dynamicInvoke')) {
                if (failedPicker) return JSON.stringify({ response: { statusCode: 403 } });
                if (['teams', 'sharepointonline'].includes(config.connectorName)) {
                    assert.ok(body.request.path === '/sources' || body.request.path === '/sources/real%2Fsource-id/children');
                    return JSON.stringify({ response: { statusCode: 200,
                        body: { value: [{ id: 'real/source-id', name: 'Friendly display name' }] } } });
                }
                assert.ok(['/datasets/default/folders', '/datasets/default/foldersV2/real%252Fsource-id'].includes(body.request.path));
                const listing = [{ Id: 'not-a-folder', Name: 'A file', IsFolder: false },
                    { Id: 'real/source-id', Name: 'A folder', IsFolder: true }];
                return JSON.stringify({ response: { statusCode: 200,
                    body: body.request.path.endsWith('/folders') ? listing : { value: listing } } });
            }
            if (url.pathname.includes('/connections/')) {
                return JSON.stringify({ properties: { overallStatus: connected ? 'Connected' : 'NotConnected' } });
            }
            if (method === 'GET' && url.pathname.endsWith('/triggerConfigs')) {
                return JSON.stringify({ value: [...resources.values()] });
            }
            const name = decodeURIComponent(url.pathname.split('/').at(-1));
            if (method === 'GET') return JSON.stringify(resources.get(name));
            assert.equal(method, 'PUT', 'Polling setup must not delete subscriptions.');
            const resource = { name, properties: {
                ...body.properties, provisioningState: failedSource ? 'Failed' : 'Succeeded',
                pollingEndpoints: { receiveUri: `https://poll.example/api/connectorGateways/test-gateway/triggerconfigs/${name}/receive?api-version=preview` },
            } };
            resources.set(name, resource);
            return JSON.stringify(resource);
        },
    };
}

for (const app of selected) {
    const project = path.join(root, app, 'polling');
    const config = JSON.parse(await readFile(path.join(project, 'infra/scripts/polling-config.json'), 'utf8'));
    const example = JSON.parse(await readFile(path.join(project, 'local.settings.example.json'), 'utf8'));
    const { setupPolling, pollingEndpoint, selectOneDriveFolder } = await import(pathToFileURL(path.join(project, 'infra/scripts/postdeploy.mjs')));

    await test(`${app}: authorizes the connection, configures Poll listeners, and reuses saved sources`, async () => {
        const env = environment(config);
        const values = await setupPolling({ config, example, ...env, outputs: env.outputs });
        assert.equal(env.resources.size, config.triggers.filter((trigger) => !trigger.optional).length);
        assert.equal(env.settings.ConnectorNamespace__pollingEndpoint, 'https://poll.example/api/connectorGateways/test-gateway');
        assert.equal(env.settings.ConnectorNamespace__credential, 'managedidentity');
        assert.equal(values.ConnectorNamespace__credential, undefined, 'Local settings must use developer authentication.');
        for (const trigger of config.triggers) {
            const setting = `${trigger.functionName}TriggerConfigName`;
            assert.equal(values[setting], example.Values[setting]);
            assert.equal(values[`AzureWebJobs.${trigger.functionName}.Disabled`], String(Boolean(trigger.optional)));
        }
        for (const resource of env.resources.values()) {
            assert.equal(resource.properties.deliveryMode, 'Poll');
            assert.equal(resource.properties.notificationDetails, undefined);
            assert.equal(resource.properties.metadata.functionAppName, env.outputs.functionAppName);
            assert.equal(resource.properties.connectionDetails.connectorName, config.connectorName);
            if (['teamsApp', 'sharepointApp'].includes(app)) {
                assert.deepEqual(Object.fromEntries(resource.properties.parameters.map(({ name, value }) => [name, value])), {
                    source: 'real/source-id', child: 'real/source-id', body: { selector: 'real/source-id' },
                }, 'Resolve picker dependencies using IDs, omit optional filters/internal fields, and never send a Function callback.');
            } else {
                assert.deepEqual(resource.properties.parameters, app === 'office365App'
                    ? [{ name: 'folderPath', value: 'Inbox' }] : [{ name: 'folderId', value: 'real/source-id' }]);
            }
        }
        assert.ok(!env.calls.some(({ args }) => args.includes('keys')), 'Polling must not require a webhook system key.');
        env.calls.length = 0;
        await setupPolling({ config, example, ...env, outputs: env.outputs });
        assert.ok(!env.calls.some(({ args }) => args.includes('PUT') || args.includes('list-consent-links')
            || args.some((arg) => arg.includes('/dynamicInvoke'))),
        'An unchanged redeployment must reuse authorization and saved source subscriptions.');
    });

    await test(`${app}: Poll setup refuses to overwrite a webhook or another app source`, async () => {
        for (const change of [{ deliveryMode: 'Webhook' }, { metadata: { functionAppName: 'someone-else' } }]) {
            const env = environment(config);
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            Object.assign(env.resources.values().next().value.properties, change);
            env.calls.length = 0;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /Refusing to overwrite/);
            assert.ok(!env.calls.some(({ args }) => args.includes('PUT') || args[0] === 'functionapp'));
        }
    });

    if (app === selected[0]) await test('Poll endpoint derivation rejects unsafe or guessed service paths', () => {
        assert.equal(pollingEndpoint('https://poll.example/api/triggerconfigs/source/receive?api-version=preview'), 'https://poll.example');
        assert.equal(pollingEndpoint('https://poll.example/triggerconfigs/source/receive'), 'https://poll.example');
        assert.equal(pollingEndpoint('https://poll.example/api/connectorGateways/gateway/triggerconfigs/source/receive'),
            'https://poll.example/api/connectorGateways/gateway');
        for (const uri of ['http://poll.example/api/triggerconfigs/source/receive',
            'https://user:password@poll.example/api/triggerconfigs/source/receive',
            'https://poll.example/api/triggerconfigs/source/receive#fragment',
            'https://poll.example/unknown/triggerconfigs/source/receive', 'https://poll.example/api']) {
            assert.throws(() => pollingEndpoint(uri));
        }
    });

    if (app === 'office365App') {
        await test('Office Poll setup fails on source registration failure and can be retried', async () => {
            const env = environment(config);
            env.failedSource = true;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /source-registration status and permissions/);
            assert.equal(env.settings, undefined);
            env.failedSource = false;
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            assert.equal(env.settings.ConnectorNamespace__credential, 'managedidentity');
            assert.equal(env.resources.values().next().value.properties.provisioningState, 'Succeeded');
        });
        await test('Office consent timeout does not create triggers or apply app settings', async () => {
            const env = environment(config);
            env.consentCompletes = false;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /Timed out/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
        });
        await test('Office rejects saved inputs that omit the required listener', async () => {
            const env = environment(config);
            env.outputs.POLLING_TRIGGER_INPUTS = Buffer.from('[]').toString('base64');
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /distinct selected triggers/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
        });
    }

    if (['teamsApp', 'sharepointApp'].includes(app)) {
        await test(`${app}: optional Poll sources can be selected and deselected without losing selectors`, async () => {
            const env = environment(config);
            env.optional = true;
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            assert.equal(env.resources.size, config.triggers.length);
            const before = structuredClone([...env.resources.values()]);
            const kept = JSON.parse(Buffer.from(env.outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'))
                .filter((trigger) => !config.triggers.find((item) => item.functionName === trigger.functionName).optional);
            env.outputs.POLLING_TRIGGER_INPUTS = Buffer.from(JSON.stringify(kept)).toString('base64');
            env.calls.length = 0;
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            for (const original of before) {
                const resource = env.resources.get(original.name);
                const definition = config.triggers.find((item) => item.functionName === resource.properties.metadata.functionName);
                assert.deepEqual(resource.properties.parameters, original.properties.parameters);
                assert.equal(resource.properties.state, definition.optional ? 'Disabled' : 'Enabled');
                assert.equal(env.settings[`AzureWebJobs.${definition.functionName}.Disabled`], String(Boolean(definition.optional)));
            }
            assert.equal(env.calls.filter((call) => call.args.includes('PUT')).length, config.triggers.filter((item) => item.optional).length);
        });
        await test(`${app}: picker failures stop setup before creating sources or applying settings`, async () => {
            const env = environment(config);
            env.failedPicker = true;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /Connector picker failed/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
            assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, undefined);
        });
    }

    if (app === 'sharepointApp') {
        const deletedItem = config.triggers.find((trigger) => trigger.operationName === 'GetOnDeletedItems');
        const listTriggers = config.triggers.filter((trigger) =>
            ['GetOnDeletedItems', 'GetOnNewItems', 'GetOnUpdatedItems'].includes(trigger.operationName));
        const listSwagger = fixture(config);
        for (const trigger of listTriggers) {
            listSwagger.paths[`/{connectionId}/${trigger.operationName}`].post.parameters = [
                { name: 'dataset', in: 'path', required: true, type: 'string', 'x-ms-summary': 'Site Address',
                    'x-ms-dynamic-values': { operationId: 'Sources', 'value-collection': 'value', 'value-path': 'id', 'value-title': 'name' } },
                { name: 'table', in: 'path', required: true, type: 'string', 'x-ms-summary': 'List Name',
                    'x-ms-dynamic-values': { operationId: 'GetTables', parameters: { dataset: { parameter: 'dataset' } },
                        'value-collection': 'value', 'value-path': 'Name', 'value-title': 'DisplayName' } },
            ];
        }
        listSwagger.paths['/{connectionId}/datasets/{dataset}/tables'] = { get: {
            operationId: 'GetTables', parameters: [{ name: 'dataset', in: 'path', required: true }],
        } };
        const { collectTriggerInputs, operationRequest } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
        const emptyListRun = (env) => async (command, args) => {
            const url = args[args.indexOf('--url') + 1] ?? '';
            if (url.includes('/managedApis/')) {
                return JSON.stringify({ properties: { apiDefinitions: { value: listSwagger } } });
            }
            if (url.includes('/dynamicInvoke')) {
                const body = JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8'));
                if (body.request.path.startsWith('/datasets/')) {
                    assert.equal(body.request.path, '/datasets/real%2Fsource-id/tables');
                    return JSON.stringify({ response: { statusCode: 200, body: { value: [] } } });
                }
            }
            return env.run(command, args);
        };

        await test('SharePoint list triggers accept and save manual list names when the picker is empty', async () => {
            const listConfig = { ...config, triggers: listTriggers };
            const env = environment(listConfig);
            env.optional = true;
            let prompts = 0;
            const options = {
                config: listConfig, example, ...env, outputs: env.outputs,
                prompt: async (label, schema, options) => {
                    prompts++;
                    assert.equal(label, 'List Name');
                    assert.equal(schema.type, 'string');
                    assert.equal(options.allowEmpty, true);
                    return 'Tasks & Requests';
                },
                run: emptyListRun(env),
            };
            await setupPolling(options);
            assert.equal(prompts, listTriggers.length);
            assert.equal(env.resources.size, listTriggers.length);
            const saved = JSON.parse(Buffer.from(env.outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'));
            for (const trigger of listTriggers) {
                const resource = env.resources.get(example.Values[`${trigger.functionName}TriggerConfigName`]);
                assert.deepEqual(resource.properties.parameters, [
                    { name: 'dataset', value: 'real/source-id' },
                    { name: 'table', value: 'Tasks & Requests' },
                ]);
                assert.deepEqual(saved.find((item) => item.functionName === trigger.functionName).parameters, resource.properties.parameters);
                assert.equal(env.settings[`AzureWebJobs.${trigger.functionName}.Disabled`], 'false');
            }
            env.calls.length = 0;
            await setupPolling(options);
            assert.equal(prompts, listTriggers.length, 'Reuse the saved list names on redeployment.');
            assert.equal(env.calls.filter((call) => call.args.includes('PUT')).length, 0);
        });

        await test('SharePoint skips empty-list triggers on blank input and configures the remaining listeners', async () => {
            for (const answer of ['', '   ']) {
                const env = environment(config);
                const messages = [];
                let prompts = 0;
                const options = {
                    config, example, ...env, outputs: env.outputs,
                    choose: async (label, choices) => label === `Configure ${deletedItem.functionName}?`
                        ? true : env.choose(label, choices),
                    prompt: async (label, schema, options) => {
                        prompts++;
                        assert.equal(label, 'List Name');
                        assert.equal(options.allowEmpty, true);
                        return answer;
                    },
                    log: (message) => messages.push(message),
                    run: emptyListRun(env),
                };
                await setupPolling(options);
                assert.equal(prompts, listTriggers.length);
                for (const trigger of listTriggers) {
                    const skippedName = example.Values[`${trigger.functionName}TriggerConfigName`];
                    assert.equal(env.resources.has(skippedName), false, 'Do not create a trigger without a list.');
                    assert.equal(env.settings[`AzureWebJobs.${trigger.functionName}.Disabled`], 'true');
                    assert.ok(messages.some((message) => message.includes(`Skipped ${trigger.functionName}`)));
                }
                const remaining = config.triggers.filter((trigger) => !trigger.optional && !listTriggers.includes(trigger));
                assert.equal(env.resources.size, remaining.length, 'Continue configuring every remaining default-enabled listener.');
                const saved = JSON.parse(Buffer.from(env.outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'));
                assert.deepEqual(saved.map((trigger) => trigger.functionName), remaining.map((trigger) => trigger.functionName));
                await setupPolling(options);
                assert.equal(prompts, listTriggers.length, 'Do not ask again for skipped triggers on redeployment.');
            }
        });

        await test('SharePoint blank list input disables existing list sources without losing their selectors', async () => {
            const env = environment(config);
            let answer = 'Tasks & Requests';
            const options = {
                config, example, ...env, outputs: env.outputs,
                choose: async (label, choices) => label === `Configure ${deletedItem.functionName}?`
                    ? true : env.choose(label, choices),
                prompt: async () => answer,
                run: emptyListRun(env),
            };
            await setupPolling(options);
            const before = structuredClone(env.resources);
            env.outputs.POLLING_TRIGGER_INPUTS = '';
            env.calls.length = 0;
            answer = '';
            await setupPolling(options);
            for (const [name, resource] of env.resources) {
                const isList = listTriggers.some((trigger) => trigger.functionName === resource.properties.metadata.functionName);
                assert.equal(resource.properties.state, isList ? 'Disabled' : 'Enabled');
                assert.deepEqual(resource.properties.parameters, before.get(name).properties.parameters);
            }
            assert.equal(env.calls.filter((call) => call.args.includes('PUT')).length, listTriggers.length);
        });

        await test('SharePoint saved inputs reuse a subset when other default listeners had empty pickers', async () => {
            const env = environment(config);
            const remaining = config.triggers.filter((trigger) => !trigger.optional && !listTriggers.includes(trigger));
            env.outputs.POLLING_TRIGGER_INPUTS = Buffer.from(JSON.stringify(remaining.slice(1).map((trigger) => ({
                functionName: trigger.functionName, operationName: trigger.operationName, parameters: [],
            })))).toString('base64');
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            assert.equal(env.resources.size, remaining.length - 1);
            assert.equal(env.settings[`AzureWebJobs.${remaining[0].functionName}.Disabled`], 'true');
            assert.equal(env.settings[`AzureWebJobs.${remaining[1].functionName}.Disabled`], 'false');
        });

        await test('SharePoint list triggers keep the picker when lists are available', async () => {
            const inputs = await collectTriggerInputs({
                triggers: listTriggers, swagger: listSwagger, log: () => {},
                invoke: async (id) => id === 'Sources'
                    ? { value: [{ id: 'site', name: 'Test site' }] }
                    : { value: [{ Name: 'list-id', DisplayName: 'Existing list' }] },
                choose: async (_, choices) => choices[0].value,
                prompt: () => assert.fail('A populated list picker must not ask for manual entry.'),
            });
            assert.equal(inputs.length, listTriggers.length);
            for (const input of inputs) {
                assert.deepEqual(input.parameters, [
                    { name: 'dataset', value: 'site' }, { name: 'table', value: 'list-id' },
                ]);
            }
        });

        await test('SharePoint manual list entry does not mask failed or malformed pickers', async () => {
            for (const scenario of ['failed', 'malformed']) {
                const swagger = structuredClone(listSwagger);
                const trigger = { ...deletedItem };
                const table = swagger.paths['/{connectionId}/GetOnDeletedItems'].post.parameters[1];
                await assert.rejects(collectTriggerInputs({
                    triggers: [trigger], swagger, log: () => {},
                    invoke: async (id) => {
                        if (id === 'Sources') return { value: [{ id: 'site', name: 'Test site' }] };
                        if (scenario === 'failed') throw new Error('Connector picker failed.');
                        return scenario === 'malformed' ? {} : { value: [] };
                    },
                    choose: async (_, choices) => choices[0].value,
                    prompt: () => assert.fail('Only a successful, empty list-only table picker allows manual entry.'),
                }), scenario === 'failed' ? /Connector picker failed/ : /Invalid picker response/);
            }
        });

        const fileDeletion = config.triggers.find((trigger) => trigger.operationName === 'GetOnDeletedFileItems');
        const datasetParameter = { name: 'dataset', in: 'path', required: true, type: 'string', 'x-ms-url-encoding': 'double' };
        const folderSwagger = { paths: {
            '/{connectionId}/datasets/{dataset}/tables/{table}/ondeletedfileitems': { get: {
                operationId: 'GetOnDeletedFileItems',
                parameters: [
                    datasetParameter,
                    { name: 'table', in: 'path', required: true, type: 'string' },
                    { name: 'folderPath', in: 'query', required: false, type: 'string', 'x-ms-summary': 'Folder',
                        'x-ms-dynamic-values': { capability: 'file-picker', parameters: { dataset: { parameter: 'dataset' }, isFolder: true }, 'value-path': 'Path' },
                        'x-ms-dynamic-tree': {
                            open: {
                                operationId: 'ListAllRootFolders', parameters: { dataset: { parameterReference: 'dataset' } },
                                itemTitlePath: 'DisplayName', itemValuePath: 'Path', itemFullTitlePath: 'Path', itemIsParent: '(IsFolder eq true)',
                            },
                            browse: {
                                operationId: 'ListFolder',
                                parameters: { dataset: { parameterReference: 'dataset' }, id: { selectedItemValuePath: 'Id' } },
                                itemTitlePath: 'DisplayName', itemValuePath: 'Path', itemFullTitlePath: 'Path', itemIsParent: '(IsFolder eq true)',
                            },
                            settings: { canSelectLeafNodes: false, canSelectParentNodes: true },
                        },
                    },
                ],
            } },
            '/{connectionId}/datasets/{dataset}/rootfolders': { get: {
                operationId: 'ListAllRootFolders', parameters: [datasetParameter],
            } },
            '/{connectionId}/datasets/{dataset}/folders/{id}': { get: {
                operationId: 'ListFolder',
                parameters: [datasetParameter, { name: 'id', in: 'path', required: true, type: 'string', 'x-ms-url-encoding': 'double' }],
            } },
        } };
        const folderTrigger = { ...fileDeletion, values: { dataset: 'https://example.sharepoint.com/sites/test', table: 'library-id' } };
        const library = { Id: 'library/id', Path: '/Shared Documents', DisplayName: 'Documents', IsFolder: true };

        // Selector families and response shapes from the exported SharePoint connector metadata.
        const promptMatrix = [
            ['GetOnChangedItems', 'GetTablesForListsAndLibraries', true, true],
            ['GetOnDeletedFileItems', 'GetTablesForLibraries', true, false],
            ['GetOnDeletedItems', 'GetTables', false, false],
            ['GetOnNewFileItems', 'GetTablesForLibraries', true, true],
            ['GetOnNewItems', 'GetTables', false, true],
            ['GetOnNewItemsFromForm', 'GetTablesForListsAndLibraries', false, true],
            ['GetOnRecurrenceDigest', 'GetTablesForListsAndLibraries', true, true],
            ['GetOnUpdatedFileClassifiedTimes', 'GetTablesForLibraries', true, true],
            ['GetOnUpdatedFileItems', 'GetTablesForLibraries', true, true],
            ['GetOnUpdatedItems', 'GetTables', false, true],
        ];
        const picker = (id, dependencies = {}, collection = 'value') => ({
            operationId: id,
            parameters: Object.fromEntries(Object.keys(dependencies).map((name) => [name, { parameter: name }])),
            ...(collection ? { 'value-collection': collection } : {}),
            'value-path': id === 'GetDayOfWeekOptions' ? 'value' : 'Name',
            'value-title': id === 'GetDayOfWeekOptions' ? 'name' : 'DisplayName',
        });
        const site = 'https://example.sharepoint.com/sites/test';
        const tableParameter = { name: 'table', in: 'path', required: true, type: 'string', 'x-ms-url-encoding': 'double' };
        const auditedSwagger = { paths: { ...folderSwagger.paths } };
        for (const [id, tablePicker, folder, view] of promptMatrix) {
            const parameters = [
                { ...datasetParameter, 'x-ms-summary': 'Site Address', 'x-ms-dynamic-values': picker('GetDataSets') },
                { ...tableParameter, 'x-ms-summary': tablePicker === 'GetTables' ? 'List Name'
                    : tablePicker === 'GetTablesForLibraries' ? 'Library Name' : 'List or Library Name',
                'x-ms-dynamic-values': picker(tablePicker, { dataset: true }) },
            ];
            if (id === 'GetOnNewItemsFromForm') parameters.push({
                name: 'form', in: 'query', required: true, type: 'string', 'x-ms-summary': 'Form Name',
                'x-ms-dynamic-values': picker('GetTableForms', { dataset: true, table: true }, null),
            });
            if (id === 'GetOnRecurrenceDigest') parameters.push(
                { name: 'update', in: 'query', required: true, type: 'boolean', 'x-ms-summary': 'Include edits' },
                { name: 'add', in: 'query', required: true, type: 'boolean', 'x-ms-summary': 'Include new items or files' },
                { name: 'runSchedule', in: 'query', required: true, type: 'string', 'x-ms-summary': 'When to run',
                    'x-ms-dynamic-values': picker('GetDayOfWeekOptions') },
            );
            if (folder) parameters.push(folderSwagger.paths[
                '/{connectionId}/datasets/{dataset}/tables/{table}/ondeletedfileitems'].get.parameters[2]);
            if (view) parameters.push({
                name: 'view', in: 'query', required: false, type: 'string', 'x-ms-summary': 'Limit Columns by View',
                'x-ms-dynamic-values': picker('GetTableViews', { dataset: true, table: true }, null),
            });
            if (id === 'GetOnRecurrenceDigest') parameters.push({
                name: 'startTime', in: 'query', required: false, type: 'string', format: 'date-time', 'x-ms-summary': 'Start Time',
            });
            auditedSwagger.paths[`/{connectionId}/${id}`] = { get: { operationId: id, parameters } };
        }
        for (const [id, route, parameters] of [
            ['GetDataSets', 'datasets', []],
            ['GetTables', 'datasets/{dataset}/tables', [datasetParameter]],
            ['GetTablesForLibraries', 'datasets/{dataset}/tablesfor/libraries', [datasetParameter]],
            ['GetTablesForListsAndLibraries', 'datasets/{dataset}/tablesfor/listsandlibraries', [datasetParameter]],
            ['GetTableForms', 'datasets/{dataset}/tables/{table}/forms', [datasetParameter, tableParameter]],
            ['GetTableViews', 'datasets/{dataset}/tables/{table}/views', [datasetParameter, tableParameter]],
            ['GetDayOfWeekOptions', 'getDayOfWeekOptions', []],
        ]) auditedSwagger.paths[`/{connectionId}/${route}`] = { get: { operationId: id, parameters } };
        // The operation has been replaced by its metadata-shaped parameter set above.
        delete auditedSwagger.paths['/{connectionId}/datasets/{dataset}/tables/{table}/ondeletedfileitems'];
        const pickerResults = {
            GetDataSets: { value: [{ Name: site, DisplayName: 'Test site' }] },
            GetTables: { value: [{ Name: 'list-id', DisplayName: 'Tasks' }] },
            GetTablesForLibraries: { value: [{ Name: 'library-id', DisplayName: 'Documents' }] },
            GetTablesForListsAndLibraries: { value: [{ Name: 'table-id', DisplayName: 'List or library' }] },
            GetTableForms: [{ Name: 'form-id', DisplayName: 'Submission form' }],
            GetTableViews: [{ Name: 'view-id', DisplayName: 'All items' }],
            GetDayOfWeekOptions: { value: [{ value: 'schedule-id', name: 'Schedule display name' }] },
            ListAllRootFolders: [],
        };
        const emptyResult = (id) => ['GetTableForms', 'GetTableViews'].includes(id) ? [] : { value: [] };
        const chooseInputs = async (label, choices) => {
            assert.ok(choices.length, `Do not display an empty picker for ${label}.`);
            if (label === 'Include edits') return false;
            if (label.startsWith('Configure ')) return true;
            return choices[0].value;
        };
        for (const [id, tablePicker, folder, view] of promptMatrix) {
            const trigger = config.triggers.find((item) => item.operationName === id);
            await test(`SharePoint ${id}: audited prompts preserve IDs and skip unavailable required selectors`, async () => {
                const requiredPickers = ['GetDataSets', tablePicker,
                    ...(id === 'GetOnNewItemsFromForm' ? ['GetTableForms'] : []),
                    ...(id === 'GetOnRecurrenceDigest' ? ['GetDayOfWeekOptions'] : [])];
                for (const empty of [undefined, ...requiredPickers, ...(view ? ['GetTableViews'] : [])]) {
                    const calls = [];
                    const messages = [];
                    const inputs = await collectTriggerInputs({
                        triggers: [trigger], swagger: auditedSwagger, choose: chooseInputs,
                        invoke: async (pickerId, values) => {
                            calls.push(pickerId);
                            assert.ok(Object.hasOwn(pickerResults, pickerId));
                            if (pickerId === 'GetTableForms' || pickerId === 'GetTableViews') {
                                assert.deepEqual(values, { dataset: site, table: pickerResults[tablePicker].value[0].Name });
                            }
                            return pickerId === empty ? emptyResult(pickerId) : pickerResults[pickerId];
                        },
                        prompt: async (label, schema, options) => {
                            if (empty === 'GetTables') {
                                assert.equal(label, 'List Name');
                                assert.equal(options.allowEmpty, true);
                                return '';
                            }
                            assert.equal(label, 'Start Time');
                            assert.equal(schema.format, 'date-time');
                            return '2026-11-12T08:00:00Z';
                        },
                        log: (message) => messages.push(message),
                    });
                    if (requiredPickers.includes(empty)) {
                        assert.deepEqual(inputs, []);
                        assert.equal(calls.at(-1), empty, 'Do not request dependent or optional inputs after skipping.');
                        assert.ok(messages.some((message) => message.includes(`Skipped ${trigger.functionName}`)));
                        continue;
                    }
                    assert.equal(inputs.length, 1);
                    const expected = { dataset: site, table: pickerResults[tablePicker].value[0].Name };
                    if (id === 'GetOnNewItemsFromForm') expected.form = 'form-id';
                    if (id === 'GetOnRecurrenceDigest') Object.assign(expected, {
                        update: false, add: true, runSchedule: 'schedule-id', startTime: '2026-11-12T08:00:00Z',
                    });
                    if (view && empty !== 'GetTableViews') expected.view = 'view-id';
                    assert.deepEqual(Object.fromEntries(inputs[0].parameters.map(({ name, value }) => [name, value])), expected);
                    if (folder) assert.ok(messages.some((message) => message.includes('No folders returned')));
                    if (empty === 'GetTableViews') assert.ok(messages.some((message) => message.includes('leaving the optional filter unset')));
                }
            });
        }

        const auditedRun = (env, results) => async (command, args) => {
            const url = args[args.indexOf('--url') + 1] ?? '';
            if (url.includes('/managedApis/')) return JSON.stringify({ properties: { apiDefinitions: { value: auditedSwagger } } });
            if (url.includes('/dynamicInvoke')) {
                const body = JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8'));
                const id = Object.keys(results).find((key) => operationRequest(auditedSwagger, key, {
                    dataset: site, table: 'table-id',
                }).path === body.request.path
                    || ['GetTableForms', 'GetTableViews'].includes(key) && body.request.path.endsWith(
                        key === 'GetTableForms' ? '/forms' : '/views'));
                assert.ok(id, `Unexpected picker request: ${body.request.path}`);
                return JSON.stringify({ response: { statusCode: 200, body: results[id] } });
            }
            return env.run(command, args);
        };

        await test('SharePoint empty library, form, and digest pickers disable only skipped sources and persist the remaining selection', async () => {
            const env = environment(config);
            const results = structuredClone(pickerResults);
            const options = {
                config, example, ...env, outputs: env.outputs, choose: chooseInputs,
                prompt: async () => '2026-11-12T08:00:00Z',
                run: auditedRun(env, results),
            };
            await setupPolling(options);
            assert.equal(env.resources.size, promptMatrix.length);
            const before = structuredClone(env.resources);
            for (const id of ['GetTablesForLibraries', 'GetTableForms', 'GetDayOfWeekOptions', 'GetTableViews']) results[id] = emptyResult(id);
            env.outputs.POLLING_TRIGGER_INPUTS = '';
            await setupPolling(options);
            const skipped = promptMatrix.filter(([id, tablePicker]) => tablePicker === 'GetTablesForLibraries'
                || ['GetOnNewItemsFromForm', 'GetOnRecurrenceDigest'].includes(id)).map(([id]) => id);
            for (const [name, resource] of env.resources) {
                const definition = config.triggers.find((item) => item.functionName === resource.properties.metadata.functionName);
                const disabled = skipped.includes(definition.operationName);
                assert.equal(resource.properties.state, disabled ? 'Disabled' : 'Enabled');
                assert.equal(env.settings[`AzureWebJobs.${definition.functionName}.Disabled`], String(disabled));
                if (disabled) assert.deepEqual(resource.properties.parameters, before.get(name).properties.parameters);
                else assert.ok(!resource.properties.parameters.some((item) => item.name === 'view'));
            }
            const saved = JSON.parse(Buffer.from(env.outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'));
            assert.equal(saved.length, config.triggers.length - skipped.length);
            assert.ok(saved.every((item) => !skipped.includes(item.operationName)));
            env.calls.length = 0;
            await setupPolling({ ...options, run: env.run });
            assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.args.includes('export=true')));
        });

        await test('SharePoint all-skipped or malformed required/optional pickers leave existing sources and settings unchanged', async () => {
            const env = environment(config);
            const results = structuredClone(pickerResults);
            const options = {
                config, example, ...env, outputs: env.outputs, choose: chooseInputs,
                prompt: async () => '2026-11-12T08:00:00Z',
                run: auditedRun(env, results),
            };
            await setupPolling(options);
            const before = structuredClone(env.resources);
            const settings = structuredClone(env.settings);
            for (const [pickerId, response, error] of [
                ['GetDataSets', { value: [] }, /distinct selected triggers/],
                ['GetTableForms', { value: [] }, /Invalid picker response for Form Name/],
                ['GetTableViews', {}, /Invalid picker response for Limit Columns by View/],
            ]) {
                Object.assign(results, structuredClone(pickerResults), { [pickerId]: response });
                env.outputs.POLLING_TRIGGER_INPUTS = '';
                env.calls.length = 0;
                await assert.rejects(setupPolling(options), error);
                assert.deepEqual(env.resources, before);
                assert.deepEqual(env.settings, settings);
                assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, '');
                assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.args[0] === 'functionapp'));
            }
        });

        await test('SharePoint folder browsing navigates by ID but configures the selected path', async () => {
            const first = { Id: 'folder/a%2F', Path: '/Shared Documents/First', DisplayName: 'First', IsFolder: true };
            const second = { Id: 'folder/b', Path: '/Shared Documents/Reports & Notes', DisplayName: 'Reports & Notes', IsFolder: true };
            const file = { Id: 'file', Path: '/Shared Documents/file.txt', DisplayName: 'file.txt', IsFolder: false };
            const selections = [library.Id, first.Id, 'up', second.Id, 'select'];
            const calls = [];
            const inputs = await collectTriggerInputs({
                triggers: [folderTrigger], swagger: folderSwagger, log: () => {},
                invoke: async (id, values) => {
                    assert.equal(values.dataset, folderTrigger.values.dataset);
                    calls.push({ id, values, request: operationRequest(folderSwagger, id, values) });
                    if (id === 'ListAllRootFolders') return [file, library];
                    assert.equal(id, 'ListFolder');
                    if (values.id === library.Id) return [file, first, second];
                    assert.ok([first.Id, second.Id].includes(values.id));
                    return { value: [] };
                },
                choose: async (label, choices) => {
                    if (label === 'Configure Folder (optional)?') return true;
                    assert.ok(!choices.some((choice) => choice.label === file.DisplayName), 'Never offer files as folders.');
                    const selected = selections.shift();
                    const choice = choices.find((item) => item.value?.Id === selected || item.value === selected);
                    assert.ok(choice, `Missing folder choice ${selected}`);
                    return choice.value;
                },
                prompt: () => assert.fail('Folder browsing must not require guessed paths.'),
            });
            assert.equal(selections.length, 0);
            assert.deepEqual(calls.map((call) => call.values.id), [undefined, library.Id, first.Id, library.Id, second.Id]);
            assert.equal(calls[2].request.path,
                '/datasets/https%253A%252F%252Fexample.sharepoint.com%252Fsites%252Ftest/folders/folder%252Fa%25252F');
            assert.equal(inputs[0].parameters.find((parameter) => parameter.name === 'folderPath').value, second.Path);

            const folderConfig = { ...config, triggers: [fileDeletion] };
            const env = environment(folderConfig);
            env.outputs.POLLING_TRIGGER_INPUTS = Buffer.from(JSON.stringify(inputs)).toString('base64');
            await setupPolling({ config: folderConfig, example, ...env, outputs: env.outputs });
            const resource = env.resources.values().next().value;
            assert.equal(resource.properties.parameters.find((parameter) => parameter.name === 'folderPath').value, second.Path);
        });

        await test('SharePoint optional folders can be skipped before browsing or after an empty listing', async () => {
            for (const browse of [false, true]) {
                let calls = 0;
                const inputs = await collectTriggerInputs({
                    triggers: [folderTrigger], swagger: folderSwagger, log: () => {},
                    invoke: async (id) => {
                        calls++;
                        assert.equal(id, 'ListAllRootFolders');
                        return [];
                    },
                    choose: async (label, choices) => label === 'Configure Folder (optional)?'
                        ? browse : choices.find((choice) => choice.value === 'skip').value,
                    prompt: () => assert.fail('Skipping a folder must not ask for a path.'),
                });
                assert.equal(calls, browse ? 1 : 0);
                assert.equal(inputs.length, 1, 'Omit only the folder filter, not the file-deleted trigger.');
                assert.ok(!inputs[0].parameters.some((parameter) => parameter.name === 'folderPath'));
            }
        });

        await test('SharePoint folder browsing rejects malformed listings and preserves lookup failures', async () => {
            for (const response of [{}, { value: {} }, [null], [{ ...library, Id: '' }], [{ ...library, Path: undefined }], 'failed']) {
                await assert.rejects(collectTriggerInputs({
                    triggers: [folderTrigger], swagger: folderSwagger, log: () => {},
                    invoke: async () => {
                        if (response === 'failed') throw new Error('Connector picker failed.');
                        return response;
                    },
                    choose: async (label) => {
                        assert.equal(label, 'Configure Folder (optional)?');
                        return true;
                    },
                    prompt: () => assert.fail('A failed folder lookup must not fall back to guessed paths.'),
                }), response === 'failed' ? /Connector picker failed/ : /Invalid folder/);
            }
        });

        await test('Failed authenticated source lookups fail deployment before creating triggers', async () => {
            const env = environment(config);
            env.failedPicker = true;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /Connector picker failed/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
        });
    }
    if (app === 'onedriveApp') await test('OneDrive rejects invalid listings and never uses the root placeholder as a trigger folder', async () => {
        for (const [response, expected] of [[{ value: {} }, /invalid folder listing/],
            [[{ Id: 'root', Name: 'Root', IsFolder: true }, { Id: 'file', IsFolder: false }], /Create a test folder/]]) {
            await assert.rejects(selectOneDriveFolder({
                request: async () => response,
                choose: () => assert.fail('Invalid listings must not offer a placeholder choice.'),
            }), expected);
        }
    });
}
