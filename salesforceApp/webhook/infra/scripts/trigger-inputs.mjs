// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./webhook-config.json', import.meta.url), 'utf8'));

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
    throw new Error(`The connector does not expose ${id} in this region.`);
}

export function operationRequest(swagger, id, values) {
    const op = operation(swagger, id);
    const request = { method: op.method.toUpperCase(), path: op.route.replace(/^\/\{connectionId\}/, '') };
    for (const parameter of op.parameters) {
        if (parameter.name === 'connectionId') continue;
        const value = values[parameter.name] === undefined ? parameter.default : values[parameter.name];
        if (value === undefined) {
            if (parameter.required) throw new Error(`${id} requires ${parameter.name}.`);
            continue;
        }
        if (parameter.in === 'path') {
            let encoded = encodeURIComponent(String(value));
            if (parameter['x-ms-url-encoding'] === 'double') encoded = encodeURIComponent(encoded);
            request.path = request.path.replace(`{${parameter.name}}`, encoded);
        } else if (parameter.in === 'query') {
            (request.queries ??= {})[parameter.name] = value;
        } else if (parameter.in === 'header') {
            (request.headers ??= {})[parameter.name] = value;
        } else if (parameter.in === 'body') {
            request.body = value;
        }
    }
    if (/\{[^}]+\}/.test(request.path)) throw new Error(`Unresolved path parameters for ${id}.`);
    return request;
}

export async function collectTriggerInputs({ triggers: definitions, swagger, invoke, choose, prompt, log = console.log }) {
    class SkipTrigger extends Error {}

    function requiredDependencies(dependencies, names) {
        const required = new Set(names);
        for (const name of required) {
            for (const dependency of dependencies.get(name) ?? []) required.add(dependency);
        }
        return required;
    }

    function dynamicSpec(extension) {
        return extension.operationId ? extension : { ...extension, ...(extension.dynamicState?.extension ?? extension.dynamicState) };
    }

    function references(input) {
        const schema = resolve(swagger, input);
        const result = [];
        for (const name of ['x-ms-dynamic-schema', 'x-ms-dynamic-values', 'x-ms-dynamic-list']) {
            if (!schema[name]) continue;
            for (const binding of Object.values(dynamicSpec(schema[name]).parameters ?? {})) {
                const reference = binding?.parameter ?? binding?.parameterReference;
                if (reference) result.push(reference);
            }
        }
        if (schema.items) result.push(...references(schema.items));
        const properties = schema.properties ?? {};
        const propertyReferences = new Map(Object.entries(properties).map(([key, property]) => [key, references(property)]));
        const dependencies = new Map([...propertyReferences].map(([key, refs]) => [
            key, refs.flatMap((reference) => {
                const name = reference.split(/[/.]/).find((part) => Object.hasOwn(properties, part));
                return name && name !== key ? [name] : [];
            }),
        ]));
        const required = requiredDependencies(dependencies, Object.keys(properties)
            .filter((key) => schema.required?.includes(key) || resolve(swagger, properties[key]).required === true));
        for (const key of required) result.push(...propertyReferences.get(key));
        return result;
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
        const supplied = get(answers, keyPath.join('/'));
        if (supplied !== undefined && schema.type !== 'object' && !schema.properties) return supplied;
        if (!required) return supplied ?? schema.default;
        if (supplied === undefined && schema.default !== undefined) return schema.default;
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
            while (items.length < (schema.minItems ?? 1)) {
                items.push(await collect(itemSchema, `${label} (${items.length + 1})`, answers, [...keyPath, String(items.length)]));
            }
            return items;
        }
        const values = schema['x-ms-dynamic-values'] ?? schema['x-ms-dynamic-list'];
        const valuesExtension = values && dynamicSpec(values);
        if (valuesExtension) {
            const result = await dynamic(valuesExtension, answers);
            const items = get(result, valuesExtension['value-collection'] ?? valuesExtension.valueCollection ?? valuesExtension.itemsPath);
            if (!Array.isArray(items)) {
                throw new Error(`The connector returned a malformed list for ${label}; expected an array of choices.`);
            }
            const choices = items.map((item) => ({
                value: get(item, valuesExtension['value-path'] ?? valuesExtension.valuePath ?? valuesExtension.itemValuePath),
                label: get(item, valuesExtension['value-title'] ?? valuesExtension.valueTitle ?? valuesExtension.itemTitlePath),
            })).filter((item) => ['string', 'number', 'boolean'].includes(typeof item.value)
                && (typeof item.value !== 'number' || Number.isFinite(item.value))
                && (item.value !== '' || typeof item.label === 'string' && item.label.trim()));
            if (choices.length < items.length) log(`Ignored ${items.length - choices.length} choices for ${label} without usable identifiers.`);
            if (!choices.length) {
                log(`No usable choices returned for ${label}. Enter the connector value manually, or leave blank to skip this trigger.`);
                const value = await prompt(label, schema, { allowEmpty: true });
                if (value === undefined || value === null || typeof value === 'string' && !value.trim()) throw new SkipTrigger(label);
                return typeof value === 'string' ? value.trim() : value;
            }
            return choose(label, choices.map((item) => ({
                value: item.value,
                label: typeof item.label === 'string' && item.label.trim() ? item.label : String(item.value),
            })));
        }
        if (schema.enum) {
            return choose(label, schema.enum.map((value) => ({
                value,
                label: schema['x-ms-enum-values']?.find((item) => item.value === value)?.displayName ?? String(value),
            })));
        }
        if (schema.type === 'object' || schema.properties) {
            const result = supplied ?? {};
            let parent = answers;
            for (const key of keyPath.slice(0, -1)) parent = parent[key] ??= {};
            parent[keyPath.at(-1)] = result;
            const properties = schema.properties ?? {};
            const dependencies = new Map(Object.entries(properties).map(([key, property]) => [
                key, new Set(references(property).flatMap((reference) => {
                    const parts = reference.split(/[/.]/).filter(Boolean);
                    const index = parts.findIndex((part, i) => Object.hasOwn(properties, part)
                        && (i === 0 || get(answers, parts.slice(0, i).join('/')) === result));
                    return index < 0 || parts[index] === key ? [] : [parts[index]];
                })),
            ]));
            const required = requiredDependencies(dependencies, Object.keys(properties)
                .filter((key) => schema.required?.includes(key) || resolve(swagger, properties[key]).required === true));
            const remaining = new Set(Object.keys(properties));
            // Picker prerequisites may be listed later and omitted from schema.required.
            while (remaining.size) {
                const key = [...remaining].find((name) => !required.has(name)
                    || [...dependencies.get(name)].every((dependency) => !remaining.has(dependency)));
                if (key === undefined) throw new Error(`Cyclic picker dependencies for ${label}.`);
                remaining.delete(key);
                const field = resolve(swagger, properties[key]);
                // Connector Namespace supplies its subscription callback, not the Function App URL.
                if (field['x-ms-notification-url'] || field.readOnly) continue;
                if (field['x-ms-visibility'] === 'internal') {
                    if (field.default !== undefined) result[key] = field.default;
                    continue;
                }
                const value = await collect(field, field['x-ms-summary'] ?? field.title ?? key, answers,
                    [...keyPath, key], required.has(key));
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
    for (const trigger of definitions) {
        log(`\n${trigger.functionName} (${trigger.operationName})`);
        try {
            const operationParameters = operation(swagger, trigger.operationName).parameters;
            const body = operationParameters.find((parameter) => parameter.in === 'body');
            const answers = structuredClone(trigger.values ?? {});
            if (body && body.name !== 'body') {
                // Swagger references use the original body name; trigger configurations use "body".
                Object.defineProperty(answers, body.name, { get: () => answers.body });
            }
            const parameters = [];
            const remaining = new Map(operationParameters
                .filter((parameter) => ['path', 'query', 'header'].includes(parameter.in) && parameter.name !== 'connectionId'
                    && parameter['x-ms-visibility'] !== 'internal' && !parameter.readOnly)
                .map((parameter) => [parameter.name, parameter]));
            const dependencies = (parameter) => references(parameter).map((reference) => reference.split(/[/.]/)[0])
                .filter((name) => name !== parameter.name);
            const required = requiredDependencies(new Map([...remaining].map(([name, parameter]) => [name, dependencies(parameter)])), [
                ...[...remaining.values()].filter((parameter) => parameter.required).map((parameter) => parameter.name),
                ...(body?.required ? references(body.schema).map((reference) => reference.split(/[/.]/)[0])
                    .filter((name) => remaining.has(name)) : []),
            ]);
            while (remaining.size) {
                const parameter = [...remaining.values()].find((item) => !required.has(item.name)
                    || dependencies(item).every((name) => !remaining.has(name)));
                if (!parameter) throw new Error(`Cyclic picker dependencies for ${trigger.operationName}.`);
                remaining.delete(parameter.name);
                const value = await collect(parameter, parameter['x-ms-summary'] ?? parameter.name, answers, [parameter.name],
                    required.has(parameter.name));
                if (value !== undefined) {
                    answers[parameter.name] = value;
                    parameters.push({ name: parameter.name, value });
                }
            }
            if (body) {
                const value = await collect(body.schema, 'Subscription details', answers, ['body'], body.required);
                if (value && Object.keys(value).length) parameters.push({ name: 'body', value });
            }
            triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName, parameters });
        } catch (error) {
            if (!(error instanceof SkipTrigger)) throw error;
            log(`Skipped ${trigger.functionName}: no value entered for ${error.message}.`);
        }
    }
    return triggers;
}

export async function collectWebhookTriggers({ swagger, invoke, choose, prompt, log = console.log }) {
    const triggers = [];
    for (const trigger of config.triggers) {
        log(`\n${trigger.functionName} (${trigger.operationName})`);
        if (!await choose('Configure this trigger?', [
            { label: 'Configure', value: true }, { label: 'Skip', value: false },
        ])) continue;
        triggers.push(...await collectTriggerInputs({ triggers: [trigger], swagger, invoke, choose, prompt, log }));
    }
    return triggers;
}

export function validateWebhookTriggers(triggers, swagger) {
    const invalid = () => {
        throw new Error(`Saved webhook inputs do not match this project. Clear ${config.savedInputsSetting} and rerun setup.`);
    };
    function validate(input, value) {
        const schema = resolve(swagger, input);
        if (value === undefined) return invalid();
        if (schema.enum && !schema.enum.includes(value)) return invalid();
        if (schema.type === 'object' || schema.properties) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
            const properties = schema.properties ?? {};
            for (const name of schema.required ?? []) {
                const field = resolve(swagger, properties[name]);
                if (field && !field['x-ms-notification-url'] && !field.readOnly
                    && field['x-ms-visibility'] !== 'internal' && !Object.hasOwn(value, name)) return invalid();
            }
            for (const [name, item] of Object.entries(value)) {
                if (!properties[name]) return invalid();
                validate(properties[name], item);
            }
        } else if (schema.type === 'array') {
            if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)
                || value.length > (schema.maxItems ?? Infinity)) return invalid();
            for (const item of value) validate(schema.items, item);
        } else if (schema.type === 'integer' || schema.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)
                || schema.type === 'integer' && !Number.isInteger(value)
                || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return invalid();
        } else if (schema.type === 'boolean') {
            if (typeof value !== 'boolean') return invalid();
        } else if (typeof value !== 'string' || value.length < (schema.minLength ?? 0)
            || value.length > (schema.maxLength ?? Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value)) {
            return invalid();
        }
    }
    if (!Array.isArray(triggers) || !triggers.length
        || new Set(triggers.map((trigger) => trigger?.functionName)).size !== triggers.length) {
        throw new Error('Webhook setup requires at least one distinct selected trigger.');
    }
    for (const trigger of triggers) {
        const definition = config.triggers.find((item) => item.functionName === trigger?.functionName);
        if (!definition || trigger.operationName !== definition.operationName || !Array.isArray(trigger.parameters)) return invalid();
        const parameters = operation(swagger, definition.operationName).parameters.filter((p) =>
            p.name !== 'connectionId' && p['x-ms-visibility'] !== 'internal' && !p.readOnly);
        const expected = new Map(parameters.map((p) => [p.in === 'body' ? 'body' : p.name, p]));
        if (new Set(trigger.parameters.map((p) => p?.name)).size !== trigger.parameters.length) return invalid();
        for (const p of parameters) {
            const name = p.in === 'body' ? 'body' : p.name;
            if (p.required && !trigger.parameters.some((item) => item.name === name)) return invalid();
        }
        for (const item of trigger.parameters) {
            const p = expected.get(item?.name);
            if (!p) return invalid();
            validate(p.in === 'body' ? p.schema : p, item.value);
            if (p.required && typeof item.value === 'string' && !item.value.trim()) return invalid();
        }
    }
}
