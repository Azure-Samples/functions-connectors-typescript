// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const apps = ['salesforceApp'];
const selected = apps.filter((app) => process.cwd() === path.resolve(root)
    || process.cwd() === path.join(root, app, 'webhook'));

function fixture(config) {
    const swagger = { paths: {
        '/{connectionId}/tables': { get: { operationId: 'Tables', parameters: [] } },
    } };
    for (const trigger of config.triggers) {
        swagger.paths[`/{connectionId}/trigger/${trigger.operationName}`] = { post: {
            operationId: trigger.operationName,
            parameters: [
                { name: 'table', in: 'path', type: 'string', required: true,
                    'x-ms-url-encoding': 'double',
                    'x-ms-dynamic-values': { operationId: 'Tables',
                        'value-collection': 'value', 'value-path': 'id', 'value-title': 'label' } },
                { name: 'optionalFilter', in: 'query', type: 'string',
                    'x-ms-dynamic-values': { operationId: 'UnusedOptional' } },
            ],
        } };
    }
    return swagger;
}

function environment(config, operationRequest) {
    const swagger = fixture(config);
    const outputs = {
        resourceGroupName: 'rg-test', functionAppName: 'func-test', FUNCTION_APP_HOSTNAME: 'func-test.azurewebsites.net',
        connectorNamespaceName: 'cn-test', connectorNamespaceConnectionName: `${config.connectorName}-test`,
        connectorNamespaceResourceId: '/subscriptions/test-sub/resourceGroups/rg-test/providers/Microsoft.Web/connectorGateways/cn-test',
        connectorConnectionRuntimeUrl: 'https://connection.example', CONNECTOR_NAMESPACE_LOCATION: 'brazilsouth',
    };
    const resources = new Map();
    const calls = [];
    let connected = false;
    let settings;
    const env = {
        outputs, resources, calls, swagger,
        consentCompletes: true, pickerStatus: 200, sourceState: 'Succeeded', key: 'test-extension-key',
        pickerItems: [{ id: 'test-id', label: 'Test source' }],
        get settings() { return settings; },
        choose: async (label, choices) => {
            assert.ok(choices.length, 'Never show an empty picker.');
            assert.ok(!label.includes('(optional)'), 'Optional fields must not prompt.');
            return choices[0].value;
        },
        prompt: () => assert.fail('Required selectors have pickers; defaults must not prompt.'),
        wait: async () => {},
        log: () => {},
        run: async (command, args, options) => {
            const fileArg = args.includes('--body') ? args[args.indexOf('--body') + 1]
                : args.includes('--settings') ? args[args.indexOf('--settings') + 1] : undefined;
            let body;
            if (fileArg) {
                assert.ok(fileArg.startsWith('@'));
                body = JSON.parse(await readFile(fileArg.slice(1), 'utf8'));
                if (process.platform !== 'win32') assert.equal((await stat(fileArg.slice(1))).mode & 0o777, 0o600);
            }
            calls.push({ command, args, options, body, file: fileArg?.slice(1) });
            if (command === 'azd') {
                assert.equal(args[2], config.savedInputsSetting);
                outputs[config.savedInputsSetting] = args[3];
                return '';
            }
            assert.equal(args[args.indexOf('--subscription') + 1], 'test-sub');
            if (args.includes('authenticate')) {
                assert.ok(args.includes('--no-access-policy'));
                assert.equal(options.interactive, true);
                assert.equal(typeof options.checkConnected, 'function');
                if (env.authError) throw new Error('CLI authentication error');
                connected = env.consentCompletes;
                return '';
            }
            if (args[0] === 'functionapp') {
                if (args[1] === 'keys') return JSON.stringify({ systemKeys: { connector_extension: env.key } });
                settings = body;
                return '';
            }
            const method = args[args.indexOf('--method') + 1];
            const url = new URL(args[args.indexOf('--url') + 1]);
            if (url.pathname.includes('/managedApis/')) {
                assert.ok(url.pathname.endsWith(`/${config.connectorName}`));
                return JSON.stringify({ properties: { apiDefinitions: { value: swagger } } });
            }
            if (url.pathname.endsWith('/dynamicInvoke')) {
                assert.ok(connected, 'Authenticate before source selection.');
                assert.ok(!JSON.stringify(body).includes('UnusedOptional'));
                return JSON.stringify({ response: { statusCode: env.pickerStatus, body: { value: env.pickerItems } } });
            }
            if (url.pathname.includes('/connections/')) return JSON.stringify({ properties: { overallStatus: connected ? 'Connected' : 'NotConnected' } });
            if (url.pathname.endsWith('/triggerConfigs')) return JSON.stringify({ value: [...resources.values()] });
            const name = decodeURIComponent(url.pathname.split('/').at(-1));
            if (method === 'GET') return JSON.stringify(resources.get(name));
            assert.equal(method, 'PUT', 'Never delete subscriptions.');
            const resource = { name, properties: { ...body.properties, provisioningState: env.sourceState } };
            resources.set(name, resource);
            return JSON.stringify(resource);
        },
    };
    return env;
}

for (const app of selected) {
    const project = path.join(root, app, 'webhook');
    const config = JSON.parse(await readFile(path.join(project, 'infra/scripts/webhook-config.json'), 'utf8'));
    const { setupWebhooks, run: runCommand } = await import(pathToFileURL(path.join(project, 'infra/scripts/postdeploy.mjs')));
    const { collectWebhookTriggers, operationRequest, validateWebhookTriggers } = await import(pathToFileURL(path.join(project, 'infra/scripts/trigger-inputs.mjs')));
    const makeEnvironment = () => environment(config, operationRequest);

    {
        await test(`${app}: reports actual OAuth progress and confirms success before source selection`, async () => {
            const env = makeEnvironment();
            const messages = [];
            env.log = (message) => messages.push(message);
            const originalRun = env.run;
            let failStatus = false;
            env.run = async (command, args, options) => {
                if (args.includes('authenticate')) {
                    failStatus = true;
                    assert.equal(await options.checkConnected(), false);
                    failStatus = false;
                    assert.equal(await options.checkConnected(), false);
                    assert.ok(!messages.some((message) => message.includes('authentication confirmed:')));
                    const result = await originalRun(command, args, options);
                    assert.equal(await options.checkConnected(), true);
                    return result;
                }
                if (failStatus) throw new Error('Temporary status lookup failure');
                return originalRun(command, args, options);
            };
            const originalChoose = env.choose;
            env.choose = (...args) => {
                assert.ok(messages.some((message) => message.includes('authentication confirmed: Azure connection is Connected.')));
                return originalChoose(...args);
            };
            await setupWebhooks(env);
            assert.ok(messages.some((message) => message.includes('No success has been confirmed.')));
            assert.ok(messages.some((message) => message.includes('Azure status: NotConnected')));
            assert.ok(messages.some((message) => message.includes('You can close the sign-in windows.')));
        });

        await test(`${app}: CLI redirect waits end only after Azure confirms Connected`, { timeout: 5000 }, async (t) => {
            t.mock.timers.enable({ apis: ['setInterval'] });
            let connected = false;
            let checks = 0;
            const completion = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
                interactive: true,
                checkConnected: async () => {
                    checks++;
                    if (checks === 1) throw new Error('Transient status lookup failure');
                    return connected;
                },
            });
            let finished = false;
            completion.then(() => { finished = true; });
            try {
                await new Promise(setImmediate);
                t.mock.timers.tick(10_000);
                await new Promise(setImmediate);
                assert.equal(checks, 2);
                assert.equal(finished, false, 'A failed lookup or disconnected status must not end authentication.');
            } finally {
                connected = true;
                t.mock.timers.tick(10_000);
                await completion;
            }
            assert.equal(checks, 3);
            await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)'], { interactive: true }), /exit code 7/);
        });
    }

    await test(`${app}: authenticates, creates selected webhooks, and reuses unchanged subscriptions`, async () => {
        const env = makeEnvironment();
        await setupWebhooks(env);
        assert.equal(env.resources.size, config.triggers.length);
        assert.equal(env.settings[config.connectionSetting], env.outputs.connectorConnectionRuntimeUrl);
        for (const definition of config.triggers) {
            const resource = env.resources.get(`${config.connectorName}-test-${definition.functionName.toLowerCase()}`);
            assert.equal(resource.properties.operationName, definition.operationName);
            assert.equal(resource.properties.state, 'Enabled');
            assert.notEqual(resource.properties.deliveryMode, 'Poll');
            assert.equal(resource.properties.connectionDetails.connectorName, config.connectorName);
            assert.equal(resource.properties.notificationDetails.callbackUrl,
                `https://func-test.azurewebsites.net/runtime/webhooks/connector?functionName=${definition.functionName}`);
            assert.equal(resource.properties.notificationDetails.authentication.value, env.key);
            assert.equal(env.settings[`AzureWebJobs.${definition.functionName}.Disabled`], 'false');

        }
        const saved = env.outputs[config.savedInputsSetting];
        assert.ok(!Buffer.from(saved, 'base64').toString('utf8').includes(env.key));
        assert.ok(!env.calls.some((call) => call.args.some((arg) => arg.includes(env.key))));
        for (const call of env.calls.filter((call) => call.file)) await assert.rejects(access(call.file), { code: 'ENOENT' });
        env.calls.length = 0;
        await setupWebhooks({ ...env, choose: () => assert.fail('Saved selectors must not reprompt.') });
        assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.body?.request || call.args.includes('authenticate')));
    });

    await test(`${app}: skipped sources are disabled without changing selectors or deleting subscriptions`, async () => {
        const env = makeEnvironment();
        await setupWebhooks(env);
        const original = structuredClone([...env.resources.values()]);
        if (config.triggers.length === 1) return;
        const kept = JSON.parse(Buffer.from(env.outputs[config.savedInputsSetting], 'base64').toString('utf8')).slice(0, 1);
        env.outputs[config.savedInputsSetting] = Buffer.from(JSON.stringify(kept)).toString('base64');
        await setupWebhooks(env);
        for (const previous of original) {
            const current = env.resources.get(previous.name);
            assert.deepEqual(current.properties.parameters, previous.properties.parameters);
            const selected = current.properties.metadata.functionName === kept[0].functionName;
            assert.equal(current.properties.state, selected ? 'Enabled' : 'Disabled');
            assert.equal(env.settings[`AzureWebJobs.${current.properties.metadata.functionName}.Disabled`], String(!selected));
        }
    });

    await test(`${app}: all skipped and invalid saved selections leave existing resources untouched`, async () => {
        const env = makeEnvironment();
        await setupWebhooks(env);
        const original = structuredClone([...env.resources]);
        const saved = env.outputs[config.savedInputsSetting];
        for (const invalid of [undefined, [], [{ functionName: 'NotThisApp', operationName: 'Unknown', parameters: [] }]]) {
            delete env.outputs[config.savedInputsSetting];
            if (invalid) env.outputs[config.savedInputsSetting] = Buffer.from(JSON.stringify(invalid)).toString('base64');
            env.calls.length = 0;
            await assert.rejects(setupWebhooks({ ...env, choose: () => false }), /distinct selected trigger|do not match/);
            assert.deepEqual([...env.resources], original);
            assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.command === 'azd' || call.args.includes('--settings')));
        }
        const triggers = JSON.parse(Buffer.from(saved, 'base64').toString('utf8'));
        const required = triggers.find((trigger) => trigger.parameters.length);
        if (required) {
            required.parameters = [];
            assert.throws(() => validateWebhookTriggers(triggers, env.swagger), /do not match/);
        }
    });

    await test(`${app}: failed consent, missing keys, and picker failures stop before writing sources`, async () => {
        for (const failure of ['authError', 'consentCompletes', 'key', 'pickerStatus', 'pickerItems']) {
            const env = makeEnvironment();
            if (failure === 'authError') env.authError = true;
            if (failure === 'consentCompletes') env.consentCompletes = false;
            if (failure === 'key') env.key = undefined;
            if (failure === 'pickerStatus') env.pickerStatus = 403;
            if (failure === 'pickerItems') env.pickerItems = {};
            const messages = [];
            env.log = (message) => messages.push(message);
            await assert.rejects(setupWebhooks(env), /authentication failed|not Connected|no connector_extension|picker .* failed|malformed list/);
            if (['authError', 'consentCompletes'].includes(failure)) {
                assert.ok(!messages.some((message) => message.includes('authentication confirmed:')));
            }
            assert.equal(env.resources.size, 0);
            assert.equal(env.settings, undefined);
            assert.equal(env.outputs[config.savedInputsSetting], undefined);
        }
    });

    await test(`${app}: empty pickers allow manual IDs or skip the trigger on blank input`, async () => {
        const env = makeEnvironment();
        for (const blank of [false, true]) {
            let prompts = 0;
            const triggers = await collectWebhookTriggers({
                swagger: env.swagger, invoke: async () => ({ value: [] }),
                choose: env.choose, log: () => {},
                prompt: async (label, schema, options) => {
                    prompts++;
                    assert.deepEqual(options, { allowEmpty: true });
                    return blank ? '' : 'manual-id';
                },
            });
            assert.ok(prompts > 0);
            if (blank) {
                assert.equal(triggers.length, 0);
            } else {
                assert.equal(triggers.length, config.triggers.length);
                validateWebhookTriggers(triggers, env.swagger);
            }
        }
    });

    await test(`${app}: refuses Poll or unowned sources before any mutation`, async () => {
        for (const unowned of [false, true]) {
            const env = makeEnvironment();
            await setupWebhooks(env);
            const resource = [...env.resources.values()].at(-1);
            if (unowned) resource.properties.metadata.functionAppName = 'another-app';
            else resource.properties.deliveryMode = 'Poll';
            env.calls.length = 0;
            await assert.rejects(setupWebhooks(env), /unowned or Poll/);
            assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.command === 'azd' || call.args.includes('--settings')));
        }
    });

    await test(`${app}: failed source provisioning does not save selections or enable listeners`, async () => {
        const env = makeEnvironment();
        env.sourceState = 'Failed';
        await assert.rejects(setupWebhooks(env), /did not finish provisioning/);
        assert.equal(env.settings, undefined);
        assert.equal(env.outputs[config.savedInputsSetting], undefined);
    });
}
