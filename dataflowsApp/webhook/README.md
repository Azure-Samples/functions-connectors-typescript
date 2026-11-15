# Dataflows Webhook Triggers (TypeScript)

Azure Functions sample using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) and [@azure/connectors](https://www.npmjs.com/package/@azure/connectors). It handles [Dataflows connector](https://learn.microsoft.com/connectors/dataflows/) triggers. The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/`, uses typed payloads, and logs `<FunctionName> trigger received.` followed by the dataflow name, ID, status, and start/end times.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnDataflowRefreshComplete` | [`OnRefreshComplete`](https://learn.microsoft.com/connectors/dataflows/#when-a-dataflow-refresh-completes) | Dataflow refresh completed |

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- A Power BI workspace or Power Platform environment with a dataflow, and permission to authorize the connection
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and Azurite for local development
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
cd dataflowsApp/webhook
az login
azd auth login
azd env new dataflows-webhook
azd up
```

Complete the OAuth sign-in opened by `azd up` with an account that can access the dataflow. Setup asks for the group type (`Workspace` or `Environment`), then uses pickers to select the group and dataflow. Configure or skip each trigger when prompted; at least one trigger must be configured. If setup fails or is interrupted, run `azd hooks run postdeploy` to retry without redeploying.

## Optional configuration

Set environment values before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `DATAFLOWS_WEBHOOK_TRIGGER_INPUTS` | Saved trigger selections reused on rerun; run `azd env set DATAFLOWS_WEBHOOK_TRIGGER_INPUTS=` then `azd hooks run postdeploy` to select again |
| `AzureWebJobs.<FunctionName>.Disabled` | App setting written by setup; `true` for skipped triggers |

Skipped triggers' subscriptions are disabled, not deleted. Subscriptions owned by other apps are never overwritten.

## Local development

1. Prepare `local.settings.json`.

   `azd up` creates it with the `DataflowsConnection` runtime URL; existing files are preserved. Without a deployment, create it from the example and fill in the placeholder:

   ```bash
   npm run setup:local
   ```

2. Start Azurite in a separate terminal.

   ```bash
   azurite
   ```

3. Install, build, and start the local Functions host with authentication enabled.

   ```bash
   npm ci
   npm run build
   func start --enableAuth
   ```

   Core Tools v4 bypasses local key authentication by default. Use `--enableAuth` before exposing the host through a public tunnel so callback requests must present the system key.

4. Expose port 7071 over public HTTPS. Get the **local** `connector_extension` system key from Azurite's `azure-webjobs-secrets`, not the Azure Function App's key or a function key. Keep it private.

5. In [Connector Namespaces](https://connectors.azure.com/), create a separate trigger configuration whose callback is `https://<tunnel-host>/runtime/webhooks/connector?functionName=<FunctionName>` with the local key as the `code` query parameter. The postdeploy hook only targets the deployed Function App, so do not retarget the deployed subscription.

6. When finished, disable or delete the local trigger configuration.

Never commit keys, callback URLs, or local settings.

## Verify

Check the connection is **Connected** and selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Refresh the selected dataflow, then check Function App logs for `<FunctionName> trigger received.`; build/deployment success alone is not real-event verification. Delivery is at least once and source detection may be delayed.

Run `azd down --purge` when finished.

## More

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Dataflows connector reference](https://learn.microsoft.com/connectors/dataflows/)
