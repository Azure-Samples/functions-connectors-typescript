// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setupPolling } from '../azureblobApp/polling/infra/scripts/postdeploy.mjs';

const config = JSON.parse(await readFile(new URL('../azureblobApp/polling/infra/scripts/polling-config.json', import.meta.url), 'utf8'));
const example = JSON.parse(await readFile(new URL('../azureblobApp/polling/local.settings.example.json', import.meta.url), 'utf8'));

function fixture() {
    const outputs = {
        resourceGroupName: 'rg-test',
        functionAppName: 'func-test',
        connectorNamespaceName: 'cn-test',
        connectorNamespaceResourceId: '/subscriptions/test-sub/resourceGroups/rg-test/providers/Microsoft.Web/connectorGateways/cn-test',
        connectorNamespaceConnectionName: 'azureblob-test',
        CONNECTOR_NAMESPACE_LOCATION: 'brazilsouth',
        monitoredStorageAccountName: 'teststorage',
        monitoredContainerName: 'testcontainer',
    };
    const resources = new Map();
    const calls = [];
    let settings;
    return {
        config, example, outputs, resources, calls,
        get settings() { return settings; },
        choose: () => assert.fail('Blob setup must not prompt for sources.'),
        prompt: () => assert.fail('Blob setup must not prompt for credentials.'),
        open: () => assert.fail('Managed identity must not request OAuth consent.'),
        wait: async () => {},
        log: () => {},
        run: async (command, args) => {
            calls.push({ command, args });
            if (command === 'azd') {
                if (args[2] === 'POLLING_TRIGGER_INPUTS') outputs.POLLING_TRIGGER_INPUTS = args[3];
                return '';
            }
            assert.equal(args[args.indexOf('--subscription') + 1], 'test-sub');
            if (args[0] === 'functionapp') {
                settings = JSON.parse(await readFile(args[args.indexOf('--settings') + 1].slice(1), 'utf8'));
                return '';
            }
            assert.equal(args[0], 'rest');
            const method = args[args.indexOf('--method') + 1];
            const url = new URL(args[args.indexOf('--url') + 1]);
            if (url.pathname.includes('/connections/')) {
                return JSON.stringify({ properties: { overallStatus: 'Ready' } });
            }
            if (method === 'GET' && url.pathname.endsWith('/triggerConfigs')) {
                return JSON.stringify({ value: [...resources.values()] });
            }
            assert.equal(method, 'PUT', 'Setup must not delete subscriptions.');
            const body = JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8'));
            const name = decodeURIComponent(url.pathname.split('/').at(-1));
            const resource = { name, properties: {
                ...body.properties,
                provisioningState: 'Succeeded',
                pollingEndpoints: { receiveUri: `https://poll.example/api/connectorGateways/test/triggerconfigs/${name}/receive` },
            } };
            resources.set(name, resource);
            return JSON.stringify(resource);
        },
    };
}

await test('Blob Poll setup uses provisioned sources and MI without OAuth or webhook keys', async () => {
    const env = fixture();
    const values = await setupPolling(env);
    assert.equal(env.resources.size, 1);
    const resource = env.resources.values().next().value;
    assert.equal(resource.properties.deliveryMode, 'Poll');
    assert.equal(resource.properties.notificationDetails, undefined);
    assert.deepEqual(resource.properties.parameters, [
        { name: 'dataset', value: 'teststorage' },
        { name: 'folderId', value: Buffer.from('%2Ftestcontainer').toString('base64') },
    ]);
    assert.equal(env.settings.ConnectorNamespace__credential, 'managedidentity');
    assert.equal(values.ConnectorNamespace__credential, undefined);
    assert.equal(values.ConnectorNamespace__pollingEndpoint, 'https://poll.example/api/connectorGateways/test');
    assert.ok(!env.calls.some(({ args }) => args.includes('keys') || args.includes('list-consent-links')));
    env.calls.length = 0;
    await setupPolling(env);
    assert.equal(env.calls.filter(({ args }) => args.includes('PUT')).length, 0,
        'An unchanged redeployment must reuse the source subscription.');
});

await test('Blob Poll setup refuses to overwrite another app or a webhook subscription', async () => {
    for (const change of [{ deliveryMode: 'Webhook' }, { metadata: { functionAppName: 'another-app' } }]) {
        const env = fixture();
        await setupPolling(env);
        Object.assign(env.resources.values().next().value.properties, change);
        env.calls.length = 0;
        await assert.rejects(setupPolling(env), /Refusing to overwrite/);
        assert.ok(!env.calls.some(({ args }) => args.includes('PUT') || args[0] === 'functionapp'));
    }
});
