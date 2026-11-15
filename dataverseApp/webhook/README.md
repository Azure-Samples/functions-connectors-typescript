# Microsoft Dataverse Webhook Triggers (TypeScript)

Azure Functions sample using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) and [@azure/connectors](https://www.npmjs.com/package/@azure/connectors). The Connector Namespace delivers events to the function's public HTTPS callback.

Each function is in its own file under `src/functions/`, uses the raw `app.connectorTrigger` API with an `unknown` payload, and logs only the trigger name.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnDataverseRowChanged` | [`SubscribeWebhookTrigger`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-added,-modified-or-deleted) | Row added, modified or deleted (`message=7`, `scope=4`) |
| `OnDataverseActionPerformed` | [`BusinessEventsTrigger`](https://learn.microsoft.com/connectors/commondataservice/#when-an-action-is-performed) | Selected action performed |
| `OnDataverseRowAdded` | [`SubscribeOnNewItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-added-%5Bdeprecated%5D) | When a row is added |
| `OnDataverseRowModified` | [`SubscribeOnUpdatedItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-modified-%5Bdeprecated%5D) | When a row is modified |
| `OnDataverseRowDeleted` | [`SubscribeOnDeletedItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-deleted-%5Bdeprecated%5D) | When a row is deleted |

The connector is [Microsoft Dataverse (`commondataservice`)](https://learn.microsoft.com/connectors/commondataservice/); its separate row operations are marked deprecated in connector metadata. They overlap the combined row-change event, so one row change can invoke both.

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 (`pwsh`) on Windows, used by the `azd` hooks in `azure.yaml`
- A Dataverse environment and an account permitted to register organization-scoped events
- For local development: [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
- The [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) with `connection authenticate` support:

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

```bash
cd dataverseApp/webhook
az login
azd auth login
azd env new dataverse-webhook
azd up
```

Complete the Dataverse OAuth sign-in in your browser when prompted, then choose **Configure** or **Skip** for each trigger and answer its pickers. The hook creates per-function callbacks authenticated with the `connector_extension` system key. Use a different azd environment from the polling sample. To retry an interrupted setup without redeploying, run `azd hooks run postdeploy`.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `AZURE_LOCATION` | Function App region; prompted if unset |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `DATAVERSE_WEBHOOK_TRIGGER_INPUTS` | Saved trigger selections, reused on reruns; clear with `azd env set DATAVERSE_WEBHOOK_TRIGGER_INPUTS=` and rerun `azd hooks run postdeploy` to select again |
| `AzureWebJobs.<Function>.Disabled` | Written by postdeploy; `true` for skipped triggers |

The postdeploy hook prompts only for required selectors. If a picker returns no choices, enter the actual connector identifier, or leave it blank to skip that trigger; skipped functions are disabled. Action-performed needs a real catalog, category, table, and action available to the signed-in user.

## Local development

1. Prepare `local.settings.json`. `azd up` creates it; existing files are preserved. Otherwise run `npm run setup:local`.
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

4. Expose the host through a public HTTPS tunnel and create separate trigger configurations whose callback is `https://<tunnel-host>/runtime/webhooks/connector?functionName=<Function>`, authenticated with the **local** host's `connector_extension` system key (`QueryString`, name `code`). See [trigger configuration](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md).

The postdeploy hook configures Azure callbacks only, not tunnels or local trigger configurations.

## Verify

In [Connector Namespaces](https://connectors.azure.com/), check the connection is **Connected** and the selected trigger configurations are **Enabled**.

Create, modify, and delete a test row, then look for `Received OnDataverseRowChanged trigger.` (and the matching `Received <Function> trigger.` logs for other selected triggers). Delivery is at least once; make processing idempotent.

Remove this environment's Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Microsoft Dataverse connector reference](https://learn.microsoft.com/connectors/commondataservice/)
