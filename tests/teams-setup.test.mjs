// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TeamsTriggerOperations, TeamsTriggerParameters } from '../teamsApp/webhook/node_modules/@azure/connectors/dist/esm/generated/TeamsExtensions.js';
import { collectWebhookTriggers, operationRequest, webhookTriggers } from '../teamsApp/webhook/infra/scripts/setup-webhook-triggers.mjs';

// Only scalar descriptors come from the SDK. These synthetic dynamic schemas
// exercise server-defined fields without claiming a particular tenant schema.
function fixture() {
    const swagger = { paths: {}, definitions: {} };
    const notification = { type: 'string', 'x-ms-notification-url': true, 'x-ms-visibility': 'internal' };
    for (const trigger of webhookTriggers) {
        const key = Object.keys(TeamsTriggerOperations).find((key) => TeamsTriggerOperations[key] === trigger.operationName);
        assert.ok(key, `${trigger.operationName} must exist in the installed SDK.`);
        const parameters = Object.values(TeamsTriggerParameters[key] ?? {}).map((descriptor) => ({
            ...descriptor, in: 'query', enum: descriptor.allowedValues, 'x-ms-summary': descriptor.summary,
        }));
        const media = ['TranscriptTrigger', 'RecordingTrigger'].includes(trigger.operationName);
        parameters.push({
            name: 'requestBody', in: 'body', required: media || trigger.operationName === 'WebhookChatMessageTrigger',
            schema: media ? {
                type: 'object', required: ['notificationUrl', 'scope'],
                properties: {
                    notificationUrl: notification,
                    scope: { type: 'object', 'x-ms-dynamic-schema': {
                        operationId: 'GetScope', parameters: { scopeType: { parameter: 'scopeType' } }, 'value-path': 'schema',
                    } },
                },
            } : trigger.operationName === 'WebhookChatMessageTrigger'
                ? { type: 'object', properties: { notificationUrl: notification } }
                : { type: 'object', 'x-ms-dynamic-schema': {
                    operationId: 'GetThread', parameters: { threadType: { parameter: 'threadType' } }, 'value-path': 'schema',
                } },
        });
        swagger.paths[`/{connectionId}/${trigger.operationName}`] = { post: { operationId: trigger.operationName, parameters } };
    }
    return swagger;
}

function answersFor(scope, threadType = 'channel') {
    const calls = [];
    const menus = [];
    const freeForm = [];
    return {
        calls, menus, freeForm,
        choose: async (label, choices) => {
            menus.push({ label, choices });
            let value;
            if (label === 'Configure this trigger?') value = true;
            else if (label === 'Scope') value = scope;
            else if (label === 'Message type') value = threadType;
            else if (label === 'Trigger Frequency') value = 'Once';
            else if (label === 'Who can trigger?') value = 'Myself';
            else if (label.startsWith('Configure ') || label.startsWith('Add another')) value = false;
            else value = choices[0].value;
            assert.ok(choices.some((choice) => choice.value === value), `Expected a valid choice for ${label}.`);
            return value;
        },
        prompt: async (label) => {
            freeForm.push(label);
            return label === 'Keywords to search for' ? 'urgent,release|check' : 'supported-reaction-key';
        },
        invoke: async (id, values) => {
            calls.push({ id, values });
            if (id === 'GetThread') {
                const properties = values.threadType === 'channel' ? {
                    groupId: { type: 'string', title: 'Team', 'x-ms-dynamic-values': {
                        operationId: 'ListTeams', 'value-collection': 'value', 'value-path': 'id', 'value-title': 'name',
                    } },
                    channelId: { type: 'string', title: 'Channel', 'x-ms-dynamic-list': {
                        dynamicState: { extension: {
                            operationId: 'ListChannels', parameters: { groupId: { parameterReference: 'body/groupId' } },
                        } },
                        itemsPath: 'value', itemValuePath: 'id', itemTitlePath: 'name',
                    } },
                } : {
                    chatIds: { type: 'array', items: { type: 'string' }, 'x-ms-dynamic-values': {
                        operationId: 'ListChats', 'value-collection': 'value', 'value-path': 'id', 'value-title': 'name',
                    } },
                };
                return { schema: { type: 'object', required: Object.keys(properties), properties } };
            }
            if (id === 'GetScope') {
                return { schema: values.scopeType === 'meeting'
                    ? { type: 'object', required: ['meetingId'], properties: {
                        meetingId: { type: 'string', title: 'Meeting', 'x-ms-dynamic-values': {
                            operationId: 'ListMeetings', 'value-collection': 'value', 'value-path': 'id', 'value-title': 'name',
                        } },
                    } } : { type: 'object', properties: {} } };
            }
            return { value: [{ id: `${id}/selected-id`, name: 'Friendly display name' }] };
        },
        log: () => {},
    };
}

for (const scope of ['user', 'meeting', 'adhocCallUser']) {
    await test(`all seven webhooks collect inputs, with media scope ${scope}`, async () => {
        const input = answersFor(scope);
        const configs = await collectWebhookTriggers({ swagger: fixture(), ...input });
        assert.equal(configs.length, 7);
        assert.deepEqual(configs.map((config) => config.operationName), webhookTriggers.map((trigger) => trigger.operationName));
        const scopeMenus = input.menus.filter((menu) => menu.label === 'Scope');
        assert.equal(scopeMenus.length, 2, 'Recordings and transcripts choose their own scope.');
        for (const menu of scopeMenus) assert.deepEqual(menu.choices.map((choice) => choice.value), ['user', 'meeting', 'adhocCallUser']);
        for (const name of ['TranscriptTrigger', 'RecordingTrigger']) {
            const parameters = configs.find((config) => config.operationName === name).parameters;
            assert.equal(parameters.find((item) => item.name === 'scopeType').value, scope);
            assert.deepEqual(parameters.find((item) => item.name === 'body').value, {
                scope: scope === 'meeting' ? { meetingId: 'ListMeetings/selected-id' } : {},
            });
        }
        const mention = configs.find((config) => config.operationName === 'WebhookAtMentionTrigger');
        assert.deepEqual(mention.parameters.find((item) => item.name === 'body').value, {
            groupId: 'ListTeams/selected-id', channelId: 'ListChannels/selected-id',
        });
        assert.ok(input.calls.some((call) => call.id === 'ListChannels' && call.values.groupId === 'ListTeams/selected-id'));
        assert.ok(input.freeForm.includes('Keywords to search for'));
        assert.ok(input.freeForm.includes('Emoji to Track'), 'Do not invent an emoji enum when the connector exposes none.');
        assert.deepEqual(configs.find((config) => config.operationName === 'WebhookChatMessageTrigger').parameters, []);
        assert.ok(configs.every((config) => config.parameters.every((item) => item.name !== 'requestBody')));
        assert.doesNotMatch(JSON.stringify(configs), /notificationUrl/);
    });
}

await test('chat pickers keep selected IDs as arrays, not labels or scalar strings', async () => {
    const input = answersFor('user', 'groupchat');
    const configs = await collectWebhookTriggers({ swagger: fixture(), ...input });
    const mention = configs.find((config) => config.operationName === 'WebhookAtMentionTrigger');
    assert.deepEqual(mention.parameters.find((item) => item.name === 'body').value, { chatIds: ['ListChats/selected-id'] });
});

for (const legacyValues of [true, false]) {
    await test(`channel picker collects its optional team prerequisite first (${legacyValues ? 'dynamic-values' : 'dynamic-list'})`, async () => {
        const input = answersFor('user');
        const invoke = input.invoke;
        const calls = [];
        input.invoke = async (id, values) => {
            if (id === 'GetThread') return { schema: {
                type: 'object', required: ['notificationUrl', 'channels'],
                properties: {
                    channels: {
                        type: 'array', minItems: 1, maxItems: 10, 'x-ms-summary': 'Channels',
                        items: {
                            type: 'string',
                            'x-ms-dynamic-list': {
                                operationId: 'GetChannelsForGroup', itemsPath: 'value',
                                itemValuePath: 'id', itemTitlePath: 'displayName',
                                parameters: { groupId: { parameterReference: 'requestBody/groupId', required: true } },
                            },
                            ...(legacyValues ? { 'x-ms-dynamic-values': {
                                operationId: 'GetChannelsForGroup', 'value-collection': 'value',
                                'value-path': 'id', 'value-title': 'displayName',
                                parameters: { groupId: { parameter: 'groupId' } },
                            } } : {}),
                        },
                    },
                    groupId: {
                        type: 'string', title: 'Team',
                        'x-ms-dynamic-list': {
                            operationId: 'GetAllTeams', itemsPath: 'value',
                            itemValuePath: 'id', itemTitlePath: 'displayName',
                        },
                    },
                    notificationUrl: { type: 'string', 'x-ms-notification-url': true, 'x-ms-visibility': 'internal' },
                },
            } };
            if (id === 'GetAllTeams' || id === 'GetChannelsForGroup') {
                calls.push({ id, values });
                if (id === 'GetChannelsForGroup') assert.deepEqual(values, { groupId: 'selected-team' });
                return { value: [{ id: id === 'GetAllTeams' ? 'selected-team' : 'selected-channel', displayName: 'Picker label' }] };
            }
            return invoke(id, values);
        };
        const configs = await collectWebhookTriggers({ swagger: fixture(), ...input });
        const channelConfigs = configs.filter((config) => config.parameters.some((parameter) => parameter.name === 'threadType'));
        assert.equal(channelConfigs.length, 4);
        for (const config of channelConfigs) {
            assert.deepEqual(config.parameters.find((parameter) => parameter.name === 'body').value, {
                groupId: 'selected-team', channels: ['selected-channel'],
            });
        }
        assert.deepEqual(calls.map((call) => call.id), Array(4).fill(['GetAllTeams', 'GetChannelsForGroup']).flat());
        assert.ok(!input.menus.some((menu) => menu.label === 'Configure Team (optional)?'),
            'A field needed by the channel picker cannot be skipped.');
    });
}

await test('skipping the seven new triggers does not resolve schemas or require their inputs', async () => {
    const configs = await collectWebhookTriggers({
        swagger: { paths: {} }, choose: async () => false, log: () => {},
        invoke: () => assert.fail('Skipped triggers must not query the connector.'),
        prompt: () => assert.fail('Skipped triggers must not prompt for input.'),
    });
    assert.deepEqual(configs, []);
});

await test('missing dynamic schemas and empty picker lists fail rather than inventing subscription values', async () => {
    const emptySchema = answersFor('user');
    emptySchema.invoke = async () => ({});
    await assert.rejects(collectWebhookTriggers({ swagger: fixture(), ...emptySchema }), /No schema returned/);
    const emptyList = answersFor('user');
    const invoke = emptyList.invoke;
    emptyList.invoke = (id, values) => id.startsWith('List') ? { value: [] } : invoke(id, values);
    await assert.rejects(collectWebhookTriggers({ swagger: fixture(), ...emptyList }), /No choices returned/);
});

await test('connector requests resolve references, encode IDs, and preserve query/body values', () => {
    const swagger = { parameters: { team: { name: 'teamId', in: 'path', required: true } }, paths: {
        '/{connectionId}/teams/{teamId}': { get: {
            operationId: 'Lookup', parameters: [
                { $ref: '#/parameters/team' }, { name: '$search', in: 'query' }, { name: 'requestBody', in: 'body' },
            ],
        } },
    } };
    assert.deepEqual(operationRequest(swagger, 'Lookup', {
        teamId: 'team/+id', '$search': "urgent&'release'", requestBody: { nested: { ids: ['one', 'two'] } },
    }), {
        method: 'GET', path: '/teams/team%2F%2Bid', queries: { '$search': "urgent&'release'" },
        body: { nested: { ids: ['one', 'two'] } },
    });
    assert.throws(() => operationRequest(swagger, 'Lookup', {}), /requires teamId/);
});

await test('both hooks collect new inputs after OAuth and before creating any triggers', async () => {
    for (const suffix of ['sh', 'ps1']) {
        const hook = await readFile(new URL(`../teamsApp/webhook/infra/scripts/postdeploy.${suffix}`, import.meta.url), 'utf8');
        const setup = hook.indexOf('setup-webhook-triggers.mjs');
        const authorized = hook.indexOf(suffix === 'sh' ? 'if ! authorize_connection' : 'if (-not $authorized)');
        const create = hook.indexOf('az connector-namespace trigger create');
        assert.ok(authorized >= 0 && authorized < setup && setup < create);
        if (suffix === 'ps1') {
            assert.match(hook, /ConvertTo-Json -Compress -Depth 20 -AsArray/);
            assert.match(hook, /ConvertFrom-Json -AsHashtable/);
        } else {
            assert.ok(hook.includes('--parameters "@${parametersFile}"'));
        }
    }
});
