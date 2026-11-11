// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['onedriveApp', 'office365App', 'teamsApp'];
const selected = apps.filter((app) => process.cwd() === root || process.cwd() === path.join(root, app, 'polling'));

function teamsFixture(config) {
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
                return JSON.stringify({ properties: { apiDefinitions: { value: teamsFixture(config) } } });
            }
            if (url.pathname.endsWith('/dynamicInvoke')) {
                if (failedPicker) return JSON.stringify({ response: { statusCode: 403 } });
                if (config.connectorName === 'teams') {
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
            if (app === 'teamsApp') {
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

    if (app === 'teamsApp') {
        await test('Teams optional Poll sources can be selected and deselected without losing selectors', async () => {
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
        await test('Teams picker failures stop setup before creating sources or applying settings', async () => {
            const env = environment(config);
            env.failedPicker = true;
            await assert.rejects(setupPolling({ config, example, ...env, outputs: env.outputs }), /Connector picker failed/);
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
            assert.equal(env.outputs.POLLING_TRIGGER_INPUTS, undefined);
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
