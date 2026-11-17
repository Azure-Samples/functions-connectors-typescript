# SharePoint Online Polling Triggers (TypeScript)

Azure Functions sample for the [SharePoint Online connector](https://learn.microsoft.com/connectors/sharepointonline/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/`, uses a typed `connectors.sharepoint` helper, and logs only the trigger name and item count (for example, `Received OnSharepointNewItems trigger (2 items).`).

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnSharepointNewFileItems` | [`GetOnNewFileItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-a-file-is-created-(properties-only)) | File created (properties only) |
| `OnSharepointUpdatedFileItems` | [`GetOnUpdatedFileItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-a-file-is-created-or-modified-(properties-only)) | File created or modified (properties only) |
| `OnSharepointNewItems` | [`GetOnNewItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-an-item-is-created) | Item created |
| `OnSharepointUpdatedItems` | [`GetOnUpdatedItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-an-item-is-created-or-modified) | Item created or modified |
| `OnSharepointChangedItems` | [`GetOnChangedItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-an-item-or-a-file-is-modified) | Item or file modified, not created |
| `OnSharepointDeletedItems` | [`GetOnDeletedItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-an-item-is-deleted) | Item deleted (opt-in) |
| `OnSharepointDeletedFileItems` | [`GetOnDeletedFileItems`](https://learn.microsoft.com/connectors/sharepointonline/#when-a-file-is-deleted) | File deleted (opt-in) |
| `OnSharepointNewItemsFromForm` | [`GetOnNewItemsFromForm`](https://learn.microsoft.com/connectors/sharepointonline/#when-a-form-is-submitted-(preview)) | Form submitted (preview, opt-in) |
| `OnSharepointUpdatedFileClassifiedTimes` | [`GetOnUpdatedFileClassifiedTimes`](https://learn.microsoft.com/connectors/sharepointonline/#when-a-file-is-classified-by-a-microsoft-syntex-model) | Microsoft Syntex classification (opt-in) |
| `OnSharepointRecurrenceDigest` | [`GetOnRecurrenceDigest`](https://learn.microsoft.com/connectors/sharepointonline/#recurring-digest-of-updates-(preview)) | Recurring digest (preview, opt-in) |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows, because azd runs the hooks with `pwsh` (the setup script itself is Node.js)
- A SharePoint Online site and list or library, and permission to authorize the connection; deletion triggers require a site collection administrator, and classification requires a licensed Syntex model
- For local development: [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
- [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli):

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  Or in PowerShell:

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

```bash
cd sharepointApp/polling
az login
azd auth login
azd env new sharepoint-polling
azd up
```

Use a different environment from the webhook sample. Complete OAuth consent in the browser opened by setup, then answer the source prompts (for example **Site Address** and **List Name** or **Library Name**) using the connector's pickers. Infrastructure provisions selected Poll triggers as **Enabled** after consent, then deploys the Function App with the trigger's polling endpoint before deploying the code. If a required picker returns no choices, that trigger is skipped; at least one trigger must be configured.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `POLLING_TRIGGER_INPUTS` | Saved source selections, reused on redeployment; clear it with `azd env set POLLING_TRIGGER_INPUTS=` to choose again |
| `azd provision triggers` | Rerun consent, source selection, and trigger setup without reprovisioning base resources; then run `azd provision app` and `azd deploy` |

Setup attempts to configure the five create/update triggers. For each opt-in trigger, it prompts **Skip** or **Configure**; skipped triggers get `AzureWebJobs.<Function>.Disabled=true` and any existing configuration is disabled. Optional inputs such as **Folder** or **Limit Columns by View** can be skipped to use connector defaults. Trigger configuration names come from the `<Function>TriggerConfigName` settings in `local.settings.example.json`.

## Local development

If the Function App is already deployed, stop it before running locally; listeners sharing a trigger configuration compete for events.

1. Prepare `local.settings.json`.

   Use the ignored file generated during `azd up`, which contains the polling endpoint, trigger configuration names, and disabled-function flags. An existing file is preserved. Only if the file is missing, rerun setup:

   ```bash
   azd hooks run predeploy
   ```

2. Sign in as a developer with access to the connection, and start Azurite in a separate terminal:

   ```bash
   az login
   azurite
   ```

3. Install, build, and start the local host:

   ```bash
   npm ci
   npm run build
   func start
   ```

Local runs use developer credentials; do not copy the deployed managed-identity settings locally.

## Verify

Check the connection is **Connected** and the selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create, then modify, a file or item in the selected list or library, and look for `Received <FunctionName> trigger (<Count> items).` in the function logs or Application Insights. Allow time for source polling; optional triggers require their corresponding source action. Delivery is at least once, so production handlers should be idempotent.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [SharePoint Online connector reference](https://learn.microsoft.com/connectors/sharepointonline/)
