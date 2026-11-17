# Planner Webhook Triggers (TypeScript)

Azure Functions sample using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). It handles [Planner connector](https://learn.microsoft.com/connectors/planner/) triggers. The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/`, uses typed payloads, and logs `<FunctionName> trigger received.` followed by the task ID, title, and completion, plan, or assignment details.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnPlannerCompleteTask` | [`OnCompleteTask_V3`](https://learn.microsoft.com/connectors/planner/#when-a-task-is-completed) | Task completed in a plan |
| `OnPlannerNewTask` | [`OnNewTask_V3`](https://learn.microsoft.com/connectors/planner/#when-a-new-task-is-created) | Task created in a plan |
| `OnPlannerTaskAssignedToMe` | [`OnTaskAssignedToMe_V2`](https://learn.microsoft.com/connectors/planner/#when-a-task-is-assigned-to-me) | Task assigned to the signed-in user |

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- A Microsoft 365 account with Planner access to the selected group and plan, and permission to authorize the connection
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
cd plannerApp/webhook
az login
azd auth login
azd env new planner-webhook
azd up
```

Complete the OAuth sign-in opened by `azd up` with the Planner account to monitor. Setup prompts for the group and plan (the `id` parameter is the plan ID, not a task ID); the assigned-to-me trigger needs no selectors. Configure or skip each trigger when prompted; at least one trigger must be configured. If setup fails or is interrupted, run `azd hooks run postdeploy` to retry without redeploying.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

Set environment values before `azd up`.

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `PLANNER_WEBHOOK_TRIGGER_INPUTS` | Saved trigger selections reused on rerun; run `azd env set PLANNER_WEBHOOK_TRIGGER_INPUTS=` then `azd hooks run postdeploy` to select again |
| `AzureWebJobs.<FunctionName>.Disabled` | App setting written by setup; `true` for skipped triggers |

Skipped triggers' subscriptions are disabled, not deleted. Subscriptions owned by other apps are never overwritten.

## Local development

1. Prepare `local.settings.json`.

   `azd up` creates it with the `PlannerConnection` runtime URL; existing files are preserved. Without a deployment, create it from the example and fill in the placeholder:

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

Check the connection is **Connected** and selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create, complete, or assign a task to the connected user, then check Function App logs for `<FunctionName> trigger received.`; build/deployment success alone is not real-event verification. Delivery is at least once and source detection may be delayed.

Run `azd down --purge` when finished.

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Planner connector reference](https://learn.microsoft.com/connectors/planner/)
