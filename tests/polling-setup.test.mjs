// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['onedriveApp', 'office365App', 'sharepointApp', 'teamsApp', 'dataverseApp'];
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
                ...Object.keys(trigger.values ?? {}).filter((name) => name !== 'body')
                    .map((name) => ({ name, in: 'query', required: true, type: 'string' })),
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
    let consentCompletes = true;
    let authenticationError;
    let connectionErrors = [];
    let failedPicker = false;
    let failedSource = false;
    let settings;
    let optional = false;
    return {
        outputs, resources, calls,
        set optional(value) { optional = value; },
        set connected(value) { connected = value; },
        set consentCompletes(value) { consentCompletes = value; },
        set authenticationError(value) { authenticationError = value; },
        set connectionErrors(value) { connectionErrors = value; },
        set failedPicker(value) { failedPicker = value; },
        set failedSource(value) { failedSource = value; },
        get settings() { return settings; },
        choose: async (label, choices) => {
            if (label.startsWith('Configure On')) {
                assert.notEqual(config.connectorName, 'commondataservice', 'Configure all five Dataverse sources without opt-in prompts.');
                return optional;
            }
            return choices[0].value;
        },
        prompt: async (label) => assert.fail(`Unexpected free-form source selector: ${label}`),
        open: async (url) => {
            assert.notEqual(config.connectorName, 'commondataservice', 'Dataverse uses complete CLI consent, not a portal redirect.');
            assert.equal(url, 'https://consent.example/authorize');
            connected = consentCompletes;
        },
        wait: async () => {},
        log: () => {},
        run: async (command, args, options) => {
            const bodyArgument = args[args.indexOf('--body') + 1];
            const body = args.includes('--body') ? JSON.parse(await readFile(bodyArgument.slice(1), 'utf8')) : undefined;
            calls.push({ command, args, body, options });
            if (command === 'azd') {
                if (args[2] === 'POLLING_TRIGGER_INPUTS') outputs.POLLING_TRIGGER_INPUTS = args[3];
                return '';
            }
            if (args[0] === 'extension') return '';
            if (args.includes('authenticate')) {
                assert.equal(args[args.indexOf('--subscription') + 1], 'test-sub');
                assert.equal(args[args.indexOf('--connection-name') + 1], `${config.connectorName}-test`);
                assert.equal(args[args.indexOf('--namespace') + 1], 'cn-test-poll');
                assert.ok(args.includes('--no-access-policy'), 'Preserve infrastructure-managed access policies.');
                assert.ok(!args.some((arg) => ['--tenant-id', '--object-id', '--redirect-url', '--no-browser'].includes(arg)),
                    'Use normal browser consent with automatic callback capture.');
                assert.equal(options.interactive, true, 'Show consent instructions and errors as they happen.');
                if (config.connectorName === 'commondataservice') assert.equal(typeof options.checkConnected, 'function');
                else assert.deepEqual(options, { interactive: true });
                if (authenticationError) throw authenticationError;
                connected = consentCompletes;
                return '';
            }
            if (args.includes('list-consent-links')) {
                const file = args[args.indexOf('--parameters') + 1];
                assert.deepEqual(JSON.parse(await readFile(file.slice(1), 'utf8')),
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
            if (/\/managedApis\//.test(url.pathname)) return JSON.stringify({ properties: { apiDefinitions: { value: fixture(config) } } });
            if (url.pathname.endsWith('/dynamicInvoke')) {
                if (failedPicker) return JSON.stringify({ response: { statusCode: 403 } });
                if (config.connectorName === 'onedriveforbusiness') {
                    assert.ok(['/datasets/default/folders', '/datasets/default/foldersV2/real%252Fsource-id'].includes(body.request.path));
                    const listing = [{ Id: 'not-a-folder', Name: 'A file', IsFolder: false },
                        { Id: 'real/source-id', Name: 'A folder', IsFolder: true }];
                    return JSON.stringify({ response: { statusCode: 200, body: body.request.path.endsWith('/folders') ? listing : { value: listing } } });
                }
                assert.ok(body.request.path === '/sources' || body.request.path === '/sources/real%2Fsource-id/children');
                return JSON.stringify({ response: { statusCode: 200, body: { value: [{ id: 'real/source-id', name: 'Friendly display name' }] } } });
            }
            if (url.pathname.includes('/connections/')) {
                return JSON.stringify({ properties: {
                    overallStatus: connected ? 'Connected' : 'NotConnected',
                    statuses: connected ? [] : connectionErrors.map((code) => ({ status: 'Error', target: 'token', error: { code } })),
                } });
            }
            if (method === 'GET' && url.pathname.endsWith('/triggerConfigs')) return JSON.stringify({ value: [...resources.values()] });
            const name = decodeURIComponent(url.pathname.split('/').at(-1));
            if (method === 'GET') {
                assert.ok(resources.has(name));
                return JSON.stringify(resources.get(name));
            }
            assert.equal(method, 'PUT', 'Polling setup must not delete subscriptions.');
            const resource = { name, properties: {
                ...body.properties,
                provisioningState: failedSource ? 'Failed' : 'Succeeded',
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
    const { setupPolling, pollingEndpoint, selectOneDriveFolder, run: runCommand } = await import(pathToFileURL(path.join(project, 'infra/scripts/postdeploy.mjs')));

    if (app === 'dataverseApp') {
        await test('Dataverse polling reports OAuth status and confirms success before source selection', async () => {
            const env = environment(config);
            const messages = [];
            const run = async (command, args, options) => {
                if (args.includes('authenticate')) {
                    assert.equal(await options.checkConnected(), false);
                    assert.ok(!messages.some((message) => message.includes('authentication confirmed:')));
                    const result = await env.run(command, args, options);
                    assert.equal(await options.checkConnected(), true);
                    return result;
                }
                return env.run(command, args, options);
            };
            await setupPolling({
                config, example, ...env, run, log: (message) => messages.push(message),
                choose: (...args) => {
                    assert.ok(messages.some((message) => message.includes('authentication confirmed: Azure connection is Connected.')));
                    return env.choose(...args);
                },
            });
            assert.ok(messages.some((message) => message.includes('Azure status: NotConnected')));
            assert.ok(messages.some((message) => message.includes('You can close the sign-in windows.')));
        });

        await test('Dataverse polling ends a pending CLI redirect wait when Azure is Connected', { timeout: 5000 }, async (t) => {
            t.mock.timers.enable({ apis: ['setInterval'] });
            let connected = false;
            let checks = 0;
            const completion = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
                interactive: true,
                checkConnected: async () => { checks++; return connected; },
            });
            try {
                await new Promise(setImmediate);
                assert.equal(checks, 1);
            } finally {
                connected = true;
                t.mock.timers.tick(10_000);
                await completion;
            }
            assert.equal(checks, 2);
            await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)'], { interactive: true }), /exit code 7/);
        });
    }

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
            if (['teamsApp', 'sharepointApp', 'dataverseApp'].includes(app)) {
                assert.deepEqual(Object.fromEntries(resource.properties.parameters.map(({ name, value }) => [name, value])), {
                    source: 'real/source-id', child: 'real/source-id', body: {
                        ...config.triggers.find((item) => item.functionName === resource.properties.metadata.functionName).values?.body,
                        selector: 'real/source-id',
                    },
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

    if (app === 'dataverseApp') {
        await test('Dataverse portal row subscriptions collect Environment, Table and Scope with a namespace-owned callback', async () => {
            const rowTriggers = config.triggers.filter((trigger) => ['OnDataverseRowAdded', 'OnDataverseRowModified', 'OnDataverseRowDeleted']
                .includes(trigger.functionName));
            const dataset = 'https://contoso.crm.dynamics.com';
            const table = 'accounts';
            const swagger = { paths: {}, definitions: {
                SubscriptionRequest: { type: 'object', required: ['NotificationUrl'], properties: {
                    NotificationUrl: { type: 'string', 'x-ms-notification-url': true, 'x-ms-visibility': 'internal' },
                    AttributeFilters: { type: 'array', items: { type: 'string',
                        'x-ms-dynamic-values': { operationId: 'GetAttributeFilters' } } },
                } },
            } };
            const pathParameter = (name) => ({ name, in: 'path', type: 'string', required: true, 'x-ms-url-encoding': 'double' });
            for (const trigger of rowTriggers) {
                swagger.paths[`/{connectionId}/${trigger.operationName}`] = { post: {
                    operationId: trigger.operationName, parameters: [
                        { ...pathParameter('dataset'), 'x-ms-summary': 'Environment', 'x-ms-dynamic-values': {
                            operationId: 'GetDataSets_V2', parameters: {},
                            'value-collection': 'value', 'value-path': 'Name', 'value-title': 'DisplayName',
                        } },
                        { ...pathParameter('table'), 'x-ms-summary': 'Table name', 'x-ms-dynamic-values': {
                            operationId: 'GetTables', parameters: { dataset: { parameter: 'dataset' } },
                            'value-collection': 'value', 'value-path': 'Name', 'value-title': 'DisplayName',
                        } },
                        { name: 'scope', in: 'query', type: 'string', required: true, 'x-ms-summary': 'Scope',
                            'x-ms-dynamic-values': { operationId: 'GetScopeFilters', parameters: {
                                dataset: { parameter: 'dataset' }, table: { parameter: 'table' },
                            } } },
                        { name: 'subscriptionRequest', in: 'body', required: true, schema: { $ref: '#/definitions/SubscriptionRequest' } },
                    ],
                } };
            }
            swagger.paths['/{connectionId}/datasetsV2'] = { get: { operationId: 'GetDataSets_V2', parameters: [] } };
            swagger.paths['/{connectionId}/datasets/{dataset}/tables'] = { get: {
                operationId: 'GetTables', parameters: [pathParameter('dataset')],
            } };
            swagger.paths['/{connectionId}/datasets/{dataset}/tables/{table}/scopes'] = { get: {
                operationId: 'GetScopeFilters', parameters: [pathParameter('dataset'), pathParameter('table')],
            } };
            const env = environment(config);
            const originalRun = env.run;
            const labels = [];
            await setupPolling({
                config: { ...config, triggers: rowTriggers }, example, ...env, outputs: env.outputs,
                choose: async (label, choices) => { labels.push(label); return choices[0].value; },
                run: async (command, args, options) => {
                    const url = args.includes('--url') ? new URL(args[args.indexOf('--url') + 1]) : undefined;
                    if (url?.pathname.includes('/managedApis/')) {
                        assert.ok(args.includes('api-version=2022-09-01-preview'));
                        return JSON.stringify(swagger);
                    }
                    if (url?.pathname.endsWith('/dynamicInvoke')) {
                        const { request } = JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8'));
                        const prefix = `/datasets/${encodeURIComponent(encodeURIComponent(dataset))}/tables`;
                        let body;
                        if (request.path === '/datasetsV2') body = { value: [{ Name: dataset, DisplayName: 'Test environment' }] };
                        else if (request.path === prefix) body = { value: [{ Name: table, DisplayName: 'Accounts' }] };
                        else {
                            assert.equal(request.path, `${prefix}/${table}/scopes`);
                            body = ['Organization', 'User'];
                        }
                        return JSON.stringify({ response: { statusCode: 200, body } });
                    }
                    return originalRun(command, args, options);
                },
            });
            assert.deepEqual(labels, rowTriggers.flatMap(() => ['Environment', 'Table name', 'Scope']));
            for (const trigger of rowTriggers) {
                const source = env.resources.get(example.Values[`${trigger.functionName}TriggerConfigName`]);
                assert.deepEqual(Object.fromEntries(source.properties.parameters.map((p) => [p.name, p.value])),
                    { dataset, table, scope: 'Organization', body: {} });
            }
        });
        await test('Dataverse configures enabled Poll sources for all five portal events by default', async () => {
            const env = environment(config);
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            const operations = {
                OnDataverseRowChanged: 'SubscribeWebhookTrigger',
                OnDataverseActionPerformed: 'BusinessEventsTrigger',
                OnDataverseRowAdded: 'SubscribeOnNewItems',
                OnDataverseRowModified: 'SubscribeOnUpdatedItems',
                OnDataverseRowDeleted: 'SubscribeOnDeletedItems',
            };
            assert.equal(env.resources.size, 5);
            for (const [name, operation] of Object.entries(operations)) {
                const source = env.resources.get(`dataverse-${name.toLowerCase()}`);
                assert.equal(source.properties.operationName, operation);
                assert.equal(source.properties.deliveryMode, 'Poll');
                assert.equal(source.properties.state, 'Enabled');
                assert.equal(env.settings[`AzureWebJobs.${name}.Disabled`], 'false');
            }
        });
        await test('Dataverse reuses partial saved selections and disables only unselected listeners', async () => {
            const env = environment(config);
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            const before = structuredClone([...env.resources.values()]);
            env.outputs.POLLING_TRIGGER_INPUTS = Buffer.from(JSON.stringify([{
                functionName: 'OnDataverseRowChanged', operationName: 'SubscribeWebhookTrigger', parameters: [],
            }])).toString('base64');
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            for (const original of before) {
                const current = env.resources.get(original.name);
                const selected = current.properties.metadata.functionName === 'OnDataverseRowChanged';
                assert.equal(current.properties.state, selected ? 'Enabled' : 'Disabled');
                if (!selected) assert.deepEqual(current.properties.parameters, original.properties.parameters);
                assert.equal(env.settings[`AzureWebJobs.${current.properties.metadata.functionName}.Disabled`], String(!selected));
            }
        });
        await test('Dataverse asks only required inputs and their dependencies, retaining defaults and explicit values', async () => {
            const { collectTriggerInputs } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
            const picker = (id, parameters = {}) => ({ 'x-ms-dynamic-list': {
                operationId: id, parameters, itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'label',
            } });
            const swagger = { paths: { '/subscribe': { post: {
                operationId: 'SubscribeWebhookTrigger', parameters: [
                    { name: 'unusedHeader', in: 'header', type: 'string' },
                    { name: 'unusedFilter', in: 'query', type: 'string',
                        ...picker('Unused', { header: { parameterReference: 'unusedHeader' } }) },
                    { name: 'optionalDefault', in: 'query', type: 'string', default: 'all', ...picker('Unused') },
                    { name: 'savedFilter', in: 'query', type: 'string' },
                    { name: 'subscriptionRequest', in: 'body', required: true, schema: {
                        type: 'object', required: ['action', 'tags'], properties: {
                            action: { type: 'string', ...picker('Actions', { table: { parameterReference: 'subscriptionRequest/table' } }) },
                            table: { type: 'string', ...picker('Tables', { organization: { parameterReference: 'organization' } }) },
                            tags: { type: 'array', minItems: 1, items: { type: 'string' } },
                            defaulted: { type: 'integer', default: 4, ...picker('Unused') },
                            optionalFilter: { type: 'string', ...picker('Unused', { header: { parameterReference: 'unusedHeader' } }) },
                        },
                    } },
                    { name: 'organization', in: 'header', type: 'string', ...picker('Organizations') },
                ],
            } } } };
            const prompts = [];
            const calls = [];
            const triggers = await collectTriggerInputs({
                triggers: [{ functionName: 'OnDataverseRowChanged', operationName: 'SubscribeWebhookTrigger',
                    values: { savedFilter: 'existing' } }], swagger, log: () => {},
                choose: async (label, choices) => {
                    prompts.push(label);
                    return choices[0].value;
                },
                prompt: async (label) => {
                    prompts.push(label);
                    return 'required-tag';
                },
                invoke: async (id, parameters) => {
                    calls.push(id);
                    if (id === 'Tables') assert.deepEqual(parameters, { organization: 'Organizations-id' });
                    if (id === 'Actions') assert.deepEqual(parameters, { table: 'Tables-id' });
                    assert.notEqual(id, 'Unused');
                    return { value: [{ id: `${id}-id`, label: id }] };
                },
            });
            assert.deepEqual(calls, ['Organizations', 'Tables', 'Actions']);
            assert.deepEqual(prompts.sort(), ['organization', 'table', 'action', 'tags (1)'].sort());
            assert.deepEqual(triggers[0].parameters, [
                { name: 'optionalDefault', value: 'all' },
                { name: 'savedFilter', value: 'existing' },
                { name: 'organization', value: 'Organizations-id' },
                { name: 'body', value: { table: 'Tables-id', action: 'Actions-id', tags: ['required-tag'], defaulted: 4 } },
            ]);
        });
        await test('Dataverse falls back to manual connector values, skips blank triggers, and safely reuses the saved subset', async () => {
            const swagger = fixture(config);
            for (const trigger of config.triggers) {
                swagger.paths[`/{connectionId}/${trigger.operationName}`].post.parameters = trigger.operationName === 'BusinessEventsTrigger'
                    ? [{ name: 'subscriptionRequest', in: 'body', required: true, schema: {
                        type: 'object', required: ['sdkmessagename'], properties: {
                            sdkmessagename: { type: 'string', 'x-ms-summary': 'Action name',
                                'x-ms-dynamic-list': { operationId: 'Actions', itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'label' } },
                        },
                    } }]
                    : [{ name: 'organization', in: 'header', type: 'string', required: true,
                        'x-ms-dynamic-list': { operationId: 'Organizations', itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'label' } }];
            }
            swagger.paths['/{connectionId}/actions'] = { get: { operationId: 'Actions', parameters: [] } };
            swagger.paths['/{connectionId}/organizations'] = { get: { operationId: 'Organizations', parameters: [] } };
            for (const allBlank of [false, true]) {
                const env = environment(config);
                if (allBlank) {
                    await setupPolling({ config, example, ...env, outputs: env.outputs });
                    delete env.outputs.POLLING_TRIGGER_INPUTS;
                    env.calls.length = 0;
                }
                const originalResources = structuredClone([...env.resources]);
                const originalSettings = structuredClone(env.settings);
                const logs = [];
                const options = {
                    config, example, ...env, outputs: env.outputs, log: (message) => logs.push(message),
                    choose: () => assert.fail('Empty lists must not show a menu.'),
                    prompt: async (label, schema, options) => {
                        assert.deepEqual(options, { allowEmpty: true });
                        return allBlank || label === 'Action name' ? '  ' : ' https://contoso.crm.dynamics.com ';
                    },
                    run: async (command, args, options) => {
                        const url = args[args.indexOf('--url') + 1] ?? '';
                        if (url.includes('/managedApis/')) return JSON.stringify({ properties: { apiDefinitions: { value: swagger } } });
                        if (url.includes('/dynamicInvoke')) return JSON.stringify({ response: { statusCode: 200, body: { value: [] } } });
                        return env.run(command, args, options);
                    },
                };
                if (allBlank) {
                    await assert.rejects(setupPolling(options), /distinct selected triggers/);
                    assert.deepEqual([...env.resources], originalResources);
                    assert.deepEqual(env.settings, originalSettings);
                    assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, undefined);
                    assert.ok(!env.calls.some((call) => call.args.includes('PUT')
                        || call.command === 'azd' && call.args.includes('set')));
                } else {
                    await setupPolling(options);
                    assert.equal(env.resources.size, 4);
                    assert.equal(env.settings['AzureWebJobs.OnDataverseActionPerformed.Disabled'], 'true');
                    const saved = JSON.parse(Buffer.from(env.outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'));
                    assert.equal(saved.length, 4);
                    assert.ok(saved.every((trigger) => trigger.parameters.some((p) => p.value === 'https://contoso.crm.dynamics.com')));
                    env.calls.length = 0;
                    await setupPolling({ ...options, prompt: () => assert.fail('Reuse the saved subset.') });
                    assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.body?.request));
                }
                assert.ok(logs.some((message) => message.includes('Skipped OnDataverseActionPerformed')));
            }
        });
        await test('Dataverse blank manual path selectors skip immediately and continue to the next trigger', async () => {
            const { collectTriggerInputs } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
            const swagger = { paths: { '/{connectionId}/{dataset}/{table}': { get: {
                operationId: 'SubscribeOnNewItems', parameters: [
                    { name: 'dataset', in: 'path', required: true, type: 'string',
                        'x-ms-dynamic-list': { operationId: 'Organizations', itemsPath: 'value',
                            itemValuePath: 'id', itemTitlePath: 'label' } },
                    { name: 'table', in: 'path', required: true, type: 'string' },
                ],
            } }, '/next': { get: { operationId: 'SubscribeOnDeletedItems', parameters: [] } } } };
            const prompts = [];
            const triggers = await collectTriggerInputs({
                triggers: config.triggers.filter((trigger) => ['SubscribeOnNewItems', 'SubscribeOnDeletedItems'].includes(trigger.operationName)),
                swagger, log: () => {}, invoke: async () => ({ value: [] }),
                choose: () => assert.fail('No choices to select.'),
                prompt: async (label, schema, options) => {
                    prompts.push(label);
                    assert.deepEqual(options, { allowEmpty: true });
                    return '';
                },
            });
            assert.deepEqual(prompts, ['dataset']);
            assert.deepEqual(triggers.map((trigger) => trigger.functionName), ['OnDataverseRowDeleted']);
        });
        await test('Dataverse keeps usable action IDs without labels and offers manual entry only for empty usable lists', async () => {
            const { collectTriggerInputs } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
            const swagger = { paths: { '/action': { post: {
                operationId: 'BusinessEventsTrigger', parameters: [
                    { name: 'subscriptionRequest', in: 'body', required: true, schema: {
                        type: 'object', required: ['sdkmessagename'], properties: {
                            sdkmessagename: { type: 'string', 'x-ms-summary': 'Action name',
                                'x-ms-dynamic-list': { operationId: 'Actions', itemsPath: 'value',
                                    itemValuePath: 'SdkMessageName', itemTitlePath: 'DisplayName' } },
                        },
                    } },
                ],
            } } } };
            let manual;
            const options = {
                triggers: [config.triggers.find((trigger) => trigger.operationName === 'BusinessEventsTrigger')],
                swagger, log: () => {},
                prompt: async (label, schema, options) => {
                    manual = true;
                    assert.equal(label, 'Action name');
                    assert.deepEqual(options, { allowEmpty: true });
                    return 'custom_Action';
                },
                choose: async (label, choices) => {
                    assert.deepEqual(choices, [{ value: 'custom_Action', label: 'custom_Action' }]);
                    return choices[0].value;
                },
            };
            for (const value of [
                [{ SdkMessageName: 'custom_Action', DisplayName: null }, { DisplayName: 'No ID' }, null],
                [{ DisplayName: 'No ID' }],
            ]) {
                manual = false;
                const triggers = await collectTriggerInputs({ ...options, invoke: async () => ({ value }) });
                assert.equal(manual, value.length === 1);
                assert.deepEqual(triggers[0].parameters, [{ name: 'body', value: { sdkmessagename: 'custom_Action' } }]);
            }
            for (const invoke of [
                async () => ({ value: {} }),
                async () => { throw new Error('Access denied'); },
            ]) {
                manual = false;
                await assert.rejects(collectTriggerInputs({ ...options, invoke }), /malformed list.*Action name|Access denied/);
                assert.equal(manual, false, 'Malformed responses and lookup failures must not fall back to manual entry.');
            }
        });
        await test('Dataverse collects required environment headers and table selectors while preserving numeric body defaults', async () => {
            const { collectTriggerInputs, operationRequest } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
            const organization = 'https://contoso.crm.dynamics.com';
            const swagger = { paths: { '/subscribe': { post: {
                operationId: 'SubscribeWebhookTrigger',
                parameters: [
                    { name: 'organization', in: 'header', type: 'string', required: true },
                    { name: 'subscriptionRequest', in: 'body', required: true, schema: {
                        type: 'object', required: ['entityname', 'message', 'scope', 'url'],
                        properties: {
                            message: { type: 'integer' }, scope: { type: 'integer' },
                            entityname: { type: 'string', 'x-ms-dynamic-values': {
                                operationId: 'Tables', parameters: { organization: { parameter: 'organization' } },
                                'value-collection': 'value', 'value-path': 'logicalName', 'value-title': 'displayName',
                            } },
                            url: { type: 'string', 'x-ms-notification-url': true },
                        },
                    } }],
            } }, '/tables': { get: {
                operationId: 'Tables', parameters: [
                    { name: 'organization', in: 'header', type: 'string', required: true },
                    { name: 'Consistency', in: 'header', type: 'string', required: true, default: 'Strong', 'x-ms-visibility': 'internal' },
                ],
            } } } };
            const triggers = await collectTriggerInputs({
                triggers: [config.triggers[0]], swagger,
                prompt: async (label) => {
                    assert.equal(label, 'organization', 'Collect the required header, without reprompting for numeric body defaults.');
                    return organization;
                },
                choose: async (label, choices) => {
                    assert.equal(label, 'entityname');
                    return choices[0].value;
                },
                invoke: async (id, values) => {
                    assert.deepEqual(operationRequest(swagger, id, values), {
                        method: 'GET', path: '/tables', headers: { organization, Consistency: 'Strong' },
                    });
                    return { value: [{ logicalName: 'account', displayName: 'Accounts' }] };
                },
                log: () => {},
            });
            assert.deepEqual(triggers[0].parameters, [
                { name: 'organization', value: organization },
                { name: 'body', value: { message: 7, scope: 4, entityname: 'account' } },
            ]);
        });
        await test('Dataverse table picker double-encodes environment URLs as specified by connector metadata', async () => {
            const { operationRequest } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
            const swagger = { paths: { '/datasets/{dataset}/tables': { get: {
                operationId: 'GetTables', parameters: [
                    { name: 'dataset', in: 'path', required: true, type: 'string', 'x-ms-url-encoding': 'double' },
                ],
            } } } };
            assert.deepEqual(operationRequest(swagger, 'GetTables', { dataset: 'https://contoso.crm.dynamics.com' }), {
                method: 'GET', path: '/datasets/https%253A%252F%252Fcontoso.crm.dynamics.com/tables',
            });
        });
        await test('Dataverse CLI authentication failures stop before source selection or configuration', async () => {
            const env = environment(config);
            env.authenticationError = new Error('Consent was denied.');
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }),
                /authentication failed.*resources are already deployed.*hooks run postdeploy/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
            assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, undefined);
            assert.ok(!env.calls.some((call) => call.body?.request || call.args.includes('PUT')));
        });
        await test('Dataverse verifies Connected after consent instead of trusting a successful CLI return', async () => {
            const env = environment(config);
            env.consentCompletes = false;
            env.connectionErrors = ['Unauthenticated'];
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }),
                /not Connected after authentication.*Unauthenticated.*resources are already deployed/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
            assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, undefined);
            assert.ok(!env.calls.some((call) => call.body?.request || call.args.includes('PUT')));
        });
        await test('Dataverse resumes already-connected setup without opening another browser sign-in', async () => {
            const env = environment(config);
            env.connected = true;
            await setupPolling({ config, example, ...env, outputs: env.outputs });
            assert.ok(!env.calls.some((call) => call.args.includes('authenticate') || call.args.includes('list-consent-links')));
            assert.ok(env.resources.size > 0);
        });
    }

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
