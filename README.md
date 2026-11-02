# Azure Functions Connector Samples (TypeScript)

TypeScript samples for the [Azure Functions Connector Samples](https://github.com/Azure-Samples/functions-connectors/) repo, using [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) to receive events from Microsoft 365, SharePoint, Teams, and other connectors.

> Azure Functions connectors and the packages used here are in preview.

## Samples

| Folder | Connector | Triggers |
| ------ | --------- | -------- |
| [azureblobApp](azureblobApp/) | [Azure Blob Storage](https://learn.microsoft.com/connectors/azureblob/) | Blob added or modified, using the generic API |
| [dataflowsApp](dataflowsApp/) | [Dataflows](https://learn.microsoft.com/connectors/dataflows/) | Refresh completed |
| [genericApp](genericApp/) | Any connector | Generic `connectorTrigger<TItem>` examples with custom item types |
| [kustoApp](kustoApp/) | [Azure Data Explorer](https://learn.microsoft.com/connectors/kusto/) | Typed query-result callback helper; no SDK trigger operation |
| [office365App](office365App/) | [Office 365 Outlook](https://learn.microsoft.com/connectors/office365/) | New, flagged, mentioning-you, and shared mailbox emails; new, updated, changed, and upcoming calendar events |
| [onedriveApp](onedriveApp/) | [OneDrive for Business](https://learn.microsoft.com/connectors/onedriveforbusiness/) | New and updated file metadata |
| [plannerApp](plannerApp/) | [Planner](https://learn.microsoft.com/connectors/planner/) | New, completed, and assigned-to-me tasks |
| [salesforceApp](salesforceApp/) | [Salesforce](https://learn.microsoft.com/connectors/salesforce/) | New and updated records |
| [sharepointApp](sharepointApp/) | [SharePoint Online](https://learn.microsoft.com/connectors/sharepointonline/) | File metadata, file properties, list items, deletions, forms, classification changes, and recurring digests |
| [teamsApp](teamsApp/) | [Microsoft Teams](https://learn.microsoft.com/connectors/teams/) | Channel messages, mentions, and team membership changes |
| [vstsApp](vstsApp/) | [Azure DevOps](https://learn.microsoft.com/connectors/visualstudioteamservices/) | Builds, pull requests, pushes, TFVC check-ins, and work item changes |

The eleven apps contain 49 sample functions, covering all **43 typed registrations in nine namespaces** exported by `@azure/functions-extensions-connectors@0.1.0-preview`, plus six generic examples. The count includes the calendar-new-items alias and the Kusto query-result helper, not 43 distinct remote operations.

Each folder has its own dependencies, `azure.yaml`, host configuration, and source code. The five original connector-specific apps configure connections and triggers through deployment hooks; additional Office 365 and SharePoint subscriptions require the optional settings documented in their READMEs. `genericApp` and the five new apps use [manual connector setup](#manual-connector-setup). The new apps reuse [genericApp's deployment module](genericApp/infra/main.bicep), so keep the full repository checkout when deploying them.

Use test accounts: these examples log event metadata, including dynamic record fields. Review logging before using production data.

## Package versions and API changes

All apps use:

```json
{
  "@azure/connectors": "0.3.1-preview",
  "@azure/functions": "^4.17.0",
  "@azure/functions-extensions-connectors": "0.1.0-preview"
}
```

The connector extension requires **Node.js 24+**. Package engines, Node.js type definitions, and the deployment templates use Node.js 24.

The `name` in each `azure.yaml` is a lowercase project slug, as required by the azd schema. Folder names and registered Function names are unchanged.

Each app's `.funcignore` keeps local settings, azd state, editor files, Azurite data, and build-time source/infrastructure out of deployment packages. Compiled functions and installed runtime dependencies remain included.

Existing registered function names remain unchanged, but some helper names changed:

- Office 365 uses `onNewEmailMentioningMe` and `onUpcomingEvents`.
- Teams uses `onTeamMemberAdded` / `onTeamMemberRemoved` with `TeamMemberTriggerContext`.
- OneDrive uses `connectors.onedriveforbusiness.onNewFiles` / `onUpdatedFiles`, with metadata operations `OnNewFilesV2` / `OnUpdatedFilesV2`, not the similarly named file-content operations.
- Azure Blob has no first-class helper or metadata re-export in this release. Both Blob examples use `connectorTrigger<AzureBlobMetadata>`, importing the metadata type from `@azure/connectors/generated/AzureblobExtensions`.
- `office365.onCalendarNewItems` is an alias for `onNewCalendarEvent`. Both have examples; choose one subscription for that event in a production app.

## More triggers and operations

See the [Operations to Azure Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md) for connector trigger signatures. The [Azure Connectors Node.js SDK](https://github.com/Azure/Connectors-NodeJS-SDK) provides typed action clients and exported `<Connector>TriggerOperations` / `<Connector>TriggerParameters` metadata. Use that metadata from the pinned [`0.3.1-preview` release](https://www.npmjs.com/package/@azure/connectors/v/0.3.1-preview) for exact operation IDs, required parameters, and dynamic-value pickers; helper names are not always remote operation IDs.

## Manual connector setup

Deployment of `genericApp`, Dataflows, Kusto, Planner, Salesforce, and Azure DevOps provisions a Function App, host storage, Application Insights, and Log Analytics. It does **not** create a Connector Namespace, connections, OAuth consent, or subscriptions.

For Dataflows, Planner, Salesforce, and Azure DevOps:

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

Kusto is different: this SDK exports no Kusto trigger-operation metadata. See [kustoApp](kustoApp/README.md) for the typed callback helper and the requirement for a separately configured query-result delivery workflow. Do not invent an `OnQueryResult` connector operation.

## Tests

Run `npm ci` and `npm test` from a sample directory to build its TypeScript source and run the offline smoke tests. See [tests/README.md](tests/README.md) for all-eleven-app coverage and the offline deployment-configuration tests.

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