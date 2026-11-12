// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

export const webhookTriggers = [
    { functionName: 'OnVstsBuildCompleted', operationName: 'OnBuildCompleted' },
    { functionName: 'OnVstsGitPullClosed', operationName: 'OnGitPullClosed' },
    { functionName: 'OnVstsGitPullCreated', operationName: 'OnGitPullCreated' },
    { functionName: 'OnVstsGitPush', operationName: 'OnGitPush' },
    { functionName: 'OnVstsTfvcCheckIn', operationName: 'OnTfvcCheckIn' },
    { functionName: 'OnVstsWorkItemAssigned', operationName: 'OnWorkItemAssignedV2' },
    { functionName: 'OnVstsWorkItemClosed', operationName: 'OnWorkItemClosedV2' },
    { functionName: 'OnVstsWorkItemCreated', operationName: 'OnWorkItemCreatedV2' },
    { functionName: 'OnVstsWorkItemUpdated', operationName: 'OnWorkItemUpdatedV2' },
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
            if (definition.operationId === id) return {
                route, method,
                parameters: [...(methods.parameters ?? []), ...(definition.parameters ?? [])].map((p) => resolve(swagger, p)),
            };
        }
    }
    throw new Error(`The Azure DevOps connector does not expose ${id} in this region.`);
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
            const encoded = encodeURIComponent(String(value));
            request.path = request.path.replace(`{${parameter.name}}`,
                parameter['x-ms-url-encoding'] === 'double' ? encodeURIComponent(encoded) : encoded);
        } else if (parameter.in === 'query') {
            (request.queries ??= {})[parameter.name] = value;
        } else {
            throw new Error(`Unsupported picker parameter ${parameter.name} for ${id}.`);
        }
    }
    if (/\{[^}]+\}/.test(request.path)) throw new Error(`Unresolved path parameters for ${id}.`);
    return request;
}

export function validateWebhookTriggers(triggers, swagger) {
    if (!Array.isArray(triggers) || !triggers.length
        || new Set(triggers.map((trigger) => trigger?.functionName)).size !== triggers.length) {
        throw new Error('Webhook setup requires at least one distinct selected trigger.');
    }
    for (const trigger of triggers) {
        const definition = webhookTriggers.find((item) => item.functionName === trigger?.functionName);
        const parameters = definition && operation(swagger, definition.operationName).parameters
            .filter((p) => p.name !== 'connectionId' && p['x-ms-visibility'] !== 'internal' && !p.readOnly);
        if (!definition || trigger.operationName !== definition.operationName || !Array.isArray(trigger.parameters)
            || new Set(trigger.parameters.map((p) => p?.name)).size !== trigger.parameters.length
            || trigger.parameters.some((p) => !parameters.some((expected) => expected.name === p?.name)
                || typeof p?.value !== 'string')
            || parameters.some((p) => p.required && !trigger.parameters.some((v) => v.name === p.name && v.value.trim()))) {
            throw new Error('Saved webhook inputs do not match this project. Clear VSTS_WEBHOOK_TRIGGER_INPUTS and rerun setup.');
        }
    }
}

export async function collectWebhookTriggers({ swagger, invoke, choose, prompt, log = console.log }) {
    const triggers = [];
    for (const trigger of webhookTriggers) {
        log(`\n${trigger.functionName} (${trigger.operationName})`);
        if (!await choose('Configure this trigger?', [{ label: 'Configure', value: true }, { label: 'Skip', value: false }])) continue;
        const parameters = operation(swagger, trigger.operationName).parameters.filter((p) =>
            p.name !== 'connectionId' && p['x-ms-visibility'] !== 'internal' && !p.readOnly);
        const answers = {};
        const collecting = new Set();
        async function collect(parameter) {
            if (Object.hasOwn(answers, parameter.name)) return answers[parameter.name];
            if (!['path', 'query'].includes(parameter.in) || parameter.type !== 'string') {
                throw new Error(`Unsupported input schema for ${trigger.operationName}; no trigger will be created with guessed values.`);
            }
            const label = parameter['x-ms-summary'] ?? parameter.name;
            if (collecting.has(parameter.name)) throw new Error(`Cyclic picker dependencies for ${label}.`);
            collecting.add(parameter.name);
            try {
                const picker = parameter['x-ms-dynamic-values'];
                let value;
                if (picker) {
                    if (!picker.operationId) throw new Error(`Missing picker operation for ${label}.`);
                    const values = {};
                    for (const [key, binding] of Object.entries(picker.parameters ?? {})) {
                        const reference = binding?.parameter ?? binding?.parameterReference;
                        if (reference) {
                            const dependency = parameters.find((p) => p.name === reference);
                            if (!dependency) throw new Error(`Missing picker prerequisite ${reference} for ${label}.`);
                            values[key] = await collect(dependency);
                            if (values[key] === undefined) {
                                log(`Leaving ${label} unset: ${reference} has no choices.`);
                                return undefined;
                            }
                        } else values[key] = binding?.value ?? binding;
                    }
                    const result = await invoke(picker.operationId, values);
                    const items = get(result, picker['value-collection']);
                    if (!Array.isArray(items)) throw new Error(`Invalid picker response for ${label}.`);
                    if (!items.length) {
                        log(`No choices returned for ${label}; this selector is unavailable.`);
                        return undefined;
                    }
                    const choices = items.map((item) => ({
                        value: get(item, picker['value-path']), label: get(item, picker['value-title']),
                    }));
                    if (choices.some((item) => typeof item.value !== 'string' || !item.value
                        || typeof item.label !== 'string' || !item.label)) {
                        throw new Error(`Invalid picker response for ${label}.`);
                    }
                    value = await choose(label, choices);
                } else if (parameter.enum) {
                    value = await choose(label, parameter.enum.map((value) => ({ value, label: value || 'Any (no filter)' })));
                } else value = await prompt(label, parameter);
                answers[parameter.name] = value;
                return value;
            } finally {
                collecting.delete(parameter.name);
            }
        }
        let skipped = false;
        for (const parameter of parameters.filter((p) => p.required)) {
            const value = await collect(parameter);
            if (value === undefined) {
                log(`Skipped ${trigger.functionName}: no choices returned for ${parameter['x-ms-summary'] ?? parameter.name}.`);
                skipped = true;
                break;
            }
        }
        if (!skipped) triggers.push({ ...trigger, parameters: parameters.filter((p) => Object.hasOwn(answers, p.name))
            .map((p) => ({ name: p.name, value: answers[p.name] })) });
    }
    return triggers;
}
