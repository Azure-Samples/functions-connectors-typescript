<!--
---
name: "Azure Functions Connector Samples (TypeScript): Azure Blob Storage polling"
description: Receive Azure Blob Storage file events with polling in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-azure-blob-polling-typescript
---
-->

# Azure Blob Storage Polling Triggers (TypeScript)

Azure Functions sample for the [Azure Blob Storage connector](https://learn.microsoft.com/connectors/azureblob/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. The function is in its own file under `src/functions/`, uses the generic `connectorTrigger<BlobMetadata>` API, and logs only the trigger name and item count (`Received OnAzureBlobUpdatedFile trigger (<Count> items).`).

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnAzureBlobUpdatedFile` | [`OnUpdatedFiles_V2`](https://learn.microsoft.com/connectors/azureblob/#when-a-blob-is-added-or-modified-(properties-only)-(v2)) | Blob added or modified (properties only) |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows, because azd runs the hooks with `pwsh` (the setup script itself is Node.js)
- Azure permissions to deploy resources and role assignments
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
cd azureblobApp/polling
az login
azd auth login
azd env new azureblob-polling
azd up
```

Use a different environment from the webhook sample. Deployment provisions a separate monitored storage account with a `testcontainer` container and configures the connection with the namespace's managed identity, so no OAuth consent or source prompts are needed. Setup asks **Configure** or **Skip** for the trigger; choose **Configure** to continue because at least one trigger is required. After the connection is ready, infrastructure provisions the selected Poll trigger as **Enabled**, then deploys the Function App with the trigger's polling endpoint before deploying the code. Storage role assignments can take up to 10 minutes to propagate.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `POLLING_TRIGGER_INPUTS` | Saved source parameters, reused on redeployment; clear it with `azd env set POLLING_TRIGGER_INPUTS=` to regenerate them from the infrastructure outputs |
| `azd provision triggers` | Reapply trigger setup without reprovisioning the base resources; then run `azd provision app` and `azd deploy` |

The trigger configuration name comes from the `OnAzureBlobUpdatedFileTriggerConfigName` setting in `local.settings.example.json`; the Function App infrastructure applies it and the trigger layer's polling endpoint with managed-identity authentication.

At least one trigger must be configured. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment.

**What Skip means:** The function code is still deployed, but its listener is disabled with `AzureWebJobs.<Function>.Disabled=true`. Setup creates no connector trigger configuration for that function in the namespace. If this sample previously created one, setup disables it instead of deleting it.

## Local development

If the Function App is already deployed, stop it before running locally; listeners sharing a trigger configuration compete for events.

1. Prepare `local.settings.json`.

   Use the ignored file generated during `azd up`, which contains the polling endpoint and trigger configuration name. An existing file is preserved. Only if the file is missing, rerun setup:

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

Check the connection is **Ready** or **Connected** and the trigger is **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Upload or modify a blob using the `monitoredStorageAccountName` and `monitoredContainerName` deployment outputs (the deployer is granted upload access):

```bash
az storage blob upload --auth-mode login --account-name <monitoredStorageAccountName> --container-name <monitoredContainerName> --name sample.txt --file <local-file> --overwrite
```

Look for `Received OnAzureBlobUpdatedFile trigger (<Count> items).` in the function logs or Application Insights. Allow time for source polling; delivery is at least once.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Azure Blob Storage connector reference](https://learn.microsoft.com/connectors/azureblob/)
