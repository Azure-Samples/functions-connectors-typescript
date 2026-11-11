// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectWebhookTriggers, operationRequest, webhookTriggers } from '../vstsApp/webhook/infra/scripts/trigger-inputs.mjs';
import { setupWebhooks } from '../vstsApp/webhook/infra/scripts/postdeploy.mjs';

function fixture() {
    const swagger = { paths: {} };
    const selector = (name, id, label, dependencies = [], valuePath = 'name', required = true, location = 'query') => ({
        name, in: location, type: 'string', required, 'x-ms-summary': label,
        'x-ms-dynamic-values': {
            operationId: id, parameters: Object.fromEntries(dependencies.map((key) => [key, { parameter: key }])),
            'value-collection': 'value', 'value-path': valuePath, 'value-title': valuePath,
        },
    });
    const optional = (name, label) => ({ name, in: 'query', type: 'string', required: false, 'x-ms-summary': label });
    for (const trigger of webhookTriggers) {
        const parameters = [
            { name: 'connectionId', in: 'path', required: true, type: 'string', 'x-ms-visibility': 'internal' },
            selector('account', 'ListAccounts', 'Organization Name', [], 'accountName'),
            selector('project', 'ListProjects', 'Project Name', ['account'], 'name', true, 'path'),
        ];
        if (/Git/.test(trigger.operationName)) {
            parameters.push(selector('repository', 'ListGitRepositories', 'Repository Name', ['account', 'project'], 'name', true, 'path'));
            for (const name of trigger.operationName === 'OnGitPush' ? ['refName'] : ['sourceRefName', 'targetRefName']) {
                parameters.push(selector(name, 'ListGitRefs', name, ['account', 'project', 'repository'], 'name', false));
            }
        } else if (trigger.operationName === 'OnBuildCompleted') parameters.push(
            { ...optional('resultFilter', 'Filter By Result'), enum: ['', 'succeeded', 'partiallySucceeded', 'failed', 'canceled'] },
            optional('definitions', 'Filter By Definition Id'),
        );
        else {
            const assigned = trigger.operationName === 'OnWorkItemAssignedV2';
            parameters.push(
                selector('team', 'ListTeams', 'Team Name', ['account', 'project'], 'name', assigned),
                selector(trigger.operationName === 'OnTfvcCheckIn' ? 'author' : 'wiql__System_AssignedTo',
                    'ListTeamMembers', 'Team Member', ['account', 'project', 'team'], 'uniqueName', assigned),
            );
            if (trigger.operationName !== 'OnTfvcCheckIn') {
                parameters.push(selector('wiql__System_WorkItemType', 'ListWorkItemTypes', 'Type', ['account', 'project'], 'name', false));
                for (const name of ['wiql__System_AreaPath', 'wiql__System_IterationPath', 'wiql__Microsoft_VSTS_Common_Priority', 'wiql__System_CreatedBy']) {
                    parameters.push(optional(name, name));
                }
                for (const name of ['areaPathComparison', 'iterationPathComparison']) parameters.push({
                    ...optional(name, name), enum: ['Equals', 'Under'], default: 'Equals',
                });
                if (trigger.operationName === 'OnWorkItemClosedV2') parameters.push({
                    ...optional('closedState', 'Closed State'), default: 'Done, Closed, Completed, Inactive',
                });
            }
        }
        swagger.paths[`/{connectionId}/${trigger.operationName}/{project}`] = { get: { operationId: trigger.operationName, parameters } };
    }
    for (const [id, route, parameters] of [
        ['ListAccounts', '/_apis/Accounts', []],
        ['ListProjects', '/_apis/projects', [{ name: 'account', in: 'query', required: true }]],
        ['ListGitRepositories', '/{project}/_apis/git/repositories', [{ name: 'account', in: 'query', required: true }, { name: 'project', in: 'path', required: true }]],
        ['ListGitRefs', '/{project}/_apis/git/repositories/{repository}/refs', [
            { name: 'account', in: 'query', required: true }, { name: 'project', in: 'path', required: true }, { name: 'repository', in: 'path', required: true },
        ]],
        ['ListTeams', '/_apis/projects/{project}/teams', [{ name: 'account', in: 'query', required: true }, { name: 'project', in: 'path', required: true }]],
        ['ListTeamMembers', '/_apis/projects/{project}/teams/{team}/members', [
            { name: 'account', in: 'query', required: true }, { name: 'project', in: 'path', required: true }, { name: 'team', in: 'path', required: true },
        ]],
        ['ListWorkItemTypes', '/_apis/wit/workitemtypes', [{ name: 'account', in: 'query', required: true }, { name: 'project', in: 'query', required: true }]],
    ]) swagger.paths[`/{connectionId}${route}`] = { get: { operationId: id, parameters } };
    return swagger;
}

const pickerResults = {
    ListAccounts: { value: [{ accountName: 'test-org' }] },
    ListProjects: { value: [{ name: 'Project & Test' }] },
    ListGitRepositories: { value: [{ name: 'Repository' }] },
    ListGitRefs: { value: [{ name: 'refs/heads/main' }] },
    ListTeams: { value: [{ name: 'Test Team' }] },
    ListTeamMembers: { value: [{ uniqueName: 'member@example.test' }] },
    ListWorkItemTypes: { value: [{ name: 'Issue' }] },
};

function environment() {
    const swagger = fixture();
    const outputs = {
        resourceGroupName: 'rg-test', functionAppName: 'func-test', FUNCTION_APP_HOSTNAME: 'func-test.azurewebsites.net',
        connectorNamespaceName: 'cn-test',
        connectorNamespaceResourceId: '/subscriptions/test-sub/resourceGroups/rg-test/providers/Microsoft.Web/connectorGateways/cn-test',
        connectorNamespaceConnectionName: 'vsts-test', CONNECTOR_NAMESPACE_LOCATION: 'brazilsouth',
        vstsConnectionRuntimeUrl: 'https://connection.example',
    };
    const resources = new Map();
    const calls = [];
    const responses = structuredClone(pickerResults);
    let connected = false;
    let consentCompletes = true;
    let settings;
    let pickerStatus = 200;
    let sourceState = 'Succeeded';
    let key = 'connector-test-key';
    let selectTrigger = true;
    let connectionErrors = [];
    let authenticationError;
    let authenticationMode = 'EntraOAuth';
    return {
        outputs, resources, calls, responses,
        get settings() { return settings; },
        set connected(value) { connected = value; },
        set consentCompletes(value) { consentCompletes = value; },
        set pickerStatus(value) { pickerStatus = value; },
        set sourceState(value) { sourceState = value; },
        set key(value) { key = value; },
        set selectTrigger(value) { selectTrigger = value; },
        set connectionErrors(value) { connectionErrors = value; },
        set authenticationError(value) { authenticationError = value; },
        set authenticationMode(value) { authenticationMode = value; },
        choose: async (label, choices) => {
            assert.ok(choices.length, 'Never display an empty picker.');
            if (label === 'Configure this trigger?') return selectTrigger;
            assert.ok(!label.startsWith('Configure '), 'Only ask whether to configure each trigger, not optional filters.');
            return choices[0].value;
        },
        prompt: async () => assert.fail('All current required selectors have authenticated pickers.'),
        wait: async () => {},
        log: () => {},
        run: async (command, args, options) => {
            const body = args.includes('--body') ? JSON.parse(await readFile(args[args.indexOf('--body') + 1].slice(1), 'utf8')) : undefined;
            calls.push({ command, args, body, options });
            if (command === 'azd') {
                assert.equal(args[2], 'VSTS_WEBHOOK_TRIGGER_INPUTS');
                outputs.VSTS_WEBHOOK_TRIGGER_INPUTS = args[3];
                return '';
            }
            assert.equal(args[args.indexOf('--subscription') + 1], 'test-sub', 'Use the deployed subscription, not the current CLI default.');
            if (args.includes('authenticate')) {
                assert.equal(args[args.indexOf('--connection-name') + 1], 'vsts-test');
                assert.ok(args.includes('--no-access-policy'), 'Preserve the access policies provisioned by Bicep.');
                assert.ok(!args.some((arg) => ['--tenant-id', '--object-id', '--redirect-url', '--no-browser'].includes(arg)),
                    'Use normal browser consent with automatic callback capture, not forced delegation or a portal redirect.');
                assert.deepEqual(options, { interactive: true }, 'Show CLI consent instructions and errors as they happen.');
                if (authenticationError) throw authenticationError;
                connected = consentCompletes;
                return '';
            }
            if (args[0] === 'functionapp') {
                if (args[1] === 'keys') return JSON.stringify({ systemKeys: { connector_extension: key } });
                settings = JSON.parse(await readFile(args[args.indexOf('--settings') + 1].slice(1), 'utf8'));
                return '';
            }
            assert.equal(args[0], 'rest');
            const method = args[args.indexOf('--method') + 1];
            const url = new URL(args[args.indexOf('--url') + 1]);
            if (url.pathname.includes('/managedApis/')) {
                assert.ok(url.pathname.endsWith('/visualstudioteamservices'));
                return JSON.stringify(swagger);
            }
            if (url.pathname.endsWith('/dynamicInvoke')) {
                assert.ok(connected, 'Authenticate before listing sources.');
                const id = Object.keys(responses).find((key) => isRequest(key, body.request));
                assert.ok(id, `Unexpected picker request: ${JSON.stringify(body.request)}`);
                return JSON.stringify({ response: { statusCode: pickerStatus, body: JSON.stringify(responses[id]) } });
            }
            if (url.pathname.includes('/connections/')) return JSON.stringify({ properties: {
                parameterValueSet: authenticationMode ? { name: authenticationMode, values: {} } : undefined,
                overallStatus: connected ? 'Connected' : connectionErrors.length ? 'Error' : 'NotConnected',
                statuses: connected ? [] : connectionErrors.map((code) => ({ status: 'Error', target: 'token', error: { code } })),
            } });
            if (url.pathname.endsWith('/triggerConfigs')) return JSON.stringify({ value: [...resources.values()] });
            const name = decodeURIComponent(url.pathname.split('/').at(-1));
            if (method === 'GET') return JSON.stringify(resources.get(name));
            assert.equal(method, 'PUT', 'Never delete subscriptions during setup.');
            const resource = { name, properties: { ...body.properties, provisioningState: sourceState } };
            resources.set(name, resource);
            return JSON.stringify(resource);
        },
    };
    function isRequest(id, request) {
        return JSON.stringify(operationRequest(swagger, id, {
            account: 'test-org', project: 'Project & Test', repository: 'Repository', team: 'Test Team',
        })) === JSON.stringify(request);
    }
}

test('VSTS authorizes, uses authenticated pickers for all nine operations, and reruns without replacing subscriptions', async () => {
    const env = environment();
    await setupWebhooks({ ...env, outputs: env.outputs });
    assert.equal(env.resources.size, webhookTriggers.length);
    assert.ok(env.calls.some((call) => call.args.includes('authenticate')));
    const saved = JSON.parse(Buffer.from(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, 'base64').toString('utf8'));
    for (const trigger of webhookTriggers) {
        const resource = env.resources.get(`vsts-test-${trigger.functionName.toLowerCase()}`);
        assert.equal(resource.properties.operationName, trigger.operationName);
        assert.deepEqual(resource.properties.connectionDetails, { connectorName: 'visualstudioteamservices', connectionName: 'vsts-test' });
        assert.equal(resource.properties.deliveryMode, undefined, 'Webhook is the default delivery model.');
        assert.equal(resource.properties.notificationDetails.callbackUrl,
            `https://func-test.azurewebsites.net/runtime/webhooks/connector?functionName=${trigger.functionName}`);
        assert.deepEqual(resource.properties.notificationDetails.authentication, { type: 'QueryString', name: 'code', value: 'connector-test-key' });
        const parameters = Object.fromEntries(resource.properties.parameters.map((item) => [item.name, item.value]));
        assert.equal(parameters.account, 'test-org');
        assert.equal(parameters.project, 'Project & Test');
        if (/Git/.test(trigger.operationName)) assert.equal(parameters.repository, 'Repository');
        if (trigger.operationName === 'OnWorkItemAssignedV2') {
            assert.equal(parameters.team, 'Test Team');
            assert.equal(parameters.wiql__System_AssignedTo, 'member@example.test');
        }
        assert.deepEqual(saved.find((item) => item.functionName === trigger.functionName).parameters, resource.properties.parameters);
        assert.equal(env.settings[`AzureWebJobs.${trigger.functionName}.Disabled`], 'false');
    }
    assert.equal(env.settings.VstsConnection, env.outputs.vstsConnectionRuntimeUrl);
    assert.equal(env.calls.filter((call) => call.body?.request?.path === '/_apis/Accounts').length, 1, 'Cache shared picker responses across triggers.');
    assert.ok(env.calls.every((call) => !call.args.some((arg) => arg.includes('connector-test-key'))), 'Keep system keys out of CLI arguments.');
    env.calls.length = 0;
    await setupWebhooks({ ...env, outputs: env.outputs, choose: () => assert.fail('Saved selectors must not reprompt.') });
    assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.body?.request
        || call.args.includes('authenticate')));
});

test('VSTS verifies connection status after the CLI completes consent instead of trusting a browser redirect', async () => {
    const env = environment();
    env.consentCompletes = false;
    env.connectionErrors = ['Unauthenticated'];
    const messages = [];
    await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs, log: (message) => messages.push(message) }),
        /not Connected after authentication.*Unauthenticated.*resources are already deployed/);
    assert.ok(messages.some((message) => message.includes('normal browser')));
    assert.ok(messages.some((message) => message.includes('CLI confirms authorization')));
    assert.equal(env.resources.size, 0);
    assert.equal(env.settings, undefined);
    assert.equal(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, undefined);
});

test('VSTS failed CLI consent stops before source configuration and preserves deployed resources', async () => {
    const env = environment();
    env.authenticationError = new Error('Authentication was denied.');
    await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }), /authentication failed.*resources are already deployed.*hooks run postdeploy/);
    assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.body?.request || call.args.includes('keys')));
    assert.equal(env.resources.size, 0);
    assert.equal(env.settings, undefined);
    assert.equal(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, undefined);
});

test('VSTS rejects legacy OAuth before opening another doomed consent flow', async () => {
    for (const mode of [undefined, 'oauth']) {
        const env = environment();
        env.authenticationMode = mode;
        await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }), /requires an EntraOAuth connection.*Recreate the legacy connection.*azd provision alone cannot migrate/);
        assert.ok(!env.calls.some((call) => call.args.includes('authenticate') || call.args.includes('PUT') || call.body?.request));
        assert.equal(env.resources.size, 0);
        assert.equal(env.settings, undefined);
        assert.equal(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, undefined);
    }
});

test('VSTS prompts only for required selectors for all nine triggers and never looks up optional filters', async () => {
    const swagger = fixture();
    const lookups = [];
    const requiredParameters = {
        OnBuildCompleted: ['account', 'project'],
        OnGitPullClosed: ['account', 'project', 'repository'],
        OnGitPullCreated: ['account', 'project', 'repository'],
        OnGitPush: ['account', 'project', 'repository'],
        OnTfvcCheckIn: ['account', 'project'],
        OnWorkItemAssignedV2: ['account', 'project', 'team', 'wiql__System_AssignedTo'],
        OnWorkItemClosedV2: ['account', 'project'],
        OnWorkItemCreatedV2: ['account', 'project'],
        OnWorkItemUpdatedV2: ['account', 'project'],
    };
    const inputs = await collectWebhookTriggers({
        swagger, invoke: async (id, values) => {
            assert.ok(!['ListGitRefs', 'ListWorkItemTypes'].includes(id), 'Optional picker failures must not affect setup.');
            if (id === 'ListTeamMembers') assert.equal(values.team, 'Test Team');
            lookups.push(id);
            return pickerResults[id];
        },
        choose: async (label, choices) => {
            if (label === 'Configure this trigger?') return true;
            assert.ok(['Organization Name', 'Project Name', 'Repository Name', 'Team Name', 'Team Member'].includes(label),
                `Unexpected optional prompt: ${label}`);
            return choices[0].value;
        },
        prompt: async () => assert.fail('Do not ask for build definition IDs or other optional free-text filters.'),
        log: () => {},
    });
    assert.equal(inputs.length, webhookTriggers.length);
    for (const input of inputs) {
        assert.deepEqual(input.parameters.map((p) => p.name), requiredParameters[input.operationName],
            `${input.operationName} must omit optional values, including explicit defaults.`);
    }
    assert.equal(lookups.filter((id) => id === 'ListTeams').length, 1, 'Only assigned-work-item events require a team.');
    assert.equal(lookups.filter((id) => id === 'ListTeamMembers').length, 1, 'Only assigned-work-item events require a member.');
});

test('VSTS unavailable required repositories, teams, or members skip only their affected triggers', async () => {
    for (const [picker, skipped] of [
        ['ListGitRepositories', ['OnVstsGitPullClosed', 'OnVstsGitPullCreated', 'OnVstsGitPush']],
        ['ListTeams', ['OnVstsWorkItemAssigned']],
        ['ListTeamMembers', ['OnVstsWorkItemAssigned']],
    ]) {
        const env = environment();
        env.responses[picker] = { value: [] };
        await setupWebhooks({ ...env, outputs: env.outputs });
        assert.equal(env.resources.size, webhookTriggers.length - skipped.length);
        for (const { functionName } of webhookTriggers) {
            assert.equal(env.settings[`AzureWebJobs.${functionName}.Disabled`], String(skipped.includes(functionName)));
        }
    }
});

test('VSTS deselection disables owned sources without losing selectors, and key rotation updates callbacks', async () => {
    const env = environment();
    await setupWebhooks({ ...env, outputs: env.outputs });
    const before = structuredClone(env.resources);
    const saved = JSON.parse(Buffer.from(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, 'base64').toString('utf8')).slice(1);
    env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS = Buffer.from(JSON.stringify(saved)).toString('base64');
    env.key = 'rotated-test-key';
    await setupWebhooks({ ...env, outputs: env.outputs });
    const removed = webhookTriggers[0].functionName;
    for (const [name, resource] of env.resources) {
        assert.deepEqual(resource.properties.parameters, before.get(name).properties.parameters);
        assert.equal(resource.properties.state, resource.properties.metadata.functionName === removed ? 'Disabled' : 'Enabled');
        if (resource.properties.state === 'Enabled') assert.equal(resource.properties.notificationDetails.authentication.value, 'rotated-test-key');
    }
    assert.equal(env.settings[`AzureWebJobs.${removed}.Disabled`], 'true');
});

test('VSTS refuses to overwrite a Poll source or another app before changing any subscriptions', async () => {
    for (const change of [{ deliveryMode: 'Poll' }, { metadata: { functionAppName: 'someone-else' } }]) {
        const env = environment();
        await setupWebhooks({ ...env, outputs: env.outputs });
        Object.assign(env.resources.values().next().value.properties, change);
        const before = structuredClone(env.resources);
        env.calls.length = 0;
        await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }), /Refusing to overwrite/);
        assert.deepEqual(env.resources, before);
        assert.ok(!env.calls.some((call) => call.args.includes('PUT') || call.args.includes('appsettings')));
    }
});

test('VSTS consent timeout, lookup errors, malformed results, and all-skipped selections fail before configuring sources', async () => {
    for (const scenario of ['consent', 'lookup', 'malformed', 'no-organizations', 'skip-all', 'no-key']) {
        const env = environment();
        if (scenario === 'consent') env.consentCompletes = false;
        if (scenario === 'lookup') env.pickerStatus = 403;
        if (scenario === 'malformed') env.responses.ListAccounts = {};
        if (scenario === 'no-organizations') env.responses.ListAccounts = { value: [] };
        if (scenario === 'skip-all') env.selectTrigger = false;
        if (scenario === 'no-key') env.key = undefined;
        await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }),
            /not Connected after authentication|picker .* failed|Invalid picker response|distinct selected trigger|no connector_extension/);
        assert.equal(env.resources.size, 0, scenario);
        assert.equal(env.settings, undefined, scenario);
        assert.equal(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, undefined, scenario);
    }
});

test('VSTS validates saved operations and required selectors before any writes', async () => {
    const valid = { ...webhookTriggers[0], parameters: [{ name: 'account', value: 'org' }, { name: 'project', value: 'project' }] };
    for (const inputs of [
        [{ ...valid, operationName: 'wrong' }], [{ ...valid, parameters: [] }], [valid, valid],
        [{ ...valid, parameters: [...valid.parameters, { name: 'account', value: 'duplicate' }] }],
        [{ ...valid, parameters: [...valid.parameters, { name: 'guessed', value: 'value' }] }],
    ]) {
        const env = environment();
        env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS = Buffer.from(JSON.stringify(inputs)).toString('base64');
        await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }), /Saved webhook inputs|distinct selected trigger/);
        assert.equal(env.resources.size, 0);
        assert.equal(env.settings, undefined);
        assert.ok(!env.calls.some((call) => call.args.includes('keys') || call.args.includes('PUT')));
    }
});

test('VSTS failed or canceled provisioning does not save selections and can be retried', async () => {
    for (const state of ['Failed', 'Canceled', 'Cancelled']) {
        const env = environment();
        env.sourceState = state;
        await assert.rejects(setupWebhooks({ ...env, outputs: env.outputs }), /source-registration status and permissions/);
        assert.equal(env.settings, undefined);
        assert.equal(env.outputs.VSTS_WEBHOOK_TRIGGER_INPUTS, undefined);
        env.sourceState = 'Succeeded';
        await setupWebhooks({ ...env, outputs: env.outputs });
        assert.equal(env.resources.size, webhookTriggers.length);
    }
});
