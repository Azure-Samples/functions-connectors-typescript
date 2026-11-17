# Azure DevOps Polling Triggers (TypeScript)

Azure Functions sample for the [Azure DevOps connector](https://learn.microsoft.com/connectors/visualstudioteamservices/) using `@azure/functions-extensions-connectors` and `@azure/connectors` with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback, Function key, or tunnel is required. Each trigger has its own file under `src/functions/`, logs only the trigger name and item count, and returns `context.rawPayload`.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnAzureDevOpsBuildCompleted` | `OnBuildCompleted` | Build completed |
| `OnAzureDevOpsGitPullClosed` | `OnGitPullClosed` | Pull request closed |
| `OnAzureDevOpsGitPullCreated` | `OnGitPullCreated` | Pull request created |
| `OnAzureDevOpsGitPush` | `OnGitPush` | Code pushed (Git) |
| `OnAzureDevOpsTfvcCheckIn` | `OnTfvcCheckIn` | Code checked in (TFVC) |
| `OnAzureDevOpsWorkItemAssigned` | `OnWorkItemAssignedV2` | Work item assigned |
| `OnAzureDevOpsWorkItemClosed` | `OnWorkItemClosedV2` | Work item closed |
| `OnAzureDevOpsWorkItemCreated` | `OnWorkItemCreatedV2` | Work item created |
| `OnAzureDevOpsWorkItemUpdated` | `OnWorkItemUpdatedV2` | Work item updated |

The SDK helper namespace is still `connectors.vsts` and the connector ID remains `visualstudioteamservices`; sample-owned names use Azure DevOps.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later (required for infrastructure layers)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 (`pwsh`) on Windows, used by the azd hooks
- An Azure DevOps organization/project and an account in its home tenant with permission to access the selected builds, repositories, teams, or work items; TFVC requires a TFVC project
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and Azurite for local development
- The [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) with `connection authenticate` support:

  ```bash
  az extension add --name connector-namespace --upgrade
  ```

## Deploy to Azure

```bash
cd azureDevOpsApp/polling
az login
azd auth login
azd env new azuredevops-polling
azd up
```

Use an interactive terminal and a different azd environment from webhook. This folder contains its own infrastructure, dependencies, and setup scripts. After packaging, `azd up` runs these layers in order:

1. **base** creates the resource group, Connector Namespace, `EntraOAuth` connection, and developer access policy.
2. **triggers** runs `polling-setup.mjs prepare` for consent and source selection, then `poll-triggers.bicep` provisions selected Poll configurations as Enabled.
3. **app** runs `polling-setup.mjs verify` to check the trigger receive endpoints, then `function-app.bicep` creates the Node.js 24 Flex Consumption Function App, storage, monitoring, and Function App access policy with Poll settings already applied.
4. **deploy** runs `polling-setup.mjs finish` to verify settings and create local settings if absent, then deploys the function code.

Complete the browser sign-in with an account in the Azure DevOps organization's home tenant; user connections only list organizations in that tenant. The terminal checks Azure connection status every 10 seconds during consent and explicitly confirms when authentication succeeds, even if the browser window does not update. You can then close the sign-in windows.

Choose **Configure** or **Skip** for each trigger; at least one must be configured. Setup uses live connector metadata and authenticated pickers for organization, project, repository, team, and member selectors. Optional filters can be skipped. Bicep creates Poll configurations without webhook `notificationDetails` and applies the service-derived endpoint, trigger names, per-function disabled settings, and `ConnectorNamespace__credential=managedidentity` when provisioning the Function App.

Existing legacy Azure DevOps OAuth connections cannot issue new tokens. Setup rejects connections that do not use `EntraOAuth`; recreate them using this template rather than retrying consent. Existing webhook deployments and old `vstsApp` resources are not migrated.

## Optional configuration

| Setting / command | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `azd provision triggers` | Retry authorization and trigger provisioning without reprovisioning base resources; then run `azd provision app` and `azd deploy` |
| `azd env set POLLING_TRIGGER_INPUTS ""` | Clear saved selections before rerunning `azd provision triggers` |
| `azd hooks run predeploy` | Verify provisioned triggers and recreate missing local settings |
| `AzureWebJobs.<FunctionName>.Disabled` | Written by setup; `true` for skipped triggers |

Selections are saved as `POLLING_TRIGGER_INPUTS` in this azd environment. Reruns reuse unchanged subscriptions; deselected sample-owned subscriptions are disabled, not deleted. Webhook configurations and configurations owned by other apps are never overwritten.

## Local development

Stop the deployed Function App first, or use a separate environment, to avoid competing listeners.

1. Use the `local.settings.json` generated by successful `azd up`, or rerun `azd hooks run predeploy` after provisioning. Existing files are never overwritten; update their endpoint, trigger names, and disabled settings manually if necessary. `npm run setup:local` only creates a placeholder file from the example when no file exists; it does not provision or authorize resources.
2. Sign in with `az login`. Use developer credentials locally, not cloud managed-identity settings.
3. Start Azurite in a separate terminal with `azurite`.
4. Run:

   ```bash
   npm ci
   npm run build
   func start
   ```

The host needs the preview Connector extension bundle specified in `host.json` with Poll delivery support. No public callback, Function key, or tunnel is needed. Never commit local settings or credentials.

## Verify

Check the connection is **Connected** and selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Generate a selected event (queue a build, create/close a pull request, push code, check in TFVC changes, or create/assign/update/close a work item) and inspect logs for `Received <FunctionName> trigger (<Count> items).`. Delivery is at least once and source detection may be delayed. Build success or an Enabled configuration alone does not verify real-event delivery.

Run `azd down --purge` from this folder when finished to remove this environment's deployed resources.

## More

- [Azure DevOps connector reference](https://learn.microsoft.com/connectors/visualstudioteamservices/)
- [Poll configuration contract](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery)
- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
