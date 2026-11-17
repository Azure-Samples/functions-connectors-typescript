# Generic Connector Webhook Triggers (TypeScript)

Connector-neutral Azure Functions sample using the generic `connectorTrigger` helper from [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The Connector Namespace delivers events from an existing trigger configuration to the function's public HTTPS callback. This sample has no `azd` provisioning or postdeploy hooks.

The function is in its own file under `src/functions/`, uses the default `unknown` item type without connector-specific models, and logs only the trigger name. The function name routes callbacks; it does not subscribe automatically.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnGenericConnectorEvent` | Any supported [connector](https://learn.microsoft.com/connectors/connector-reference/) trigger, for example Azure Blob [`OnUpdatedFiles_V2`](https://learn.microsoft.com/connectors/azureblob/#when-a-blob-is-added-or-modified-(properties-only)-(v2)) | Raw event from webhook trigger configurations whose callback targets this function |

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- An existing Connector Namespace with system-assigned identity, an authorized connection, and webhook trigger configurations; follow the [webhook configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#webhook-delivery)
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) for publishing and local development, and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) for local storage
- Optionally, the [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) to create or inspect trigger configurations:

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

Use an existing Node.js 24 Function App with host and deployment storage. Enable its system-assigned managed identity and configure host storage:

| Setting | Value |
| --- | --- |
| `AzureWebJobsStorage__credential` | `managedidentity` |
| `AzureWebJobsStorage__blobServiceUri`, `AzureWebJobsStorage__queueServiceUri`, `AzureWebJobsStorage__tableServiceUri` | Host storage account's Blob, Queue, and Table endpoints |

Grant the app principal Storage Blob Data Owner, Storage Queue Data Contributor, and Storage Table Data Contributor on host storage. Then publish from this folder:

```bash
cd genericApp/webhook
az login
npm ci
npm run build
func azure functionapp publish <function-app-name>
```

Point each trigger configuration's `notificationDetails.callbackUrl` at `https://<function-app-host>/runtime/webhooks/connector?functionName=OnGenericConnectorEvent` and set `notificationDetails.authentication` to `type: "QueryString"`, `name: "code"`, with the host's `connector_extension` system key as `value`. Never commit keys. No Poll endpoint or trigger-name app settings are required.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Host telemetry |
| `APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD` | Entra telemetry; grant the app principal Monitoring Metrics Publisher on Application Insights |

## Local development

1. Copy `local.settings.example.json` to `local.settings.json` if it does not exist.
2. Start Azurite in a separate terminal:

   ```bash
   azurite
   ```

3. Install, build, and start with key authentication enabled:

   ```bash
   npm ci
   npm run build
   func start --enableAuth
   ```

   Core Tools v4 bypasses local key authentication by default; keep `--enableAuth` before exposing the host through a tunnel.

4. Expose the host through a public HTTPS tunnel and point a separate trigger configuration at `https://<tunnel-host>/runtime/webhooks/connector?functionName=OnGenericConnectorEvent`, authenticated with the **local** host's `connector_extension` system key. Never replace a shared deployed callback for local testing.

## Verify

In [Connector Namespaces](https://connectors.azure.com/), check the connection is **Connected** and the trigger configuration is **Enabled**.

Cause a real source event for the configured operation, then look for `OnGenericConnectorEvent trigger received.` in the logs. Delivery is at least once; make processing idempotent. Disable or remove only configurations created for your test; do not delete shared resources.

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Connector trigger configuration](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md)
- [Connector reference](https://learn.microsoft.com/connectors/connector-reference/)
