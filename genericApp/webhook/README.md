# Generic Connector Trigger Sample

[`OnGenericConnectorEvent`](src/functions/onGenericConnectorEvent.ts) receives events from any supported connector through `connectorTrigger` from `@azure/functions-extensions-connectors`. No type argument is needed; the item type defaults to `unknown`. Webhook delivery is the default, so no delivery mode is specified. The helper normalizes events into `context.items` and exposes the parsed input through `context.rawPayload`. The handler logs only `OnGenericConnectorEvent trigger received.` without inspecting payloads or using connector-specific models.

The function name routes callbacks; it does not subscribe automatically. Configure a supported operation, connection, and actual source parameters in your Connector Namespace trigger configuration. There is no Office 365 example. For outbound delivery without a callback, use the independent [polling app](../polling/README.md).

## Prerequisites

Requires Node.js 24+, Functions Core Tools v4, Azure CLI, and Azurite for local storage. Use an existing Connector Namespace with system-assigned identity, an authorized connection, and enabled Webhook trigger configurations. Follow the [webhook configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#webhook-delivery).

This app has no provisioning template, `azd up`, or postdeploy hook. Use a dedicated connector sample to provision resources, or configure them separately.

## Deploy to Azure

Use an existing Node.js 24 Function App with host and deployment storage. Enable its system-assigned managed identity and keep the namespace's identity.

| Host storage setting | Value |
| --- | --- |
| `AzureWebJobsStorage__credential` | `managedidentity` |
| `AzureWebJobsStorage__blobServiceUri`, `AzureWebJobsStorage__queueServiceUri`, `AzureWebJobsStorage__tableServiceUri` | Host storage account's Blob, Queue, and Table endpoints |

Grant the app principal Storage Blob Data Owner, Storage Queue Data Contributor, and Storage Table Data Contributor on host storage. For Flex deployment storage, use `SystemAssignedIdentity` authentication and grant Storage Blob Data Contributor on the deployment container (the host account's Blob Data Owner role covers it if shared). Configure Node.js 24 through the Flex runtime configuration, not `FUNCTIONS_WORKER_RUNTIME`.

Run from this folder:

```sh
npm ci
npm run build
az login
func azure functionapp publish <function-app-name>
```

Local settings are not published. Keep the Preview Functions Extension Bundle configured in [host.json](host.json).

## Connector configuration

Route your trigger configuration to the registered function:

```text
https://<functions-host>/runtime/webhooks/connector?functionName=OnGenericConnectorEvent
```

Set `notificationDetails.authentication` to type `QueryString`, name `code`, and value equal to the host's `connector_extension` system key, not an ordinary function key. Keep it separate from the callback URL and never print or commit it. No Poll endpoint or trigger-name app settings are required.

## Verify

Confirm the selected connection is `Connected` and its trigger is `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Check that the callback targets `OnGenericConnectorEvent`, then generate an event and inspect the Function App logs.

## Run locally

If absent, copy `local.settings.example.json` to `local.settings.json`; preserve existing values. Start Azurite separately, then run:

```sh
npm ci
npm start -- --enableAuth
```

Core Tools bypasses key checks locally by default. Keep `--enableAuth` before exposing the host through a public HTTPS tunnel. Use a separate trigger configuration pointing at the tunnel callback and the local host's `connector_extension` system key. Remote host keys do not authenticate the local host. Never expose an unauthenticated webhook or replace a shared deployed callback for testing.

## Telemetry and cleanup

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` for host telemetry when needed. For Entra telemetry, set `APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD` and grant the app principal Monitoring Metrics Publisher. This app adds no separate SDK exporter or worker connector credential section.

Run `npm test` for offline checks. Verify successful invocations with actual source events, not just a running admin host. Delivery may repeat; make production processing idempotent. Disable or remove only configurations created for your test; do not delete shared resources.

## More

- [Connector trigger extension](https://github.com/Azure/azure-functions-connector-extension)
- [All TypeScript samples](../../README.md#samples)
