# Generic Connector Polling Triggers (TypeScript)

Connector-neutral Azure Functions sample using the raw `app.connectorTrigger` API from [@azure/functions](https://www.npmjs.com/package/@azure/functions) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from an existing Connector Namespace trigger configuration; no public callback or tunnel is needed. This sample has no `azd` provisioning or postdeploy hooks.

The function is in its own file under `src/functions/`, receives an `unknown` payload without connector-specific models, and logs only the trigger name.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnGenericConnectorEvent` | Any supported [connector](https://learn.microsoft.com/connectors/connector-reference/) trigger, for example Azure Blob [`OnUpdatedFiles_V2`](https://learn.microsoft.com/connectors/azureblob/#when-a-blob-is-added-or-modified-(properties-only)-(v2)) | Raw event from the Poll trigger configuration named by `GenericTriggerConfigName` |

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- An existing Connector Namespace with an authorized connection and an enabled Poll trigger configuration; follow the [Poll setup and access-policy guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery)
- Connection access for the receiving developer and Function App identities
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) for publishing and local development, and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) for local storage
- Optionally, the [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) to create or inspect trigger configurations:

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

Use an existing Node.js 24 Function App with host and deployment storage. Enable its system-assigned managed identity, grant it connection access, and configure these app settings:

| Setting | Value |
| --- | --- |
| `GenericTriggerConfigName` | Existing enabled Poll trigger configuration name |
| `ConnectorNamespace__pollingEndpoint` | Base derived from the trigger's `pollingEndpoints.receiveUri` (see Local development) |
| `ConnectorNamespace__credential` | `managedidentity` |
| `AzureWebJobsStorage__credential` | `managedidentity` |
| `AzureWebJobsStorage__blobServiceUri`, `AzureWebJobsStorage__queueServiceUri`, `AzureWebJobsStorage__tableServiceUri` | Host storage account's Blob, Queue, and Table endpoints |

Grant the app principal Storage Blob Data Owner, Storage Queue Data Contributor, and Storage Table Data Contributor on host storage. Then publish from this folder:

```bash
cd genericApp/polling
az login
npm ci
npm run build
func azure functionapp publish <function-app-name>
```

Local settings are not published. Use separate trigger configurations for separate delivery environments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Host telemetry |
| `APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD` | Entra telemetry; grant the app principal Monitoring Metrics Publisher on Application Insights |

## Local development

Stop the deployed Function App or use a separate trigger configuration to avoid competing listeners.

1. Copy `local.settings.example.json` to `local.settings.json` if it does not exist.
2. Set `GenericTriggerConfigName` and `ConnectorNamespace__pollingEndpoint`, derived from the trigger's receive URI by removing the operation path and query:

   | Receive URI | Endpoint setting |
   | --- | --- |
   | `https://<host>/api/triggerconfigs/<name>/receive` | `https://<host>` |
   | `https://<host>/api/connectorGateways/<id>/triggerconfigs/<name>/receive` | `https://<host>/api/connectorGateways/<id>` |

3. Omit managed-identity settings locally and sign in with your developer identity:

   ```bash
   az login
   ```

4. Start Azurite in a separate terminal:

   ```bash
   azurite
   ```

5. Install, build, and start:

   ```bash
   npm ci
   npm run build
   func start
   ```

## Verify

In [Connector Namespaces](https://connectors.azure.com/), check the connection is **Connected** and the trigger configuration is **Enabled**.

Cause an event for the configured operation, then look for `OnGenericConnectorEvent (generic API) trigger received.` in the logs. Delivery is at least once; this sample does not deduplicate. Disable or remove only configurations created for your test; do not delete shared resources.

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Connector trigger configuration](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md)
- [Connector reference](https://learn.microsoft.com/connectors/connector-reference/)
