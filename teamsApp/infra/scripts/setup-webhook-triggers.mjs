// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

export const webhookTriggers = [
    { functionName: 'OnWebhookAtMention', operationName: 'WebhookAtMentionTrigger', title: "When I'm @mentioned" },
    { functionName: 'OnWebhookMessageReaction', operationName: 'WebhookMessageReactionTrigger', title: 'When someone reacted to a message in chat' },
    { functionName: 'OnTranscriptAvailable', operationName: 'TranscriptTrigger', title: 'When a transcript is available' },
    { functionName: 'OnRecordingAvailable', operationName: 'RecordingTrigger', title: 'When a recording is available' },
    { functionName: 'OnWebhookChatMessage', operationName: 'WebhookChatMessageTrigger', title: 'When a new chat message is added' },
    { functionName: 'OnWebhookKeyword', operationName: 'WebhookKeywordTrigger', title: 'When keywords are mentioned' },
    { functionName: 'OnWebhookNewMessage', operationName: 'WebhookNewMessageTrigger', title: 'When a new message is added to a chat or channel' },
];

function get(value, keyPath) {
    if (!keyPath) return value;
    if (Object.hasOwn(value ?? {}, keyPath)) return value[keyPath];
    return keyPath.split(/[/.]/).filter(Boolean).reduce((item, key) => item?.[key], value);
}

function resolve(swagger, schema) {
    if (!schema?.$ref) return schema;
    if (!schema.$ref.startsWith('#/')) throw new Error(`Unsupported external schema reference: ${schema.$ref}`);
    const target = get(swagger, schema.$ref.slice(2));
    if (!target) throw new Error(`Missing schema reference: ${schema.$ref}`);
    const { $ref, ...overrides } = schema;
    return { ...resolve(swagger, target), ...overrides };
}

function operation(swagger, id) {
    for (const [route, methods] of Object.entries(swagger.paths)) {
        for (const [method, definition] of Object.entries(methods)) {
            if (definition.operationId === id) {
                return {
                    route, method,
                    parameters: [...(methods.parameters ?? []), ...(definition.parameters ?? [])].map((p) => resolve(swagger, p)),
                };
            }
        }
    }
    throw new Error(`The Teams connector does not expose ${id} in this region.`);
}

export function operationRequest(swagger, id, values) {
    const op = operation(swagger, id);
    const request = { method: op.method.toUpperCase(), path: op.route.replace(/^\/\{connectionId\}/, '') };
    for (const parameter of op.parameters) {
        if (parameter.name === 'connectionId') continue;
        const value = values[parameter.name];
        if (value === undefined) {
            if (parameter.required) throw new Error(`${id} requires ${parameter.name}.`);
            continue;
        }
        if (parameter.in === 'path') {
            request.path = request.path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
        } else if (parameter.in === 'query') {
            (request.queries ??= {})[parameter.name] = value;
        } else if (parameter.in === 'body') {
            request.body = value;
        }
    }
    if (/\{[^}]+\}/.test(request.path)) throw new Error(`Unresolved path parameters for ${id}.`);
    return request;
}

export async function collectWebhookTriggers({ swagger, invoke, choose, prompt, log = console.log }) {
    function dynamicSpec(extension) {
        return extension.operationId ? extension : { ...extension, ...(extension.dynamicState?.extension ?? extension.dynamicState) };
    }

    async function dynamic(extension, answers) {
        extension = dynamicSpec(extension);
        if (!extension?.operationId) throw new Error('The connector picker has no operation ID.');
        const parameters = {};
        for (const [key, binding] of Object.entries(extension.parameters ?? {})) {
            const reference = binding?.parameter ?? binding?.parameterReference;
            const value = reference
                ? get(answers, reference) ?? get(answers.body, reference)
                : binding?.value ?? binding;
            if (value === undefined) throw new Error(`Select ${reference} before resolving ${extension.operationId}.`);
            parameters[key] = value;
        }
        return invoke(extension.operationId, parameters);
    }

    async function collect(input, label, answers, keyPath, required = true) {
        let schema = resolve(swagger, input);
        if (!required) {
            const include = await choose(`Configure ${label} (optional)?`, [
                { label: 'Skip', value: false }, { label: 'Configure', value: true },
            ]);
            if (!include) return undefined;
        }
        const schemaExtension = schema['x-ms-dynamic-schema'] && dynamicSpec(schema['x-ms-dynamic-schema']);
        if (schemaExtension) {
            const result = await dynamic(schemaExtension, answers);
            const resolved = get(result, schemaExtension['value-path'] ?? schemaExtension.valuePath);
            if (!resolved || typeof resolved !== 'object') throw new Error(`No schema returned for ${label}.`);
            schema = { ...schema, ...resolve(swagger, resolved) };
            delete schema['x-ms-dynamic-schema'];
        }
        if (schema.type === 'array') {
            const items = [];
            const itemSchema = {
                ...schema.items,
                ...(schema['x-ms-dynamic-values'] ? { 'x-ms-dynamic-values': schema['x-ms-dynamic-values'] } : {}),
                ...(schema['x-ms-dynamic-list'] ? { 'x-ms-dynamic-list': schema['x-ms-dynamic-list'] } : {}),
            };
            do {
                items.push(await collect(itemSchema, `${label} (${items.length + 1})`, answers, [...keyPath, String(items.length)]));
            } while (items.length < (schema.minItems ?? 1) || (
                items.length < (schema.maxItems ?? Infinity) && await choose(`Add another ${label}?`, [
                    { label: 'No', value: false }, { label: 'Yes', value: true },
                ])
            ));
            return items;
        }
        const values = schema['x-ms-dynamic-values'] ?? schema['x-ms-dynamic-list'];
        const valuesExtension = values && dynamicSpec(values);
        if (valuesExtension) {
            const result = await dynamic(valuesExtension, answers);
            const items = get(result, valuesExtension['value-collection'] ?? valuesExtension.valueCollection ?? valuesExtension.itemsPath);
            if (!Array.isArray(items) || items.length === 0) throw new Error(`No choices returned for ${label}.`);
            const choices = items.map((item) => ({
                value: get(item, valuesExtension['value-path'] ?? valuesExtension.valuePath ?? valuesExtension.itemValuePath),
                label: get(item, valuesExtension['value-title'] ?? valuesExtension.valueTitle ?? valuesExtension.itemTitlePath),
            }));
            if (choices.some((item) => item.value === undefined || item.label === undefined)) {
                throw new Error(`Invalid picker response for ${label}.`);
            }
            return choose(label, choices);
        }
        if (schema.enum) {
            return choose(label, schema.enum.map((value) => ({
                value,
                label: schema['x-ms-enum-values']?.find((item) => item.value === value)?.displayName ?? String(value),
            })));
        }
        if (schema.type === 'object' || schema.properties) {
            const result = {};
            let parent = answers;
            for (const key of keyPath.slice(0, -1)) parent = parent[key] ??= {};
            parent[keyPath.at(-1)] = result;
            for (const [key, property] of Object.entries(schema.properties ?? {})) {
                const field = resolve(swagger, property);
                // Connector Namespace supplies its subscription callback, not the Function App URL.
                if (field['x-ms-notification-url'] || field.readOnly) continue;
                if (field['x-ms-visibility'] === 'internal') {
                    if (field.default !== undefined) result[key] = field.default;
                    continue;
                }
                const value = await collect(field, field['x-ms-summary'] ?? field.title ?? key, answers,
                    [...keyPath, key], schema.required?.includes(key) || field.required === true);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        if (schema.type === 'boolean') {
            return choose(label, [{ label: 'Yes', value: true }, { label: 'No', value: false }]);
        }
        if (!['string', 'integer', 'number'].includes(schema.type)) {
            throw new Error(`Unsupported input schema for ${label}; no trigger will be created with guessed values.`);
        }
        return prompt(label, schema);
    }

    const triggers = [];
    for (const trigger of webhookTriggers) {
        log(`\n${trigger.title} (${trigger.operationName})`);
        if (!await choose('Configure this trigger?', [{ label: 'Configure', value: true }, { label: 'Skip', value: false }])) {
            log(`Skipped ${trigger.operationName}; its function still registers.`);
            continue;
        }
        const answers = {};
        const parameters = [];
        for (const parameter of operation(swagger, trigger.operationName).parameters) {
            if (parameter.in === 'body' || parameter.name === 'connectionId' || !parameter.required) continue;
            const value = await collect(parameter, parameter['x-ms-summary'] ?? parameter.name, answers, [parameter.name]);
            answers[parameter.name] = value;
            parameters.push({ name: parameter.name, value });
        }
        const body = operation(swagger, trigger.operationName).parameters.find((parameter) => parameter.in === 'body');
        if (body) {
            const value = await collect(body.schema, 'Subscription details', answers, ['body']);
            if (Object.keys(value).length) parameters.push({ name: 'body', value });
        }
        triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName, parameters });
    }
    return triggers;
}

function az(args) {
    // Azure CLI is a .cmd shim on Windows. Pass arguments through the environment,
    // not interpolated PowerShell/cmd source; JSON request bodies use @files.
    const result = process.platform === 'win32'
        ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            '& az @($env:TEAMS_SETUP_ARGS | ConvertFrom-Json); exit $LASTEXITCODE'], {
            encoding: 'utf8', env: { ...process.env, TEAMS_SETUP_ARGS: JSON.stringify(args) }, maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
        })
        : spawnSync('az', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
    if (result.error || result.status !== 0) throw new Error(`Azure CLI failed: ${result.error?.message ?? result.stderr}`);
    return result.stdout.trim();
}

async function main() {
    const [resourceGroup, namespaceName, connectionName, outputFile] = process.argv.slice(2);
    if (!resourceGroup || !namespaceName || !connectionName || !outputFile) {
        throw new Error('Expected resource group, namespace, connection, and output file.');
    }
    if (!process.stdin.isTTY) throw new Error('Teams webhook setup requires an interactive terminal. Run azd hooks run postdeploy interactively.');
    const temporary = mkdtempSync(path.join(tmpdir(), 'teams-webhook-'));
    const inputFile = path.join(temporary, 'request.json');
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const cancelled = new AbortController();
    terminal.on('SIGINT', () => cancelled.abort());
    terminal.on('close', () => cancelled.abort());
    try {
        const namespace = JSON.parse(az(['connector-namespace', 'show', '-g', resourceGroup, '-n', namespaceName, '-o', 'json']));
        const subscription = namespace.id.split('/')[2];
        const exportUrl = `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.Web/locations/${encodeURIComponent(namespace.location)}/managedApis/teams`;
        const exported = JSON.parse(az(['rest', '--method', 'GET', '--url', exportUrl,
            '--url-parameters', 'api-version=2016-06-01', 'export=true', '-o', 'json']));
        const definition = exported.properties?.apiDefinitions?.value ?? exported;
        const swagger = typeof definition === 'string' ? JSON.parse(definition) : definition;
        if (!swagger.paths) throw new Error('Teams Swagger export contains no operations.');
        const invoke = async (id, values) => {
            writeFileSync(inputFile, JSON.stringify({ request: operationRequest(swagger, id, values) }), { mode: 0o600 });
            const response = JSON.parse(az(['rest', '--method', 'POST',
                '--url', `https://management.azure.com${namespace.id}/connections/${encodeURIComponent(connectionName)}/dynamicInvoke`,
                '--url-parameters', 'api-version=2026-05-01-preview', '--body', `@${inputFile}`, '-o', 'json'])).response;
            if (!response || !['200', '201', 'OK', 'Created'].includes(String(response.statusCode))) {
                throw new Error(`Connector lookup ${id} failed: ${JSON.stringify(response?.body ?? response)}`);
            }
            return typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        };
        const choose = async (label, choices) => {
            console.log(`\n${label}`);
            choices.forEach((item, index) => console.log(`  [${index + 1}] ${item.label}`));
            while (true) {
                const answer = (await terminal.question(`Enter number (1-${choices.length}): `, { signal: cancelled.signal })).trim();
                if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= choices.length) {
                    return choices[Number(answer) - 1].value;
                }
                console.log('Invalid selection.');
            }
        };
        const prompt = async (label, schema) => {
            while (true) {
                const answer = (await terminal.question(`${label}${schema.description ? ` (${schema.description})` : ''}: `, { signal: cancelled.signal })).trim();
                if (schema.type === 'string' && answer.length >= Math.max(1, schema.minLength ?? 0)
                    && (schema.maxLength === undefined || answer.length <= schema.maxLength)
                    && (!schema.pattern || new RegExp(schema.pattern).test(answer))) return answer;
                const number = Number(answer);
                if (answer && ['number', 'integer'].includes(schema.type) && Number.isFinite(number)
                    && (schema.type !== 'integer' || Number.isInteger(number))
                    && (schema.minimum === undefined || number >= schema.minimum)
                    && (schema.maximum === undefined || number <= schema.maximum)) return number;
                console.log('Enter a non-empty value matching the requested type and constraints.');
            }
        };
        const triggers = await collectWebhookTriggers({ swagger, invoke, choose, prompt });
        writeFileSync(outputFile, JSON.stringify(triggers), { mode: 0o600 });
    } finally {
        terminal.close();
        rmSync(inputFile, { force: true });
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error(`Teams webhook setup failed: ${error.message}`);
        process.exitCode = 1;
    });
}
