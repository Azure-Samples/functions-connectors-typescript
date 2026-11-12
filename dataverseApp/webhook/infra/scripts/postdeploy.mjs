// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { collectWebhookTriggers, operationRequest, validateWebhookTriggers } from './trigger-inputs.mjs';

const apiVersion = '2026-05-01-preview';
const config = JSON.parse(await readFile(new URL('./webhook-config.json', import.meta.url), 'utf8'));
const { connectorName, displayName, triggers: webhookTriggers } = config;

export async function setupWebhooks({
    outputs, run, choose, prompt,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log,
}) {
    for (const key of ['resourceGroupName', 'functionAppName', 'FUNCTION_APP_HOSTNAME', 'connectorNamespaceName',
        'connectorNamespaceResourceId', 'connectorNamespaceConnectionName', 'connectorConnectionRuntimeUrl', 'CONNECTOR_NAMESPACE_LOCATION']) {
        if (!outputs[key]) throw new Error(`Missing azd output ${key}. Run azd provision first.`);
    }
    const namespaceId = outputs.connectorNamespaceResourceId;
    const subscription = namespaceId.match(/^\/subscriptions\/([^/]+)\/resourceGroups\/[^/]+\/providers\/Microsoft\.Web\/connectorGateways\/[^/]+$/i)?.[1];
    if (!subscription) throw new Error('Invalid Connector Namespace resource ID.');
    const temporary = await mkdtemp(path.join(tmpdir(), 'connector-webhook-'));
    let requestNumber = 0;
    try {
        const jsonFile = async (value) => {
            const file = path.join(temporary, `${requestNumber++}.json`);
            await writeFile(file, JSON.stringify(value), { mode: 0o600 });
            return `@${file}`;
        };
        const rest = async (method, resource, body) => {
            const args = ['rest', '--method', method, '--url', resource.includes('?') ? resource : `${resource}?api-version=${apiVersion}`];
            if (body !== undefined) args.push('--body', await jsonFile(body));
            args.push('--subscription', subscription, '-o', 'json');
            const result = await run('az', args);
            return result ? JSON.parse(result) : {};
        };
        const root = `https://management.azure.com${namespaceId}`;
        const connectionUrl = `${root}/connections/${encodeURIComponent(outputs.connectorNamespaceConnectionName)}`;
        let connection = await rest('GET', connectionUrl);
        const ready = () => connection.properties?.overallStatus?.toLowerCase() === 'connected';
        if (!ready()) {
            log(`Azure resources are deployed. Completing ${displayName} OAuth in your normal browser.`);
            log('Click Continue on the local sign-in page and complete consent. This terminal checks Azure every 10 seconds and reports when authentication is confirmed, even if the browser window does not update.');
            try {
                await run('az', ['connector-namespace', 'connection', 'authenticate',
                    '-g', outputs.resourceGroupName, '--namespace', outputs.connectorNamespaceName,
                    '--connection-name', outputs.connectorNamespaceConnectionName, '--subscription', subscription,
                    '--timeout', '300', '--no-access-policy'], {
                    interactive: true,
                    checkConnected: async () => {
                        try {
                            connection = await rest('GET', connectionUrl);
                            if (ready()) return true;
                            log(`${displayName} OAuth: waiting for authorization (Azure status: ${connection.properties?.overallStatus ?? 'Unknown'}). Complete consent in the browser.`);
                        } catch {
                            log(`${displayName} OAuth: unable to read Azure connection status; still waiting for the CLI. No success has been confirmed.`);
                        }
                        return false;
                    },
                });
            } catch (error) {
                throw new Error(`${displayName} authentication failed; Azure resources are already deployed. Resolve the browser or CLI error above, then rerun azd hooks run postdeploy. This requires a connector-namespace extension with connection authenticate support.`, { cause: error });
            }
            connection = await rest('GET', connectionUrl);
            if (!ready()) {
                const errors = [...new Set((connection.properties?.statuses ?? []).map((status) => status.error?.code).filter(Boolean))];
                throw new Error(`${displayName} connection is not Connected after authentication (status: ${connection.properties?.overallStatus ?? 'Unknown'}${errors.length ? `; ${errors.join(', ')}` : ''}). Azure resources are already deployed; rerun azd hooks run postdeploy after resolving consent.`);
            }
        }
        log(`${displayName} authentication confirmed: Azure connection is Connected. You can close the sign-in windows. Continuing with trigger setup.`);

        const exported = JSON.parse(await run('az', ['rest', '--method', 'GET', '--url',
            `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.Web/locations/${encodeURIComponent(outputs.CONNECTOR_NAMESPACE_LOCATION)}/managedApis/${connectorName}`,
            '--url-parameters', 'api-version=2022-09-01-preview', 'export=true', '--subscription', subscription, '-o', 'json']));
        const definition = exported.properties?.apiDefinitions?.value ?? exported;
        const swagger = typeof definition === 'string' ? JSON.parse(definition) : definition;
        if (!swagger.paths) throw new Error(`The ${displayName} connector exported no operation metadata.`);
        const cache = new Map();
        const invoke = async (id, values) => {
            const key = JSON.stringify([id, values]);
            if (!cache.has(key)) {
                const result = await rest('POST', `${connectionUrl}/dynamicInvoke`, { request: operationRequest(swagger, id, values) });
                const response = result.response;
                if (!response || !['200', '201', 'OK', 'Created'].includes(String(response.statusCode))) {
                    throw new Error(`Connector picker ${id} failed. Check connection access and ${displayName} permissions.`);
                }
                cache.set(key, typeof response.body === 'string' ? JSON.parse(response.body) : response.body);
            }
            return cache.get(key);
        };
        const triggers = outputs[config.savedInputsSetting]
            ? JSON.parse(Buffer.from(outputs[config.savedInputsSetting], 'base64').toString('utf8'))
            : await collectWebhookTriggers({ swagger, invoke, choose, prompt, log });
        validateWebhookTriggers(triggers, swagger);

        let extensionKey;
        for (let attempt = 0; attempt < 30 && !extensionKey; attempt++) {
            try {
                const keys = JSON.parse(await run('az', ['functionapp', 'keys', 'list', '-g', outputs.resourceGroupName,
                    '-n', outputs.functionAppName, '--subscription', subscription, '-o', 'json']));
                extensionKey = keys.systemKeys?.connector_extension;
            } catch {
                if (attempt === 29) throw new Error('Could not read the connector extension system key after deployment.');
            }
            if (!extensionKey && attempt < 29) await wait(3000);
        }
        if (!extensionKey) throw new Error('The Function App returned no connector_extension system key. Check that the host started successfully.');
        const existing = new Map();
        let page = `${root}/triggerConfigs`;
        while (page) {
            const result = await rest('GET', page);
            for (const resource of result.value ?? []) existing.set(resource.name, resource);
            page = result.nextLink;
            if (page && !page.startsWith(`${root}/triggerConfigs?`)) throw new Error('Unsafe trigger-list continuation URL.');
        }
        const plan = webhookTriggers.map((definition) => {
            const trigger = triggers.find((item) => item.functionName === definition.functionName);
            const name = `${outputs.connectorNamespaceConnectionName}-${definition.functionName.toLowerCase()}`;
            if (!/^[a-z0-9-]+$/.test(name)) throw new Error('The provisioned connection has an unsafe trigger name.');
            const properties = {
                connectionDetails: { connectorName, connectionName: outputs.connectorNamespaceConnectionName },
                operationName: definition.operationName,
                parameters: trigger?.parameters ?? [],
                notificationDetails: {
                    callbackUrl: `https://${outputs.FUNCTION_APP_HOSTNAME}/runtime/webhooks/connector?functionName=${definition.functionName}`,
                    httpMethod: 'Post',
                    authentication: { type: 'QueryString', name: 'code', value: extensionKey },
                },
                metadata: {
                    destinationType: 'functionApp',
                    functionAppSubscriptionId: subscription,
                    functionAppResourceGroup: outputs.resourceGroupName,
                    functionAppName: outputs.functionAppName,
                    functionName: definition.functionName,
                },
                state: 'Enabled',
                type: 'NotSpecified',
                description: `${displayName} ${definition.operationName} -> ${definition.functionName}`,
            };
            const resource = existing.get(name);
            if (resource && ((resource.properties.deliveryMode ?? 'Webhook') !== 'Webhook'
                || resource.properties.operationName !== properties.operationName
                || !isDeepStrictEqual(resource.properties.connectionDetails, properties.connectionDetails)
                || Object.entries(properties.metadata).some(([key, value]) => resource.properties.metadata?.[key] !== value))) {
                throw new Error(`Refusing to overwrite an unowned or Poll trigger: ${name}.`);
            }
            return { definition, trigger, name, properties, resource };
        });
        const localValues = { [config.connectionSetting]: outputs.connectorConnectionRuntimeUrl };
        for (const { definition, trigger, name, properties, resource } of plan) {
            localValues[`AzureWebJobs.${definition.functionName}.Disabled`] = String(!trigger);
            const url = `${root}/triggerConfigs/${encodeURIComponent(name)}`;
            if (!trigger) {
                if (resource && resource.properties.state !== 'Disabled') {
                    const { provisioningState, pollingEndpoints, ...preserved } = resource.properties;
                    await rest('PUT', url, { properties: { ...preserved, state: 'Disabled' } });
                }
                continue;
            }
            const ordered = (items) => [...(items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
            const unchanged = resource?.properties.state === 'Enabled'
                && !['Failed', 'Canceled', 'Cancelled'].includes(resource.properties.provisioningState)
                && isDeepStrictEqual(ordered(resource.properties.parameters), ordered(properties.parameters))
                && isDeepStrictEqual(resource.properties.notificationDetails, properties.notificationDetails);
            let created = unchanged ? resource : await rest('PUT', url, { properties });
            for (let attempt = 0; ['Accepted', 'Creating', 'Updating', 'Running'].includes(created.properties?.provisioningState)
                && attempt < 30; attempt++) {
                await wait(2000);
                created = await rest('GET', url);
            }
            if (!created.properties || ['Failed', 'Canceled', 'Cancelled'].includes(created.properties.provisioningState)
                || ['Accepted', 'Creating', 'Updating', 'Running'].includes(created.properties.provisioningState)) {
                throw new Error(`Webhook source ${name} did not finish provisioning. Check source-registration status and permissions.`);
            }
            log(`Configured ${definition.functionName} for webhook delivery.`);
        }
        await run('az', ['functionapp', 'config', 'appsettings', 'set', '-g', outputs.resourceGroupName, '-n', outputs.functionAppName,
            '--subscription', subscription, '--settings', await jsonFile(localValues), '-o', 'none']);
        await run('azd', ['env', 'set', config.savedInputsSetting, Buffer.from(JSON.stringify(triggers)).toString('base64')]);
        return localValues;
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

export function run(command, args, { interactive = false, checkConnected } = {}) {
    const options = {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
        // The CLI can wait for both the browser redirect and the connection status.
        timeout: interactive ? 660_000 : 120_000,
        ...(interactive ? { stdio: 'inherit' } : {}),
    };
    const executable = process.platform === 'win32' ? 'powershell.exe' : command;
    const executableArgs = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command',
        '& $env:WEBHOOK_SETUP_COMMAND @($env:WEBHOOK_SETUP_ARGS | ConvertFrom-Json); exit $LASTEXITCODE'] : args;
    if (process.platform === 'win32') {
        options.env = { ...process.env, WEBHOOK_SETUP_COMMAND: command, WEBHOOK_SETUP_ARGS: JSON.stringify(args) };
    }
    if (interactive) {
        return new Promise((resolve, reject) => {
            const child = spawn(executable, executableArgs, options);
            let finished = false;
            let confirmed = false;
            let checking = false;
            const timer = setInterval(check, 10_000);
            function check() {
                if (finished || checking || !checkConnected) return;
                checking = true;
                Promise.resolve().then(checkConnected).then((connected) => {
                    if (finished || !connected) return;
                    confirmed = true;
                    // This command started from a disconnected connection; Azure is authoritative
                    // when the CLI is still waiting for a browser redirect that never arrives.
                    if (process.platform === 'win32') {
                        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
                    } else {
                        child.kill();
                    }
                }).catch(() => {}).finally(() => { checking = false; });
            }
            child.once('error', (error) => {
                finished = true;
                clearInterval(timer);
                reject(new Error(`${command} failed: ${error.message}`));
            });
            child.once('close', (code, signal) => {
                finished = true;
                clearInterval(timer);
                if (confirmed || code === 0) resolve('');
                else reject(new Error(`${command} failed: ${signal ? `signal ${signal}` : `exit code ${code}`}`));
            });
            check();
        });
    }
    const result = spawnSync(executable, executableArgs, options);
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? `exit code ${result.status}`}`);
    return result.stdout?.trim() ?? '';
}

async function main() {
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
        const values = await setupWebhooks({
            outputs, run,
            choose: async (label, choices) => {
                if (!choices.length) throw new Error(`No choices returned for ${label}.`);
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
                    if (allowEmpty && !answer) return undefined;
                    if (schema.type === 'integer' || schema.type === 'number') {
                        const value = Number(answer);
                        if (answer && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value))
                            && (schema.minimum === undefined || value >= schema.minimum)
                            && (schema.maximum === undefined || value <= schema.maximum)) return value;
                        console.log('Enter a number matching the requested constraints.');
                        continue;
                    }
                    if (answer.length >= Math.max(1, schema.minLength ?? 0)
                        && (schema.maxLength === undefined || answer.length <= schema.maxLength)
                        && (!schema.pattern || new RegExp(schema.pattern).test(answer))) return answer;
                    console.log('Enter a non-empty value matching the requested constraints.');
                }
            },
        });
        try {
            await writeFile(new URL('../../local.settings.json', import.meta.url),
                JSON.stringify({ ...example, Values: { ...example.Values, ...values } }, null, 2) + '\n',
                { flag: 'wx', mode: 0o600 });
            console.log('Created local.settings.json for local testing.');
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
        console.error(`${displayName} webhook setup failed: ${error.message}`);
        process.exitCode = 1;
    });
}
