# OneDrive for Business Polling Triggers (TypeScript)

Azure Functions sample for the [OneDrive for Business connector](https://learn.microsoft.com/connectors/onedriveforbusiness/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) and [@azure/connectors](https://www.npmjs.com/package/@azure/connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/` and logs only the trigger name and, for typed batches, the item count (for example, `Received OnOneDriveNewFile trigger (2 items).`).

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnOneDriveNewFileContent` | [`OnNewFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created) | File created, including content |
| `OnOneDriveUpdatedFileContent` | [`OnUpdatedFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified) | File modified, including content |
| `OnOneDriveNewFile` | [`OnNewFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created-(properties-only)) | File created (properties only) |
| `OnOneDriveUpdatedFile` | [`OnUpdatedFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified-(properties-only)) | File modified (properties only) |

Properties-only functions use the typed `connectors.onedriveforbusiness` helpers. The content functions use `app.connectorTrigger` to return the raw payload unchanged; they log only the trigger name and never parse or log file contents.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows, because azd runs the hooks with `pwsh` (the setup script itself is Node.js)
- A OneDrive for Business account with access to the folder to watch, and permission to complete OAuth consent
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
cd onedriveApp/polling
az login
azd auth login
azd env new onedrive-polling
azd up
```

Use a different environment from the webhook sample. Complete OAuth consent in the browser opened by the hook, then browse to a folder and choose its **Use** entry; the drive root placeholder `root` cannot be selected. The selected folder is applied to all four triggers.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `POLLING_TRIGGER_INPUTS` | Saved folder selection, reused on redeployment; clear it with `azd env set POLLING_TRIGGER_INPUTS=` to choose again |
| `azd hooks run postdeploy` | Rerun consent, folder selection, and trigger setup without redeploying |

The postdeploy hook creates the Poll trigger configurations named by the `<Function>TriggerConfigName` settings in `local.settings.example.json` and applies the polling endpoint and settings to the Function App with managed-identity authentication.

## Local development

If the Function App is already deployed, stop it before running locally; listeners sharing a trigger configuration compete for events.

1. Prepare `local.settings.json`.

   Use the ignored file generated during `azd up`, which contains the polling endpoint and trigger configuration names. An existing file is preserved. Only if the file is missing, rerun setup:

   ```bash
   azd hooks run postdeploy
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

Check the connection is **Connected** and all four triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create a small file (under 50 MB) in the selected folder, then modify it. Look for `Received <FunctionName> trigger` in the function logs or Application Insights. Allow time for source polling; delivery is at least once, and moving a file within OneDrive does not create a new-file event.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [OneDrive for Business connector reference](https://learn.microsoft.com/connectors/onedriveforbusiness/)
