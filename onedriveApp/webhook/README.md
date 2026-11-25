<!--
---
name: "Azure Functions Connector Samples (TypeScript): OneDrive for Business webhook"
description: Receive OneDrive for Business file events with webhooks in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-onedrive-webhook-typescript
---
-->

# OneDrive for Business Webhook Triggers (TypeScript)

Azure Functions sample for the [OneDrive for Business connector](https://learn.microsoft.com/connectors/onedriveforbusiness/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/` and logs the trigger name on receipt (for example, `OnOneDriveNewFile trigger received.`).

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnOneDriveNewFileContent` | [`OnNewFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created) | File created, including content |
| `OnOneDriveUpdatedFileContent` | [`OnUpdatedFileV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified) | File modified, including content |
| `OnOneDriveNewFile` | [`OnNewFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-created-(properties-only)) | File created (properties only) |
| `OnOneDriveUpdatedFile` | [`OnUpdatedFilesV2`](https://learn.microsoft.com/connectors/onedriveforbusiness/#when-a-file-is-modified-(properties-only)) | File modified (properties only) |

Properties-only functions use the typed `connectors.onedriveforbusiness` helpers and also log each file's name, path, and size or last-modified time. The content functions use `app.connectorTrigger` to return the raw payload unchanged; they log only receipt and never log file contents. Use a test account and non-sensitive files.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows for `postdeploy.ps1`, or Bash with `jq` on macOS/Linux for `postdeploy.sh`
- A OneDrive for Business account with access to the folder to watch, and permission to complete OAuth consent
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
cd onedriveApp/webhook
az login
azd auth login
azd env new onedrive-webhook
azd up
```

Use a different environment from the polling sample. Complete OAuth consent in the browser opened by the hook, then pick the folder to monitor; the literal `root` is not a valid trigger folder ID. The hook creates all four trigger configurations for that folder with the Function App's callback.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `ONEDRIVE_FOLDER_ID` | Connector-returned folder ID; saved by the picker and offered on later runs |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `azd hooks run postdeploy` | Rerun consent, folder selection, and trigger setup without redeploying |

## Local development

Registering local callbacks replaces the deployed callbacks for this environment; use a separate environment to avoid disrupting Azure delivery.

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

4. Expose port 7071 through a public HTTPS tunnel, then register each function's `https://<tunnel-host>/runtime/webhooks/connector?functionName=<Function>` callback with the local host's `connector_extension` system key (not the Azure app's key), following the [webhook configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#webhook-delivery). The postdeploy hook registers Azure callbacks only.

After testing locally, rerun `azd hooks run postdeploy` to restore Azure delivery, then close the tunnel. Use [polling](../polling/README.md) to avoid a tunnel.

## Verify

Check the connection is **Connected** and all four triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create a small file (under 50 MB) in the selected folder, then modify it. Look for `<FunctionName> trigger received.` (content functions log `<FunctionName> content trigger received.`) in the function logs or Application Insights. A single change can invoke both its content and properties-only function. Delivery is at least once, and moving a file within OneDrive does not create a new-file event.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [OneDrive for Business connector reference](https://learn.microsoft.com/connectors/onedriveforbusiness/)
