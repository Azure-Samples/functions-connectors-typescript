# Generic Connector Trigger Sample - Polling

`OnGenericConnectorEvent` receives raw events through `app.connectorTrigger` with `DeliveryMode.Poll` and logs only `OnGenericConnectorEvent (generic API) trigger received.` It uses no connector SDK models and does not normalize or inspect payloads. The [webhook app](../webhook/README.md) runs separately. No public callback, tunnel, or `EnablePollingSamples` flag is required.

## Prerequisites

Requires Node.js 24+, Functions Core Tools v4, Azure CLI, and Azurite for local storage. Use an existing authorized Connector Namespace connection and enabled Poll trigger configuration. Grant the namespace identity and receiving developer/app identity connection access. Follow the [Poll setup and access-policy guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery).

This app has no provisioning template, `azd up`, or postdeploy hook. Provision resources separately or use a dedicated connector sample. The handler is connector-neutral; it does not subscribe to Office 365.

## Deploy and configure

Use an existing Node.js 24 Function App with host and deployment storage. Enable its system-assigned managed identity and keep the namespace's identity. Configure these deployed app settings:

| Setting | Value |
| --- | --- |
| `GenericTriggerConfigName` | Existing enabled Poll trigger configuration name |
| `ConnectorNamespace__pollingEndpoint` | Base derived from its service `pollingEndpoints.receiveUri` |
| `ConnectorNamespace__credential` | `managedidentity` |
| `AzureWebJobsStorage__credential` | `managedidentity` |
| `AzureWebJobsStorage__blobServiceUri`, `AzureWebJobsStorage__queueServiceUri`, `AzureWebJobsStorage__tableServiceUri` | Host storage account's Blob, Queue, and Table endpoints |

Grant the app principal connection access and Storage Blob Data Owner, Storage Queue Data Contributor, and Storage Table Data Contributor on host storage. For Flex deployment storage, use `SystemAssignedIdentity` authentication and grant Storage Blob Data Contributor on its container (covered by Blob Data Owner when shared). Configure Node.js 24 through the Flex runtime configuration, not `FUNCTIONS_WORKER_RUNTIME`.

Run from this folder:

```sh
npm ci
az login
npm run build
func azure functionapp publish <function-app-name>
```

Local settings are not published. Keep the Preview Functions Extension Bundle in [host.json](host.json).

## Run locally

If absent, copy `local.settings.example.json` to `local.settings.json`; preserve existing values. Fill in `GenericTriggerConfigName` and derive the endpoint from the service's receive URI:

| Receive URI | Endpoint setting |
| --- | --- |
| `https://<host>/api/triggerconfigs/<name>/receive?...` | `https://<host>` |
| `https://<host>/api/connectorGateways/<id>/triggerconfigs/<name>/receive?...` | `https://<host>/api/connectorGateways/<id>` |

Preserve the host and gateway prefix; remove the operation path and query. `ConnectorNamespace` is a settings prefix, not a connection resource name.

Omit managed-identity credentials locally and sign in with the developer granted connection access. Start Azurite separately first:

```sh
npm ci
az login
npm start
```

Stop the deployed listener or use separate trigger configurations to avoid competing for events. `UseDevelopmentStorage=true` is local only. Never commit tokens or private local settings.

## Validate

Run `npm test` for offline tests. Cause an event for the configured operation, such as a test blob added or modified through Azure Blob's `OnUpdatedFiles_V2`. Verify source registration and a successful invocation with the receipt log, not just a running admin host. Delivery may repeat; this sample neither deduplicates nor exposes Poll `MessageId` metadata.

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` for host telemetry when needed. For Entra telemetry, set `APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD` and grant the app principal Monitoring Metrics Publisher. This app adds no separate SDK exporter. Disable or remove only configurations created for your test; do not delete shared resources.
