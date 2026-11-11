# Azure DevOps (VSTS) Connector Sample

Azure Functions app covering all nine `connectors.vsts` helpers. The remote connector ID is `visualstudioteamservices`, not `vsts`.

| Function | Helper | Connector operation |
| -------- | ------ | ------------------- |
| [OnVstsBuildCompleted](src/functions/onVstsBuildCompleted.ts) | `onBuildCompleted` | `OnBuildCompleted` |
| [OnVstsGitPullClosed](src/functions/onVstsGitPullClosed.ts) | `onGitPullClosed` | `OnGitPullClosed` |
| [OnVstsGitPullCreated](src/functions/onVstsGitPullCreated.ts) | `onGitPullCreated` | `OnGitPullCreated` |
| [OnVstsGitPush](src/functions/onVstsGitPush.ts) | `onGitPush` | `OnGitPush` |
| [OnVstsTfvcCheckIn](src/functions/onVstsTfvcCheckIn.ts) | `onTfvcCheckIn` | `OnTfvcCheckIn` |
| [OnVstsWorkItemAssigned](src/functions/onVstsWorkItemAssigned.ts) | `onWorkItemAssigned` | `OnWorkItemAssignedV2` |
| [OnVstsWorkItemClosed](src/functions/onVstsWorkItemClosed.ts) | `onWorkItemClosed` | `OnWorkItemClosedV2` |
| [OnVstsWorkItemCreated](src/functions/onVstsWorkItemCreated.ts) | `onWorkItemCreated` | `OnWorkItemCreatedV2` |
| [OnVstsWorkItemUpdated](src/functions/onVstsWorkItemUpdated.ts) | `onWorkItemUpdated` | `OnWorkItemUpdatedV2` |

Handlers use the named typed collections `builds`, `pullRequests`, `pushes`, `changesets`, and `workItems`, and preserve the original callback payload. Work item fields remain `Record<string, unknown>` rather than a fabricated project schema.

## Prerequisites and local development

Follow the [shared prerequisites](../../README.md#prerequisites), including Node.js 24+. Live events require a test Azure DevOps organization/project and an account authorized for the selected build, repository, team, or work items. TFVC examples require a TFVC project.

From this folder:

```sh
npm ci
npm test
npm start
```

For local-only setup, run `npm run setup:local`, then configure `local.settings.json` without committing credentials, and run Azurite for development storage. Deployment setup creates a populated local settings file automatically if none exists; existing files are never overwritten. Local callbacks require reachable HTTPS and separately configured subscriptions. Deployed subscriptions target the Azure Function App, not your local host.

## Deploy and configure

The self-contained [infra/main.bicep](infra/main.bicep) template provisions a Node.js 24 Flex Consumption Function App, host/deployment storage, monitoring, a Connector Namespace, an Azure DevOps connection using **Microsoft Entra ID OAuth** (`EntraOAuth`), and connection access policies for the Function App identity and deploying user. It does not import Generic's infrastructure. The namespace defaults to the supported preview region `brazilsouth`; the Function App uses your selected Azure region.

```sh
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-webhook-environment>
azd up
```

Run these commands from this folder. Packaging, provisioning, and deployment run sequentially so the deployment progress display finishes before interactive postdeploy setup. Running `azd deploy` directly uses the same setup hook.

The hook uses `az connector-namespace connection authenticate` when needed. This requires a version of the `connector-namespace` extension with that command; if it is unavailable, update the extension with `az extension update --name connector-namespace`. Authentication opens a local sign-in page in your normal browser. Click **Continue**, complete consent, and keep the terminal open. The CLI captures the callback, confirms the returned consent code, and checks that the connection becomes `Connected`; it does not merely redirect to Azure Portal and poll. No incognito/private browser session is required, and existing access policies are preserved.

You then choose which of the nine triggers to configure. Setup asks only for required selectors using authenticated pickers: for example, **Organization Name**, **Project Name**, and, for Git events, **Repository Name**. Assigned-work-item events also require a team and member. Optional filters, including build result/definition, branches, work item type, and area/iteration paths, remain unset so the connector uses its defaults; setup does not prompt for them or call their pickers. TFVC events require a TFVC project.

All Azure operations target the provisioned subscription explicitly. Browser authentication is separate: [Azure DevOps user connections only list organizations in the signed-in account's home tenant](https://learn.microsoft.com/connectors/visualstudioteamservices/#known-issues-and-limitations). Changing the Azure Portal directory does not change the connector's account or organizations. Use an account belonging to the Azure DevOps organization's tenant; that tenant need not match the Azure resources' tenant. The hook does not force the resource tenant into the consent request.

The Azure resources and app are already deployed when authentication starts. CLI instructions and errors appear directly in the terminal. If consent fails or times out, run `azd hooks run postdeploy` from this folder to retry without redeploying. Landing on Azure Portal alone does not confirm success; the CLI must complete consent and the connection must report `Connected`. Follow company browser policies; if sign-in or the local callback is blocked, retain the displayed error for your administrator rather than disabling policy controls.

Older versions created the default legacy Azure DevOps OAuth connection. A token-exchange error saying issuance is disabled requires migration, not another directory switch or consent retry. [This preview API selects the authentication scheme only when creating a connection](https://github.com/Azure/azure-functions-skills/blob/main/templates/skills/azure-functions-hosted-skills/references/connectors.md#connection-authentication-schemes): rerunning `azd provision` alone cannot migrate an existing legacy connection. It must be recreated with the updated template after checking existing subscriptions. Restore its access policies and refresh both the app's `VstsConnection` setting and the azd environment's `vstsConnectionRuntimeUrl` if the runtime URL changes, then run `azd hooks run postdeploy` to authenticate. Setup refuses a legacy connection before opening the browser and never deletes connections automatically. No private browser session or relaxation of company policy is needed.

Empty required pickers skip the affected trigger. Failed or malformed required lookups stop setup rather than guessing organization/project identifiers. At least one trigger must be configured.

The hook creates enabled webhook trigger configurations with each function's exact operation ID and authenticated connector callback. No manual namespace, connection, policy, or trigger creation is needed. It saves selections as `VSTS_WEBHOOK_TRIGGER_INPUTS` in this project's azd environment and reuses them on redeployment without replacing unchanged subscriptions. Existing saved optional filters are preserved; to choose new required-only inputs, run `azd env set VSTS_WEBHOOK_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Skipped owned subscriptions are disabled without losing their selectors; Poll sources and other apps' subscriptions are never overwritten. Listener settings use `AzureWebJobs.<FunctionName>.Disabled`.

## Verify

Confirm the connection is `Connected`, the desired subscriptions are `Enabled`, and source registration succeeded in [Connector Namespaces](https://connectors.azure.com/). Generate the corresponding test event and inspect Function App logs. `npm test` builds the app and runs offline tests for all nine typed wrappers and the automatic deployment setup. These tests do not replace live checks of repository permissions or organization-specific work item rules.
