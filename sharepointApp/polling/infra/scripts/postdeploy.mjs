// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { collectTriggerInputs, operationRequest } from './trigger-inputs.mjs';

const apiVersion = '2026-05-01-preview';

export function pollingEndpoint(receiveUri) {
    const url = new URL(receiveUri);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new Error('The service returned an unsafe polling endpoint.');
    }
    const match = url.pathname.match(/^(.*?)\/triggerconfigs\/[^/]+\/receive\/?$/i);
    if (!match) throw new Error('The service did not return a Poll receive URI.');
    const prefix = match[1];
    if (!['', '/api'].includes(prefix.toLowerCase()) && !/^\/api\/connectorGateways\/[^/]+$/i.test(prefix)) {
        throw new Error('The service returned an unsupported polling endpoint path.');
    }
    return url.origin + (prefix.toLowerCase() === '/api' ? '' : prefix);
}

function propertiesFor(trigger, configName, config, outputs, subscription) {
    return {
        connectionDetails: {
            connectorName: config.connectorName,
            connectionName: outputs.connectorNamespaceConnectionName,
        },
        deliveryMode: 'Poll',
        operationName: trigger.operationName,
        parameters: trigger.parameters,
        metadata: {
            destinationType: 'functionApp',
            functionAppSubscriptionId: subscription,
            functionAppResourceGroup: outputs.resourceGroupName,
            functionAppName: outputs.functionAppName,
            functionName: trigger.functionName,
        },
        state: 'Enabled',
        type: 'NotSpecified',
        description: `${configName} with Poll delivery.`,
    };
}

function assertOwned(existing, expected) {
    const actual = existing.properties;
    if (actual.deliveryMode !== 'Poll'
        || actual.operationName !== expected.operationName
        || actual.connectionDetails?.connectorName !== expected.connectionDetails.connectorName
        || actual.connectionDetails?.connectionName !== expected.connectionDetails.connectionName
        || Object.entries(expected.metadata).some(([key, value]) => actual.metadata?.[key] !== value)) {
        throw new Error(`Refusing to overwrite an unowned or webhook trigger: ${existing.name}.`);
    }
}

export async function selectOneDriveFolder({ request, choose }) {
    const stack = [];
    while (true) {
        const current = stack.at(-1);
        const response = await request({
            method: 'GET',
            path: current ? `/datasets/default/foldersV2/${encodeURIComponent(encodeURIComponent(current.id))}` : '/datasets/default/folders',
        });
        const items = Array.isArray(response) ? response : response?.value;
        if (!Array.isArray(items)) throw new Error('The OneDrive connector returned an invalid folder listing.');
        const folders = items.filter((item) => item.IsFolder === true && typeof item.Id === 'string' && item.Id && item.Id !== 'root');
        const choices = [
            ...(current ? [{ label: `Use ${current.name}`, value: 'select' }, { label: 'Parent folder', value: 'up' }] : []),
            ...folders.map((item) => ({ label: item.Name, value: { id: item.Id, name: item.Name } })),
        ];
        if (!choices.length) throw new Error('No OneDrive folders are available. Create a test folder and rerun setup.');
        const selected = await choose('Select the OneDrive folder to monitor', choices);
        if (selected === 'select') return current.id;
        if (selected === 'up') stack.pop();
        else stack.push(selected);
    }
}

export async function setupPolling({
    config, example, outputs, run, choose, prompt, open,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log,
}) {
    for (const key of ['resourceGroupName', 'functionAppName', 'connectorNamespaceName',
        'connectorNamespaceResourceId', 'connectorNamespaceConnectionName', 'CONNECTOR_NAMESPACE_LOCATION']) {
        if (!outputs[key]) throw new Error(`Missing azd output ${key}. Run azd provision first.`);
    }
    const namespaceId = outputs.connectorNamespaceResourceId;
    const subscription = namespaceId.match(/^\/subscriptions\/([^/]+)\/resourceGroups\/[^/]+\/providers\/Microsoft\.Web\/connectorGateways\/[^/]+$/i)?.[1];
    if (!subscription) throw new Error('Invalid Connector Namespace resource ID.');
    const temporary = await mkdtemp(path.join(tmpdir(), 'connector-poll-'));
    let requestNumber = 0;
    try {
        const jsonFile = async (value) => {
            const file = path.join(temporary, `${requestNumber++}.json`);
            await writeFile(file, JSON.stringify(value), { mode: 0o600 });
            return `@${file}`;
        };
        const rest = async (method, resource, body) => {
            const args = ['rest', '--method', method, '--url', `${resource}${resource.includes('?') ? '&' : '?'}api-version=${apiVersion}`];
            if (body !== undefined) args.push('--body', await jsonFile(body));
            args.push('--subscription', subscription, '-o', 'json');
            const result = await run('az', args);
            return result ? JSON.parse(result) : {};
        };
        const root = `https://management.azure.com${namespaceId}`;
        const connectionUrl = `${root}/connections/${encodeURIComponent(outputs.connectorNamespaceConnectionName)}`;
        let connection = await rest('GET', connectionUrl);
        const ready = () => config.connectorName === 'azureblob'
            ? ['connected', 'ready'].includes(connection.properties?.overallStatus?.toLowerCase())
            : connection.properties?.overallStatus?.toLowerCase() === 'connected';
        if (!ready() && config.connectorName !== 'azureblob') {
            await run('az', ['extension', 'show', '--name', 'connector-namespace', '-o', 'none']);
            let link;
            for (let attempt = 0; attempt < 5 && !link; attempt++) {
                try {
                    const consent = JSON.parse(await run('az', ['connector-namespace', 'connection', 'list-consent-links',
                        '-g', outputs.resourceGroupName, '--namespace', outputs.connectorNamespaceName,
                        '--connection-name', outputs.connectorNamespaceConnectionName,
                        '--subscription', subscription,
                        '--parameters', await jsonFile([{ parameterName: 'token', redirectUrl: 'https://portal.azure.com' }]), '-o', 'json']));
                    link = consent.value?.[0]?.link ?? consent.link;
                } catch {
                    if (attempt === 4) throw new Error('Could not obtain an OAuth consent link. Check the connector-namespace CLI extension and connection.');
                }
                if (!link && attempt < 4) await wait(5000);
            }
            if (!link || new URL(link).protocol !== 'https:') throw new Error('The connection returned no HTTPS consent link.');
            log(`Authorize the ${config.connectorName} connection in your browser: ${link}`);
            await open(link);
        }
        for (let attempt = 0; !ready() && attempt < 100; attempt++) {
            await wait(3000);
            connection = await rest('GET', connectionUrl);
        }
        if (!ready()) throw new Error('Timed out waiting for connection authorization. Rerun azd hooks run postdeploy after completing consent.');

        let triggers;
        if (outputs.POLLING_TRIGGER_INPUTS) {
            triggers = JSON.parse(Buffer.from(outputs.POLLING_TRIGGER_INPUTS, 'base64').toString('utf8'));
        } else {
            let swagger;
            const cache = new Map();
            const request = async (value) => {
                const result = await rest('POST', `${connectionUrl}/dynamicInvoke`, { request: value });
                const response = result.response;
                if (!response || !['200', '201', 'OK', 'Created'].includes(String(response.statusCode))) {
                    throw new Error('Connector picker failed. Check connection access and source permissions.');
                }
                return typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
            };
            const invoke = async (id, values) => {
                const key = JSON.stringify([id, values]);
                if (!cache.has(key)) {
                    cache.set(key, await request(operationRequest(swagger, id, values)));
                }
                return cache.get(key);
            };
            const selected = [];
            for (const trigger of config.triggers) {
                if (!trigger.optional || await choose(`Configure ${trigger.functionName}?`, [
                    { label: 'Skip', value: false }, { label: 'Configure', value: true },
                ])) selected.push(trigger);
            }
            triggers = [];
            const oneDriveFolderId = config.connectorName === 'onedriveforbusiness' ? await selectOneDriveFolder({ request, choose }) : undefined;
            for (const trigger of selected) {
                if (trigger.parameters) {
                    triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName, parameters: trigger.parameters });
                    continue;
                }
                if (oneDriveFolderId) {
                    triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName,
                        parameters: [{ name: 'folderId', value: oneDriveFolderId }] });
                    continue;
                }
                if (config.connectorName === 'azureblob') {
                    if (!outputs.monitoredStorageAccountName || !outputs.monitoredContainerName) throw new Error('Missing provisioned Blob source outputs.');
                    triggers.push({ functionName: trigger.functionName, operationName: trigger.operationName, parameters: [
                        { name: 'dataset', value: outputs.monitoredStorageAccountName },
                        { name: 'folderId', value: Buffer.from(encodeURIComponent(`/${outputs.monitoredContainerName}`)).toString('base64') },
                    ] });
                    continue;
                }
                if (!swagger) {
                    const exported = JSON.parse(await run('az', ['rest', '--method', 'GET', '--url',
                        `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.Web/locations/${encodeURIComponent(outputs.CONNECTOR_NAMESPACE_LOCATION)}/managedApis/${config.connectorName}`,
                        '--url-parameters', 'api-version=2016-06-01', 'export=true', '--subscription', subscription, '-o', 'json']));
                    const definition = exported.properties?.apiDefinitions?.value ?? exported;
                    swagger = typeof definition === 'string' ? JSON.parse(definition) : definition;
                    if (!swagger.paths) throw new Error('The connector exported no operation metadata.');
                }
                triggers.push(...await collectTriggerInputs({ triggers: [trigger], swagger, invoke, choose, prompt, log }));
            }
        }
        if (!Array.isArray(triggers) || !triggers.length
            || new Set(triggers.map((trigger) => trigger.functionName)).size !== triggers.length) {
            throw new Error('Polling setup requires distinct selected triggers.');
        }
        for (const trigger of triggers) {
            const definition = config.triggers.find((item) => item.functionName === trigger.functionName);
            if (!definition || definition.operationName !== trigger.operationName
                || !Array.isArray(trigger.parameters) || trigger.parameters.some((item) => !item.name || item.value === undefined)) {
                throw new Error('Saved Poll inputs do not match this project. Clear POLLING_TRIGGER_INPUTS and rerun setup.');
            }
        }
        if (config.triggers.some((item) => !item.optional && config.connectorName !== 'sharepointonline'
            && !triggers.some((trigger) => trigger.functionName === item.functionName))) {
            throw new Error('Saved Poll inputs omit a required listener. Clear POLLING_TRIGGER_INPUTS and rerun setup.');
        }

        const existing = new Map();
        let page = `${root}/triggerConfigs`;
        while (page) {
            // Pagination URLs already include their API version.
            const result = page.includes('?')
                ? JSON.parse(await run('az', ['rest', '--method', 'GET', '--url', page, '--subscription', subscription, '-o', 'json']))
                : await rest('GET', page);
            for (const item of result.value ?? []) existing.set(item.name, item);
            page = result.nextLink;
            if (page && !page.startsWith(`${root}/triggerConfigs?`)) throw new Error('Unsafe trigger-list continuation URL.');
        }
        const plan = config.triggers.map((definition) => {
            const trigger = triggers.find((item) => item.functionName === definition.functionName);
            const setting = definition.setting ?? `${definition.functionName}TriggerConfigName`;
            const name = example.Values[setting];
            if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error(`Missing safe trigger name for ${setting}.`);
            const properties = propertiesFor(trigger ?? { ...definition, parameters: [] }, name, config, outputs, subscription);
            const resource = existing.get(name);
            if (resource) assertOwned(resource, properties);
            return { definition, trigger, setting, name, properties, resource };
        });
        // Base64 avoids JSON quoting differences in Windows' azd.cmd shim.
        await run('azd', ['env', 'set', 'POLLING_TRIGGER_INPUTS', Buffer.from(JSON.stringify(triggers)).toString('base64')]);
        const localValues = {};
        let endpoint;
        for (const item of plan) {
            const { definition, trigger, setting, name, properties, resource } = item;
            const url = `${root}/triggerConfigs/${encodeURIComponent(name)}`;
            localValues[setting] = name;
            localValues[`AzureWebJobs.${definition.functionName}.Disabled`] = String(!trigger);
            if (!trigger) {
                if (resource && resource.properties.state !== 'Disabled') {
                    const { pollingEndpoints, provisioningState, ...preserved } = resource.properties;
                    await rest('PUT', url, { properties: { ...preserved, state: 'Disabled' } });
                }
                continue;
            }
            const ordered = (parameters) => [...(parameters ?? [])].sort((a, b) => a.name.localeCompare(b.name));
            const unchanged = resource?.properties.state === 'Enabled'
                && resource.properties.provisioningState !== 'Failed'
                && isDeepStrictEqual(ordered(resource.properties.parameters), ordered(properties.parameters));
            let created = unchanged ? resource : await rest('PUT', url, { properties });
            for (let attempt = 0; !created.properties?.pollingEndpoints?.receiveUri
                && created.properties?.provisioningState !== 'Failed' && attempt < 30; attempt++) {
                await wait(2000);
                created = await rest('GET', url);
            }
            if (created.properties?.provisioningState === 'Failed' || !created.properties?.pollingEndpoints?.receiveUri) {
                throw new Error(`Poll source ${name} did not return a usable receive URI. Check its source-registration status and permissions.`);
            }
            const actualEndpoint = pollingEndpoint(created.properties?.pollingEndpoints?.receiveUri);
            if (endpoint && endpoint !== actualEndpoint) throw new Error('Selected Poll configs returned inconsistent namespace endpoints.');
            endpoint = actualEndpoint;
            log(`Configured ${definition.functionName} for Poll delivery.`);
        }
        localValues.ConnectorNamespace__pollingEndpoint = endpoint;
        if (config.connectorName === 'commondataservice') {
            localValues.EnableDataverseActionSample = String(triggers.some((item) => item.functionName === 'OnDataverseActionPerformed'));
            localValues.EnableDataverseSeparateRowSamples = String(triggers.some((item) => ['OnDataverseRowAdded', 'OnDataverseRowModified', 'OnDataverseRowDeleted'].includes(item.functionName)));
        }
        await run('az', ['functionapp', 'config', 'appsettings', 'set', '-g', outputs.resourceGroupName, '-n', outputs.functionAppName,
            '--subscription', subscription, '--settings', await jsonFile({ ...localValues, ConnectorNamespace__credential: 'managedidentity' }), '-o', 'none']);
        await run('azd', ['env', 'set', 'ConnectorNamespace__pollingEndpoint', endpoint]);
        return localValues;
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

function run(command, args) {
    const options = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 };
    const result = process.platform === 'win32'
        ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            '& $env:POLLING_SETUP_COMMAND @($env:POLLING_SETUP_ARGS | ConvertFrom-Json); exit $LASTEXITCODE'], {
            ...options, env: { ...process.env, POLLING_SETUP_COMMAND: command, POLLING_SETUP_ARGS: JSON.stringify(args) },
        })
        : spawnSync(command, args, options);
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
    return result.stdout.trim();
}

async function main() {
    const config = JSON.parse(await readFile(new URL('./polling-config.json', import.meta.url), 'utf8'));
    const example = JSON.parse(await readFile(new URL('../../local.settings.example.json', import.meta.url), 'utf8'));
    const outputs = JSON.parse(run('azd', ['env', 'get-values', '--output', 'json']));
    let terminal;
    const cancelled = new AbortController();
    const question = async (label) => {
        if (!process.stdin.isTTY) throw new Error('Source selection requires a terminal. Run azd hooks run postdeploy interactively.');
        if (!terminal) {
            terminal = createInterface({ input: process.stdin, output: process.stdout });
            terminal.on('SIGINT', () => cancelled.abort());
            terminal.on('close', () => cancelled.abort());
        }
        return (await terminal.question(label, { signal: cancelled.signal })).trim();
    };
    try {
        const values = await setupPolling({
            config, example, outputs, run,
            choose: async (label, choices) => {
                console.log(`\n${label}`);
                choices.forEach((item, index) => console.log(`  [${index + 1}] ${item.label}`));
                while (true) {
                    const answer = await question(`Enter number (1-${choices.length}): `);
                    if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= choices.length) return choices[Number(answer) - 1].value;
                }
            },
            prompt: async (label, schema, { allowEmpty = false } = {}) => {
                while (true) {
                    const answer = await question(`${label}${schema.description ? ` (${schema.description})` : ''}: `);
                    if (allowEmpty && !answer) return '';
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
            },
            open: async (url) => {
                const result = process.platform === 'win32'
                    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:POLLING_CONSENT_URL'], {
                        env: { ...process.env, POLLING_CONSENT_URL: url }, stdio: 'ignore', timeout: 10_000,
                    })
                    : spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', timeout: 10_000 });
                if (result.error || result.status !== 0) console.log('Open the consent URL shown above in your browser.');
            },
        });
        try {
            await writeFile(new URL('../../local.settings.json', import.meta.url),
                JSON.stringify({ ...example, Values: { ...example.Values, ...values } }, null, 2) + '\n',
                { flag: 'wx', mode: 0o600 });
            console.log('Created local.settings.json for local developer authentication.');
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            console.log('Existing local.settings.json was preserved. Azure app settings were configured automatically.');
        }
    } finally {
        terminal?.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error(`Polling setup failed: ${error.message}`);
        process.exitCode = 1;
    });
}
