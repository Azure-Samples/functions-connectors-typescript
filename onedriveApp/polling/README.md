<!--
---
name: "Azure Functions Connector Samples (TypeScript): OneDrive for Business polling"
description: Receive OneDrive for Business file events with polling in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-onedrive-polling-typescript
---
-->

# OneDrive for Business Polling Triggers (TypeScript)

Azure Functions sample for the [OneDrive for Business connector](https://learn.microsoft.com/connectors/onedriveforbusiness/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/` and logs only the trigger name and, for typed batches, the item count (for example, `Received OnOneDriveNewFile trigger (2 items).`).

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnOneDriveNewFileContent` | [`OnNewFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created) | File created, including content |
| `OnOneDriveUpdatedFileContent` | [`OnUpdatedFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified) | File modified, including content |
| `OnOneDriveNewFile` | [`OnNewFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created-(properties-only)) | File created (properties only) |
| `OnOneDriveUpdatedFile` | [`OnUpdatedFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified-(properties-only)) | File modified (properties only) |

Properties-only functions use the typed `connectors.onedriveforbusiness` helpers. The content functions use `app.connectorTrigger` to return the raw payload unchanged; they log only the trigger name and never parse or log file contents.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
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

Use a different environment from the webhook sample. Complete OAuth consent in the browser opened by setup, then choose **Configure** or **Skip** for every trigger; at least one must be configured. After selecting triggers, browse to a folder and choose its **Use** entry; this folder is shared by the selected triggers, and the drive root placeholder `root` cannot be selected. Infrastructure provisions selected Poll triggers as **Enabled** after consent, then deploys the Function App with the trigger's polling endpoint before deploying the code.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `POLLING_TRIGGER_INPUTS` | Saved folder selection, reused on redeployment; clear it with `azd env set POLLING_TRIGGER_INPUTS=` to choose again |
| `azd provision triggers` | Rerun consent, folder selection, and trigger setup without reprovisioning base resources; then run `azd provision app` and `azd deploy` |

Trigger configuration names come from the `<Function>TriggerConfigName` settings in `local.settings.example.json`. Function App infrastructure applies them and the trigger layer's polling endpoint with managed-identity authentication.

At least one trigger must be configured. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment.

**What Skip means:** The function code is still deployed, but its listener is disabled with `AzureWebJobs.<Function>.Disabled=true`. Setup creates no connector trigger configuration for that function in the namespace. If this sample previously created one, setup disables it instead of deleting it.

## Local development

If the Function App is already deployed, stop it before running locally; listeners sharing a trigger configuration compete for events.

1. Prepare `local.settings.json`.

   Use the ignored file generated during `azd up`, which contains the polling endpoint and trigger configuration names. An existing file is preserved. Only if the file is missing, rerun setup:

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

Check the connection is **Connected** and all four triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create a small file (under 50 MB) in the selected folder, then modify it. Look for `Received <FunctionName> trigger` in the function logs or Application Insights. Allow time for source polling; delivery is at least once, and moving a file within OneDrive does not create a new-file event.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [OneDrive for Business connector reference](https://learn.microsoft.com/connectors/onedriveforbusiness/)
