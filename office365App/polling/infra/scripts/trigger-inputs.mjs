// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

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

export async function collectTriggerInputs({ triggers: definitions, swagger, invoke, choose, prompt, log = console.log }) {
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
        for (const property of Object.values(schema.properties ?? {})) result.push(...references(property));
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
        const supplied = get(answers, keyPath.join('/'));
        if (supplied !== undefined) return supplied;
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
            const properties = schema.properties ?? {};
            const dependencies = new Map(Object.entries(properties).map(([key, property]) => [
                key, new Set(references(property).flatMap((reference) => {
                    const parts = reference.split(/[/.]/).filter(Boolean);
                    const index = parts.findIndex((part, i) => Object.hasOwn(properties, part)
                        && (i === 0 || get(answers, parts.slice(0, i).join('/')) === result));
                    return index < 0 || parts[index] === key ? [] : [parts[index]];
                })),
            ]));
            const prerequisites = new Set([...dependencies.values()].flatMap((keys) => [...keys]));
            const remaining = new Set(Object.keys(properties));
            // Picker prerequisites may be listed later and omitted from schema.required.
            while (remaining.size) {
                const key = [...remaining].find((name) => [...dependencies.get(name)].every((dependency) => !remaining.has(dependency)));
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
                    [...keyPath, key], prerequisites.has(key) || schema.required?.includes(key) || field.required === true);
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
        const operationParameters = operation(swagger, trigger.operationName).parameters;
        const body = operationParameters.find((parameter) => parameter.in === 'body');
        const answers = structuredClone(trigger.values ?? {});
        if (body && body.name !== 'body') {
            // Swagger references use the original body name; trigger configurations use "body".
            Object.defineProperty(answers, body.name, { get: () => answers.body });
        }
        const parameters = [];
        const remaining = new Map(operationParameters
            .filter((parameter) => ['path', 'query'].includes(parameter.in) && parameter.name !== 'connectionId'
                && parameter['x-ms-visibility'] !== 'internal' && !parameter.readOnly)
            .map((parameter) => [parameter.name, parameter]));
        const dependencies = (parameter) => references(parameter).map((reference) => reference.split(/[/.]/)[0])
            .filter((name) => name !== parameter.name);
        const prerequisites = new Set([...remaining.values()].flatMap(dependencies));
        while (remaining.size) {
            const parameter = [...remaining.values()].find((item) => dependencies(item).every((name) => !remaining.has(name)));
            if (!parameter) throw new Error(`Cyclic picker dependencies for ${trigger.operationName}.`);
            remaining.delete(parameter.name);
            const value = await collect(parameter, parameter['x-ms-summary'] ?? parameter.name, answers, [parameter.name],
                parameter.required || prerequisites.has(parameter.name));
            if (value !== undefined) {
                answers[parameter.name] = value;
                parameters.push({ name: parameter.name, value });
            }
        }
        if (body) {
            const value = await collect(body.schema, 'Subscription details', answers, ['body']);
            if (Object.keys(value).length) parameters.push({ name: 'body', value });
        }
        triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName, parameters });
    }
    return triggers;
}
