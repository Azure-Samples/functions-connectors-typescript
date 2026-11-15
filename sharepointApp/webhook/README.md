# SharePoint Online Webhook Triggers (TypeScript)

Azure Functions sample for the [SharePoint Online connector](https://learn.microsoft.com/connectors/sharepointonline/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) and [@azure/connectors](https://www.npmjs.com/package/@azure/connectors). The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/`, uses a typed `connectors.sharepoint` helper, and logs `<FunctionName> trigger received.` followed by each record (or the ID, name, and deletion details for deletion triggers). Use a test site and non-sensitive data.

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
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 on Windows for `postdeploy.ps1`, or Bash with `jq` on macOS/Linux for `postdeploy.sh`
- A SharePoint Online site and library, and permission to authorize the connection; deletion triggers require a site collection administrator, and classification requires a licensed Syntex model
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
cd sharepointApp/webhook
az login
azd auth login
azd env new sharepoint-webhook
azd env set SHAREPOINT_SITE_URL https://contoso.sharepoint.com/sites/mysite
azd up
```

Use a different environment from the polling sample, and supply the site root, not a library path or sharing link. Complete OAuth consent in the browser opened by the hook; an already **Connected** connection skips consent. By default, the five create/update triggers monitor the `Documents` library.

## Optional configuration

Set environment values with `azd env set <setting> <value>` before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `SHAREPOINT_SITE_URL` | Required site-root URL |
| `SHAREPOINT_LIBRARY_NAME` | `Documents`; library name or GUID |
| `SHAREPOINT_LIST_NAME` | Empty uses the library; otherwise a list name or GUID for item/form triggers |
| `SHAREPOINT_FOLDER_PATH` | Empty; optional file/digest folder filter |
| `SHAREPOINT_ENABLE_DELETION_TRIGGERS` | `false`; enables item/file deletion triggers |
| `SHAREPOINT_ENABLE_SYNTEX_TRIGGER` | `false`; enables the Syntex classification trigger |
| `SHAREPOINT_FORM_ID` | Empty; set an existing form ID to enable form submissions |
| `SHAREPOINT_DIGEST_SCHEDULE` | Empty; `*` for a daily digest or `0` through `6` for a day of the week |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `azd hooks run postdeploy` | Rerun consent and trigger setup without redeploying |

Opt-in functions are disabled in Azure with `AzureWebJobs.<Function>.Disabled` unless selected. To disable them again, reset the flags or clear the form ID/schedule and rerun `azd up`.

## Local development

Registering local callbacks replaces the deployed callbacks for this environment; use a separate environment to avoid disrupting Azure delivery.

1. Prepare `local.settings.json` from the example (an existing file is preserved), fill in its placeholders, and add `AzureWebJobs.<Function>.Disabled` flags matching your opt-in selection:

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

Check the connection is **Connected** and the selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create, then modify, a file or item in the monitored library or list, and look for `<FunctionName> trigger received.` in the function logs or Application Insights. Optional triggers require their corresponding source action. Delivery is at least once, so production handlers should be idempotent.

To remove the Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [SharePoint Online connector reference](https://learn.microsoft.com/connectors/sharepointonline/)
