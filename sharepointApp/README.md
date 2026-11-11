# SharePoint Online Connector Sample

Azure Functions app demonstrating typed SharePoint Online triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Helper under `connectors.sharepoint` | Connector operation |
| -------- | ----------------------------------- | ------------------- |
| [OnSharepointChangedItems](src/functions/onSharepointChangedItems.ts) | `onChangedItems` | `GetOnChangedItems` |
| [OnSharepointDeletedFileItems](src/functions/onSharepointDeletedFileItems.ts) | `onDeletedFileItems` | `GetOnDeletedFileItems` |
| [OnSharepointDeletedItems](src/functions/onSharepointDeletedItems.ts) | `onDeletedItems` | `GetOnDeletedItems` |
| [OnSharepointNewFileItems](src/functions/onSharepointNewFileItems.ts) | `onNewFileItems` | `GetOnNewFileItems` |
| [OnSharepointNewItems](src/functions/onSharepointNewItems.ts) | `onNewItems` | `GetOnNewItems` |
| [OnSharepointNewItemsFromForm](src/functions/onSharepointNewItemsFromForm.ts) | `onNewItemsFromForm` | `GetOnNewItemsFromForm` |
| [OnSharepointRecurrenceDigest](src/functions/onSharepointRecurrenceDigest.ts) | `onRecurrenceDigest` | `GetOnRecurrenceDigest` |
| [OnSharepointUpdatedFileClassifiedTimes](src/functions/onSharepointUpdatedFileClassifiedTimes.ts) | `onUpdatedFileClassifiedTimes` | `GetOnUpdatedFileClassifiedTimes` |
| [OnSharepointUpdatedFileItems](src/functions/onSharepointUpdatedFileItems.ts) | `onUpdatedFileItems` | `GetOnUpdatedFileItems` |
| [OnSharepointUpdatedItems](src/functions/onSharepointUpdatedItems.ts) | `onUpdatedItems` | `GetOnUpdatedItems` |

All ten non-deprecated helpers have examples. List items, file properties, classification changes, form submissions, and digests use `SharepointItemTriggerContext.records`. Whole-record JSON logging preserves the SDK's `dynamicProperties` and raw callback fields without inventing a list schema. Deletions use `DeletedItemTriggerContext.deletedItems` with fields such as `ID`, `Name`, and `TimeDeleted`.

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need a SharePoint Online account with access to the site and document library, and permission to consent to the connector.

Set the SharePoint site URL before deployment, as in the [.NET sample](https://github.com/Azure-Samples/functions-connectors-net/tree/main/sharepointApp). It is a required infrastructure parameter, so any missing-value prompt happens during provisioning setup, not inside the postdeployment hook. No Microsoft Graph site discovery is used. Connector OAuth consent is still required.

## Deploy to Azure

Run from `sharepointApp`:

```sh
az login
azd auth login
azd env new my-sharepoint-node
azd env set SHAREPOINT_SITE_URL "https://contoso.sharepoint.com/sites/MySite"
azd up
```

Use a unique environment for a new deployment; omit `azd env new` when reusing an existing environment. Supply the site root, not a document-library path or sharing link.

The deployment builds the TypeScript app and then runs the interactive [postdeploy hook](azure.yaml). There is no site-input prompt in that hook. Complete OAuth consent in the browser when it opens; an already `Connected` connection skips consent. By default, five create/update subscriptions monitor the `Documents` library: new/updated files, new/updated items, and modified-only items.

With azd 1.30, the deployment progress table can remain active during post hooks and overwrite their status output, even with `interactive: true`. If consent output is hidden, cancel with Ctrl+C and run the setup script directly from `sharepointApp`:

```sh
bash ./infra/scripts/postdeploy.sh
```

On Windows, run `pwsh -File ./infra/scripts/postdeploy.ps1` instead. This bypasses azd's progress renderer and reuses the provisioned resources; it does not redeploy the app.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and SharePoint Online connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

Configure these values with `azd env set <setting> <value>` before `azd up`:

| azd setting | Default / purpose |
| ----------- | ----------------- |
| `SHAREPOINT_SITE_URL` | Required site-root URL, e.g. `https://contoso.sharepoint.com/sites/MySite` |
| `SHAREPOINT_LIBRARY_NAME` | `Documents`; document-library name or GUID |
| `SHAREPOINT_LIST_NAME` | Empty uses the library; otherwise a list name or GUID for item/form triggers |
| `SHAREPOINT_FOLDER_PATH` | Empty monitors the library; optional file/digest filter, not an item/form filter |
| `SHAREPOINT_ENABLE_DELETION_TRIGGERS` | `false`; enables item/file deletion, requiring the connection user to be a site collection administrator |
| `SHAREPOINT_ENABLE_SYNTEX_TRIGGER` | `false`; enables classification after a licensed Syntex model is applied to the library |
| `SHAREPOINT_FORM_ID` | Empty disables submissions; set an existing supported form ID on the selected list/library |
| `SHAREPOINT_DIGEST_SCHEDULE` | Empty disables the library digest; `*` means daily, or `0` through `6` selects a day of the week |

Library/list names or GUIDs supply the SDK's required `table` parameter; they are not folder IDs. Use the actual library name or GUID if the site's library is not named `Documents`. The digest includes both new and updated files.

For example:

```sh
azd env set SHAREPOINT_LIBRARY_NAME "Documents"
azd env set SHAREPOINT_LIST_NAME "Tasks"
azd env set SHAREPOINT_ENABLE_DELETION_TRIGGERS true
azd env set SHAREPOINT_FORM_ID "your-form-id"
azd env set SHAREPOINT_DIGEST_SCHEDULE "*"
azd up
```

Deletion, classification, forms, and digest functions are disabled in Azure unless selected. Reset flags to `false` or clear the form ID/schedule and rerun `azd up` to disable those functions and any existing matching trigger configurations. Selected registrations are created or updated in place, not deleted and recreated.

The hook consumes provisioned configuration. After changing these settings, rerun `azd up`, or `azd provision` followed by the hook. After a standalone `azd deploy`, or to repeat setup with the existing provisioned configuration:

```sh
azd hooks run postdeploy
```

## Polling

[The polling examples](src/functions/onSharepointPoll.ts) cover all ten non-deprecated operations in the table above. Each Poll function adds `Poll` to its webhook function name, for example `OnSharepointNewItemsPoll`; its setting is `OnSharepointNewItemsPollTriggerConfigName`. The operation ID and source parameters are unchanged.

Follow the [shared Poll setup](../README.md#polling-samples). Create separate enabled Poll configs with connector ID `sharepointonline`, the same site-root `dataset`, and the actual library/list `table`. File/digest sources may use `folderPath`; item/form sources do not. Form submissions require `form`; recurring digests require `add=true`, `update=true`, and `runSchedule`. Use the SDK metadata for exact required parameters. Do not convert existing webhook configs.

Merge [polling.settings.example.json](docs/polling.settings.example.json) into local settings `Values`, replacing the endpoint and config names. It registers polling only when `EnablePollingSamples` is exactly `"true"` and leaves the five optional deletion, form, classification, and digest listeners disabled through `AzureWebJobs.<FunctionName>.Disabled`. Create each optional source with the permissions/inputs described above before changing its disabled setting to `"false"`. Retain the config-name settings even for disabled listeners.

For Azure, apply the same settings plus `ConnectorNamespace__credential=managedidentity`. Existing `SHAREPOINT_*` deployment options and hooks control webhook functions only, not these separate Poll listeners. Polling needs no public callback, connector extension key, or tunnel. These handlers log only receipt and item count, not list/file contents. Verify source registration, then generate an event in the selected list/library.

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one SharePoint Online connection in `Connected` state and five default triggers in `Enabled` state, or up to ten with all optional settings selected.

Create, modify, or delete a test file or list item, submit the configured form, or wait for the digest schedule, then inspect Function App logs. If the connection is unauthenticated or expected subscriptions are missing, check the optional settings, rerun the hook, and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

Local settings are not generated by this hook. Match the `AzureWebJobs.<FunctionName>.Disabled` flags to your optional-trigger selection when running locally.

## More

- [SharePoint Online connector operations](https://learn.microsoft.com/connectors/sharepointonline/)
- [All TypeScript samples](../README.md#samples)
