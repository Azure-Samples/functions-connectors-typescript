# Azure Functions Connector Samples (TypeScript)

TypeScript samples for the [Azure Functions Connector Samples](https://github.com/Azure-Samples/functions-connectors/) repo, using [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) to receive events from Microsoft 365, SharePoint, Teams, and other connectors.

> Azure Functions connectors and the packages used here are in preview.

## Samples

| Folder | Connector | Triggers |
| ------ | --------- | -------- |
| [azureblobApp](azureblobApp/) | [Azure Blob Storage](https://learn.microsoft.com/connectors/azureblob/) | Blob added or modified, using the generic API; separate polling/webhook apps |
| [dataflowsApp](dataflowsApp/) | [Dataflows](https://learn.microsoft.com/connectors/dataflows/) | Refresh completed |
| [dataverseApp](dataverseApp/) | [Microsoft Dataverse](https://learn.microsoft.com/connectors/commondataservice/) | Separate polling/webhook apps: row changes, optional action-performed and separate row events |
| [genericApp](genericApp/) | Any connector | Generic `connectorTrigger<TItem>` examples with custom item types; opt-in single-event polling |
| [office365App](office365App/) | [Office 365 Outlook](https://learn.microsoft.com/connectors/office365/) | New, flagged, mentioning-you, and shared mailbox emails; new, updated, changed, and upcoming calendar events; opt-in batched email polling |
| [onedriveApp](onedriveApp/) | [OneDrive for Business](https://learn.microsoft.com/connectors/onedriveforbusiness/) | New and updated file content and metadata; separate polling/webhook apps |
| [plannerApp](plannerApp/) | [Planner](https://learn.microsoft.com/connectors/planner/) | New, completed, and assigned-to-me tasks |
| [salesforceApp](salesforceApp/) | [Salesforce](https://learn.microsoft.com/connectors/salesforce/) | New and updated records |
| [sharepointApp](sharepointApp/) | [SharePoint Online](https://learn.microsoft.com/connectors/sharepointonline/) | File metadata, file properties, list items, deletions, forms, classification changes, and recurring digests; opt-in polling |
| [teamsApp](teamsApp/) | [Microsoft Teams](https://learn.microsoft.com/connectors/teams/) | Channel/chat messages, mentions, reactions, keywords, recordings, transcripts, and team membership changes; opt-in polling |
| [vstsApp](vstsApp/) | [Azure DevOps](https://learn.microsoft.com/connectors/visualstudioteamservices/) | Builds, pull requests, pushes, TFVC check-ins, and work item changes |

The twelve apps contain 59 webhook and 33 polling sample functions when all opt-ins are enabled. The trigger samples cover **39 typed registrations in eight namespaces** exported by `@azure/functions-extensions-connectors@0.2.0-preview`, plus generic and raw event examples. The samples omit two deprecated SharePoint file helpers, one duplicate Office 365 calendar alias, and the Kusto callback helper because Kusto has actions rather than connector triggers.

Each app has its own dependencies, `azure.yaml`, host configuration, and source code. The five original connector-specific apps configure webhook connections and triggers through deployment hooks; additional Office 365 and SharePoint subscriptions require the optional settings documented in their READMEs. SharePoint requires its site URL before provisioning and enables five create/update subscriptions by default. Additional Teams webhook inputs are collected interactively after connector OAuth consent. `genericApp`, Dataflows, Planner, Salesforce, Azure DevOps, and both Dataverse apps use [manual connector setup](#manual-connector-setup). These additional apps reuse [genericApp's deployment module](genericApp/infra/main.bicep), so keep the full repository checkout when deploying them. All Poll trigger configurations are created manually.

Use test accounts: these examples log event metadata, including dynamic record fields. Review logging before using production data.

## Package versions and API changes

All apps use:

```json
{
  "@azure/connectors": "0.4.0-preview",
  "@azure/functions": "^4.17.1",
  "@azure/functions-extensions-connectors": "0.2.0-preview"
}
```

The connector extension requires **Node.js 24+**. Package engines, Node.js type definitions, and the deployment templates use Node.js 24.

Functions `4.17.1` exports the `DeliveryMode` and `Cardinality` enums. Polling samples use `DeliveryMode.Poll`; the batched Outlook sample explicitly selects `Cardinality.Many`. Single-event examples omit cardinality and rely on its `Cardinality.One` default. Webhook examples also omit delivery mode, which defaults to `DeliveryMode.Webhook`.

The SDK version is upgraded alongside the extension because `0.2.0-preview` requires `@azure/connectors@^0.4.0-preview`. If your registry does not yet expose these releases, use the [local tarball installation instructions](tests/README.md#registry-and-lockfile-failures).

The `name` in each `azure.yaml` is a lowercase project slug, as required by the azd schema. Folder names and retained Function names are unchanged.

Each app's `.funcignore` keeps local settings, azd state, editor files, Azurite data, and build-time source/infrastructure out of deployment packages. Compiled functions and installed runtime dependencies remain included.

Retained registered function names remain unchanged, but some helper names changed:

- Office 365 uses `onNewEmailMentioningMe` and `onUpcomingEvents`.
- Teams uses `onTeamMemberAdded` / `onTeamMemberRemoved` with `TeamMemberTriggerContext`.
- OneDrive uses `connectors.onedriveforbusiness.onNewFiles` / `onUpdatedFiles` for metadata operations `OnNewFilesV2` / `OnUpdatedFilesV2`. Separate raw `app.connectorTrigger` handlers cover the singular file-content operations `OnNewFileV2` / `OnUpdatedFileV2`.
- Azure Blob has no first-class helper or metadata re-export in this release. Both Blob examples use `connectorTrigger<AzureBlobMetadata>`, importing the metadata type from `@azure/connectors/generated/AzureblobExtensions`.
- `office365.onCalendarNewItems` is an alias for `onNewCalendarEvent`. Only `onCalendarNewItems` has an example and subscription, avoiding duplicate delivery for the same calendar operation.

## Polling samples

Polling examples live in separate files; existing webhook handlers and deployment hooks are unchanged:

| App | Sample | Invocation mode |
| --- | ------ | --------------- |
| [office365App](office365App/) | [OnNewEmailPoll](office365App/src/functions/onNewEmailPoll.ts) | Typed helper; up to four Poll events per invocation |
| [genericApp](genericApp/) | [OnGenericOffice365NewEmailPoll](genericApp/src/functions/onGenericOffice365NewEmailPoll.ts) | Generic API; one Poll event per invocation, up to four concurrent calls |
| [azureblobApp/polling](azureblobApp/polling/README.md) | [Blob polling](azureblobApp/polling/src/functions/onAzureBlobPoll.ts) | One generic metadata handler |
| [onedriveApp/polling](onedriveApp/polling/README.md) | [OneDrive polling](onedriveApp/polling/src/functions/onOneDrivePoll.ts) | Two typed metadata and two opaque-content handlers |
| [sharepointApp](sharepointApp/README.md#polling) | [SharePoint polling](sharepointApp/src/functions/onSharepointPoll.ts) | All ten non-deprecated operations |
| [teamsApp](teamsApp/README.md#polling) | [Teams polling](teamsApp/src/functions/onTeamsPoll.ts) | Four typed and seven raw event handlers |
| [dataverseApp/polling](dataverseApp/polling/) | [Dataverse polling](dataverseApp/polling/src/functions/dataverseTriggers.ts) | Five raw events; combined row changes enabled by default |

The Office 365 and generic examples both use Outlook's `OnNewEmailV3` operation. Other connectors use the operations and source parameters in their app READMEs. Choose one receiving function per Poll Trigger Config; listeners sharing a configuration compete for events. A Poll event can itself contain several items, independently of invocation cardinality.

Blob uses an independent [Poll app](azureblobApp/polling/README.md) with automatic namespace, managed-identity connection, monitored storage/container, and Poll trigger setup during `azd up`. It does not require `EnablePollingSamples` or the manual setup below. Its [webhook app](azureblobApp/webhook/README.md) deploys separately.

OneDrive also has independent [polling](onedriveApp/polling/README.md) and [webhook](onedriveApp/webhook/README.md) apps. Its polling `azd up` provisions the namespace/connection, guides OAuth consent and folder selection, and configures Poll triggers and app settings automatically. It does not require `EnablePollingSamples` or the manual setup below.

1. Create an authorized connection and an enabled Trigger Config with service `deliveryMode: "Poll"`, **without** webhook `notificationDetails`. Follow the extension's [Poll configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery) for the ARM request and access policies. Authorize both the namespace identity that runs the connector trigger and the Function/developer identity that receives Poll events. Existing deployment hooks create webhook subscriptions only.
2. For Office 365 or the generic example, merge these entries into the chosen app's `local.settings.json` `Values` object:

   ```json
   {
     "EnablePollingSamples": "true",
     "ConnectorNamespace__pollingEndpoint": "https://<connector-namespace-host>",
     "OnNewEmailPollTriggerConfigName": "<poll-trigger-config-name>"
   }
   ```

   For SharePoint and Teams, merge the app's linked `docs/polling.settings.example.json` instead. Each function uses a `<FunctionName>TriggerConfigName` setting; the generic Outlook example deliberately shares `OnNewEmailPollTriggerConfigName`. Create a separate config for each enabled function, preserving existing webhook configurations. The SharePoint and Teams examples keep optional listeners disabled using `AzureWebJobs.<FunctionName>.Disabled`; configure their sources before setting those values to `"false"`. Retain config-name settings even for disabled listeners so binding expressions remain resolvable.

   `ConnectorNamespace` is a configuration prefix, not a connector connection resource name. Derive its endpoint from the Trigger Config's service-generated `pollingEndpoints.receiveUri`: remove `/triggerconfigs/<name>/receive` and the query string, preserving any `/api/connectorGateways/<id>` prefix. For stable namespace DNS, use only `https://<connector-namespace-host>`, with no `/api` suffix. Never commit real endpoints or credentials.
3. Use a host Connector extension that supports Poll delivery, sign in with `az login`, start Azurite if needed, and run `npm start` from the chosen app. No public callback URL or tunnel is required. Preview bundles can lag the current extension source; verify the selected bundle's contents using the [host extension guidance](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#non-net-workers).

For Azure, add the same settings to the Function App and set `ConnectorNamespace__credential=managedidentity`; grant its managed identity access to the connection. Restart the host after changing settings.

The four mixed-delivery apps do not register polling samples unless `EnablePollingSamples` is exactly `true`, so existing deployments do not require new connection settings. Blob, OneDrive, and Dataverse have dedicated Poll apps instead; use their mode-specific setup and settings templates. Dataverse also has optional-event flags.

Typed/generic handlers receive flattened, ordered items; `context.rawPayload` retains the complete parsed envelope array and metadata. Raw Dataverse, OneDrive content, and additional Teams Poll handlers bypass normalization and preserve the original input, including strings and binary payloads. The four newly added connector polling examples log receipt/count only, not event contents. `maxConcurrentCalls` is used only by the generic Outlook single-event example, not the batched example.

For manual ARM request bodies and connection access policies, use the [Poll configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery); the [Dataverse Poll guide](dataverseApp/polling/README.md#configure) includes a complete example. Use the selected connector/operation/parameters for other apps. Poll configurations must not contain webhook `notificationDetails`. An Enabled config is not proof of successful source registration: inspect its latest source status, generate a test event, and check function logs. No public Function callback, connector extension key, or local tunnel is required.

## More triggers and operations

See the [Operations to Azure Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md) for connector trigger signatures. The [Azure Connectors Node.js SDK](https://github.com/Azure/Connectors-NodeJS-SDK) provides typed action clients and exported `<Connector>TriggerOperations` / `<Connector>TriggerParameters` metadata. Use that metadata from the pinned `0.4.0-preview` SDK for exact operation IDs, required parameters, and dynamic-value pickers; helper names are not always remote operation IDs.

## Manual connector setup

Deployment of `genericApp`, Dataflows, Planner, Salesforce, Azure DevOps, and both Dataverse apps provisions a Function App, host storage, Application Insights, and Log Analytics. It does **not** create a Connector Namespace, connections, OAuth consent, or subscriptions. Reapply manual Function App settings after reprovisioning; the shared template writes its own app-settings collection.

For webhook delivery in Dataflows, Planner, Salesforce, Azure DevOps, and Dataverse (use the [Poll setup](#polling-samples) for polling):

1. Deploy the chosen app, using its README and a unique azd environment.
2. Create a namespace in a supported region and a connection using the connector ID in that app's README:

   ```sh
   az connector-namespace create -g "<resource-group>" -n "<namespace>" -l "brazilsouth" --system-assigned
   az connector-namespace connection create -g "<resource-group>" --namespace "<namespace>" -n "<connection>" --connector-name "<connector-id>"
   ```

3. Configure the connector's authentication. For OAuth connections, follow the consent-link and status-polling examples in the [Teams deployment hook](teamsApp/infra/scripts/postdeploy.ps1). Do not create triggers until the connection is `Connected`. Configure connection access policies for the operator and any identity calling connector actions; the [namespace policy template](teamsApp/infra/connectorNamespace.bicep) shows the resource shape.
4. Select the operation and actual parameter values from the app's table and the SDK metadata. Retrieve the Function App's `connector_extension` system key with `az functionapp keys list`, without logging or committing it.
5. Prepare the following JSON argument files **outside the repository**, protecting the notification file because it contains the real key. This example targets Planner's new-task sample:

   Connection details:

   ```json
   { "connectorName": "planner", "connectionName": "<connection>" }
   ```

   Parameters:

   ```json
   [
     { "name": "groupId", "value": "<group-id>" },
     { "name": "id", "value": "<plan-id>" }
   ]
   ```

   Notification details:

   ```json
   {
     "callbackUrl": "https://<functions-host>/runtime/webhooks/connector?functionName=OnPlannerNewTask",
     "httpMethod": "Post",
     "authentication": {
       "type": "QueryString",
       "name": "code",
       "value": "<connector_extension-system-key>"
     }
   }
   ```

6. From the directory containing those protected files, create the subscription:

   ```sh
   az connector-namespace trigger create -g "<resource-group>" --namespace "<namespace>" -n "<trigger-name>" --connection-details "@connection-details.json" --operation-name "OnNewTask_V3" --parameters "@parameters.json" --notification-details "@notification-details.json" --state Enabled
   ```

   Substitute the correct connector, function name, operation ID, and parameters for other examples. Keep the key in `notificationDetails.authentication`, not the callback URL. Remove temporary argument files after configuration.

7. Verify the connection is `Connected` and the trigger is `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Generate a test event and inspect Function App logs.

## Tests

Run `npm ci` and `npm test` from a sample directory to build its TypeScript source and run the offline smoke tests. See [tests/README.md](tests/README.md) for all-twelve-app coverage and the offline deployment-configuration tests.

## Prerequisites

- An Azure subscription with permission to provision resources and configure access policies.
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) and [Azure CLI (`az`)](https://learn.microsoft.com/cli/azure/install-azure-cli).
- [Node.js](https://nodejs.org/) 24+ and npm, with a trusted registry that resolves all three requested releases.
- [`connector-namespace` Azure CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli).
- PowerShell 7+ (`pwsh`) on Windows, or Bash and `jq` on macOS/Linux, for deployment hooks.
- For local development: [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) v4 and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) when using `UseDevelopmentStorage=true`.

The connector-specific templates default the Connector Namespace location to `brazilsouth`. To use another supported region, set `CONNECTOR_NAMESPACE_LOCATION` on the azd environment before provisioning.

## Related repos

- [Azure Functions Connector Extension](https://github.com/Azure/azure-functions-connector-extension) - Connector trigger binding and operation mappings.
- [Azure Functions Node.js Extensions](https://github.com/Azure/azure-functions-nodejs-extensions) - Source for `@azure/functions-extensions-connectors`.
- [Azure Connectors Node.js SDK](https://github.com/Azure/Connectors-NodeJS-SDK) - Typed clients and connector models.
- [.NET samples](https://github.com/Azure-Samples/functions-connectors-net) and [Python samples](https://github.com/Azure-Samples/functions-connectors-python).