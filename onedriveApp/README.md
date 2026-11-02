# OneDrive for Business Connector Sample

Azure Functions app demonstrating both typed OneDrive for Business metadata triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| [OnOneDriveNewFile](src/functions/onOneDriveNewFile.ts) | `OnNewFilesV2` | New file metadata in the configured folder |
| [OnOneDriveUpdatedFile](src/functions/onOneDriveUpdatedFile.ts) | `OnUpdatedFilesV2` | Updated file metadata in the configured folder |

The helpers are `connectors.onedriveforbusiness.onNewFiles` and `onUpdatedFiles`, with `OneDriveFileTriggerContext`. The singular `OnNewFileV2` / `OnUpdatedFileV2` operations return file content and must not be substituted for these metadata batches.

The namespace now provisions the `onedriveforbusiness` connector, not the consumer `onedrive` connector. For an existing environment that uses a consumer connection, create a fresh azd environment or explicitly replace that connection before running setup; these samples do not automatically migrate or delete it.

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need a Microsoft 365 OneDrive for Business account with access to the folder to watch, and permission to consent to the connector.

## Deploy to Azure

Run from `onedriveApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Complete OAuth consent in your browser, then use the interactive folder picker. The hook lists folders through the authorized connector connection and creates two triggers for your selected folder.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and OneDrive for Business connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The selected folder ID is saved as `ONEDRIVE_FOLDER_ID` on the azd environment. To make a saved folder available in the picker, set the connector's folder ID in advance (`root` for the drive root, otherwise the `Id` returned by the connector's folder listing):

```sh
azd env set ONEDRIVE_FOLDER_ID "root"
```

Choose the saved value in the picker to avoid browsing. Folder listing supports root arrays and the business connector's paged `value` envelope using the SDK's double-encoded `foldersV2` route. The picker shows the returned page; enter a folder ID manually if it is not listed. A saved folder setting does not bypass required OAuth consent. To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one OneDrive for Business connection in `Connected` state and two metadata triggers in `Enabled` state.

Create or modify a file in the selected folder, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or triggers are missing, rerun the hook and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [OneDrive for Business connector operations](https://learn.microsoft.com/connectors/onedriveforbusiness/)
- [All TypeScript samples](../README.md#samples)
