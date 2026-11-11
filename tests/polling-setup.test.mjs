// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['onedriveApp', 'office365App'];
const selected = apps.filter((app) => process.cwd() === root || process.cwd() === path.join(root, app, 'polling'));

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
    return {
        outputs, resources, calls,
        set consentCompletes(value) { consentCompletes = value; },
        set failedSource(value) { failedSource = value; },
        get settings() { return settings; },
        choose: async (_label, choices) => choices[0].value,
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
            if (url.pathname.endsWith('/dynamicInvoke')) {
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
        assert.equal(env.resources.size, config.triggers.length);
        assert.equal(env.settings.ConnectorNamespace__pollingEndpoint, 'https://poll.example/api/connectorGateways/test-gateway');
        assert.equal(env.settings.ConnectorNamespace__credential, 'managedidentity');
        assert.equal(values.ConnectorNamespace__credential, undefined, 'Local settings must use developer authentication.');
        for (const trigger of config.triggers) {
            const setting = `${trigger.functionName}TriggerConfigName`;
            assert.equal(values[setting], example.Values[setting]);
        }
        for (const resource of env.resources.values()) {
            assert.equal(resource.properties.deliveryMode, 'Poll');
            assert.equal(resource.properties.notificationDetails, undefined);
            assert.equal(resource.properties.metadata.functionAppName, env.outputs.functionAppName);
            assert.equal(resource.properties.connectionDetails.connectorName, config.connectorName);
            assert.deepEqual(resource.properties.parameters, app === 'office365App'
                ? [{ name: 'folderPath', value: 'Inbox' }] : [{ name: 'folderId', value: 'real/source-id' }]);
        }
        assert.ok(!env.calls.some(({ args }) => args.includes('keys')), 'Polling must not require a webhook system key.');
        env.calls.length = 0;
        await setupPolling({ config, example, ...env, outputs: env.outputs });
        assert.ok(!env.calls.some(({ args }) => args.includes('PUT') || args.includes('list-consent-links')
            || args.some((arg) => arg.includes('/dynamicInvoke'))),
        'An unchanged redeployment must reuse authorization and the saved folder subscription.');
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
