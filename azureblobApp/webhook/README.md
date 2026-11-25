<!--
---
name: "Azure Functions Connector Samples (TypeScript): Azure Blob Storage webhook"
description: Receive Azure Blob Storage file events with webhooks in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-azure-blob-webhook-typescript
---
-->

# Azure Blob Storage Webhook Triggers (TypeScript)

Azure Functions sample for the [Azure Blob Storage connector](https://learn.microsoft.com/connectors/azureblob/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The Connector Namespace delivers events to the function's public HTTPS callback. The function is in its own file under `src/functions/`, uses the generic `connectorTrigger<BlobMetadata>` API, and logs `OnAzureBlobUpdatedFile trigger received.`, each blob's name, path, size, and last-modified time, and the batch count.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnAzureBlobUpdatedFile` | [`OnUpdatedFiles_V2`](https://learn.microsoft.com/connectors/azureblob/#when-a-blob-is-added-or-modified-(properties-only)-(v2)) | Blob added or modified (properties only) |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows for `postdeploy.ps1`, or Bash with `jq` on macOS/Linux for `postdeploy.sh`
- Azure permissions to deploy resources and role assignments
- For local development: [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local), [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite), and a public HTTPS tunnel such as [dev tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started)
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
cd azureblobApp/webhook
az login
azd auth login
azd env new azureblob-webhook
azd up
```

Use a different environment from the polling sample. Deployment provisions a separate monitored storage account with a `testcontainer` container and configures the connection with the namespace's managed identity, so no OAuth consent is needed. The `postup` hook creates the trigger configuration with the Function App's callback. Storage role assignments can take up to 10 minutes to propagate.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `azd hooks run postup` | Rerun connection and trigger setup without redeploying |

## Local development

Registering a local callback replaces the deployed callback for this environment; use a separate environment to avoid disrupting Azure delivery.

1. Prepare `local.settings.json` from the example (an existing file is preserved), then fill in its placeholders:

   ```bash
   npm run setup:local
   ```

2. Start Azurite in a separate terminal:

   ```bash
   azurite
   ```

3. Install, build, and start the host with authentication enabled:

   ```bash
   npm ci
   npm run build
   func start --enableAuth
   ```

   Core Tools v4 bypasses key authentication locally by default; use `--enableAuth` before exposing the host through a public tunnel.

4. Expose port 7071 through a public HTTPS tunnel, then register the `https://<tunnel-host>/runtime/webhooks/connector?functionName=OnAzureBlobUpdatedFile` callback with the local host's `connector_extension` system key (not the Azure app's key), following the [webhook configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#webhook-delivery). The `postup` hook registers the Azure callback only.

After testing locally, rerun `azd hooks run postup` to restore Azure delivery, then close the tunnel. Use [polling](../polling/README.md) to avoid a tunnel.

## Verify

Check the connection is **Ready** or **Connected** and the trigger is **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Upload or modify a blob using the `monitoredStorageAccountName` and `monitoredContainerName` deployment outputs (the deployer is granted upload access):

```bash
az storage blob upload --auth-mode login --account-name <monitoredStorageAccountName> --container-name <monitoredContainerName> --name sample.txt --file <local-file> --overwrite
```

Look for `OnAzureBlobUpdatedFile trigger received.` in the function logs or Application Insights. Allow time for source polling; delivery is at least once.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Azure Blob Storage connector reference](https://learn.microsoft.com/connectors/azureblob/)
