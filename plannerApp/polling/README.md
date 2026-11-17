# Planner Polling Triggers (TypeScript)

Azure Functions sample for the [Planner connector](https://learn.microsoft.com/connectors/planner/) using `@azure/functions-extensions-connectors` with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback, Function key, or tunnel is required. Each function has its own file under `src/functions/`, uses the named Planner SDK helper, logs only the trigger name and task count, and returns `context.rawPayload`.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnPlannerCompleteTask` | `OnCompleteTask_V3` | Task completed |
| `OnPlannerNewTask` | `OnNewTask_V3` | Task created |
| `OnPlannerTaskAssignedToMe` | `OnTaskAssignedToMe_V2` | Task assigned to the signed-in user |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later (required for infrastructure layers)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 (`pwsh`) on Windows, used by the azd hooks
- A Microsoft 365 account with Planner access and permission to read the selected groups and plans
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and Azurite for local development
- The [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) with `connection authenticate` support:

  ```bash
  az extension add --name connector-namespace --upgrade
  ```

## Deploy to Azure

```bash
cd plannerApp/polling
az login
azd auth login
azd env new planner-polling
azd up
```

Use an interactive terminal and a different azd environment from webhook. This folder contains its own infrastructure, dependencies, and setup scripts. After packaging, `azd up` runs these layers in order:

1. **base** creates the resource group, Connector Namespace, Planner connection, and developer access policy.
2. **triggers** runs `polling-setup.mjs prepare` for consent and source selection, then `poll-triggers.bicep` provisions selected Poll configurations as Enabled.
3. **app** runs `polling-setup.mjs verify` to check the trigger receive endpoints, then `function-app.bicep` creates the Node.js 24 Flex Consumption Function App, storage, monitoring, and Function App access policy with Poll settings already applied.
4. **deploy** runs `polling-setup.mjs finish` to verify settings and create local settings if absent, then deploys the function code.

Complete consent in your browser with the account whose Planner tasks you want to monitor. The terminal checks Azure connection status every 10 seconds during consent and explicitly confirms when authentication succeeds, even if the browser window does not update. You can then close the sign-in windows.

Setup first asks **Configure** or **Skip** for every trigger; at least one must be configured. It then uses live connector metadata and authenticated pickers for the group and plan selectors required by selected triggers. Bicep creates Poll configurations without webhook `notificationDetails` and applies the service-derived endpoint, trigger names, and `ConnectorNamespace__credential=managedidentity` when provisioning the Function App.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / command | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `azd provision triggers` | Retry authorization and trigger provisioning without reprovisioning base resources; then run `azd provision app` and `azd deploy` |
| `azd env set POLLING_TRIGGER_INPUTS ""` | Clear saved selections before rerunning `azd provision triggers` |
| `azd hooks run predeploy` | Verify provisioned triggers and recreate missing local settings |

Reruns reuse unchanged subscriptions. Webhook configurations and configurations owned by other apps are never overwritten. Existing webhook deployments are not modified or migrated.

At least one trigger must be configured. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment.

**What Skip means:** The function code is still deployed, but its listener is disabled with `AzureWebJobs.<Function>.Disabled=true`. Setup creates no connector trigger configuration for that function in the namespace. If this sample previously created one, setup disables it instead of deleting it.

## Local development

Stop the deployed Function App first, or use a separate environment, to avoid competing listeners.

1. Use the `local.settings.json` generated by successful `azd up`, or rerun `azd hooks run predeploy` after provisioning. Existing files are never overwritten; update their endpoint and trigger names manually if necessary. `npm run setup:local` only creates a placeholder file from the example when no file exists; it does not provision or authorize resources.
2. Sign in with `az login`. Use developer credentials locally, not cloud managed-identity settings.
3. Start Azurite in a separate terminal with `azurite`.
4. Run:

   ```bash
   npm ci
   npm run build
   func start
   ```

The host needs the extension bundle specified in `host.json` with Poll delivery support. No public callback, Function key, or tunnel is needed. Never commit local settings or credentials.

## Verify

Check the connection is **Connected** and all three triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Create and complete tasks in the selected plans and assign a task to the signed-in user, then inspect logs for `Received <FunctionName> trigger (<Count> items).`. Delivery is at least once and source detection may be delayed. Build success or an Enabled configuration alone does not verify real-event delivery.

Run `azd down --purge` from this folder when finished to remove this environment's deployed resources.

## More

- [Planner connector reference](https://learn.microsoft.com/connectors/planner/)
- [Poll configuration contract](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery)
- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
