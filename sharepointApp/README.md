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

## Deploy to Azure

Run from `sharepointApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Enter the SharePoint site address when prompted, and complete OAuth consent in your browser. Subscriptions are enabled by the settings below; configure at least a list or library ID to create triggers.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and SharePoint Online connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook saves your selection as `SHAREPOINT_SITE_ADDRESS` on the azd environment. To skip this prompt, set it in advance:

```sh
azd env set SHAREPOINT_SITE_ADDRESS "https://contoso.sharepoint.com/sites/MySite"
```

Enable examples with connector-specific identifiers from that site:

| azd setting | Subscriptions |
| ----------- | ------------------------ |
| `SHAREPOINT_LIST_ID` | Changed, deleted, new, and updated list items |
| `SHAREPOINT_LIBRARY_ID` | Deleted files, new and updated file properties, and classification changes |
| `SHAREPOINT_FORM_ID`, together with `SHAREPOINT_LIST_ID` | Items submitted through the selected list form |
| `SHAREPOINT_DIGEST_SCHEDULE`, together with `SHAREPOINT_LIST_ID` | Recurring digest, with both `add` and `update` enabled |

`SHAREPOINT_LIST_ID` / `SHAREPOINT_LIBRARY_ID` supply the SDK's required `table` parameter. They are not folder IDs; file-property subscriptions cover the configured library. Choose a valid `form` value from the connector's form picker and a valid `runSchedule` value from its `GetDayOfWeekOptions` dynamic-value operation. The hook does not invent defaults for either.

For example:

```sh
azd env set SHAREPOINT_LIST_ID "your-list-id"
azd env set SHAREPOINT_LIBRARY_ID "your-library-id"
azd env set SHAREPOINT_FORM_ID "your-form-id"
azd env set SHAREPOINT_DIGEST_SCHEDULE "value-from-GetDayOfWeekOptions"
```

Missing optional settings produce explicit warnings and skip those subscriptions, not their registered handlers. These settings do not skip any required OAuth consent. To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one SharePoint Online connection in `Connected` state and up to ten triggers in `Enabled` state, depending on the settings. Without a list or library ID, no triggers are created.

Create, modify, or delete a test file or list item, submit the configured form, or wait for the digest schedule, then inspect Function App logs. If the connection is unauthenticated or expected subscriptions are missing, check the optional settings, rerun the hook, and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [SharePoint Online connector operations](https://learn.microsoft.com/connectors/sharepointonline/)
- [All TypeScript samples](../README.md#samples)
