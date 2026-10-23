# OneDrive Connector Sample

Azure Functions app demonstrating typed OneDrive triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| `OnOneDriveNewFile` | `OnNewFileV2` | New file is created in the configured folder |
| `OnOneDriveUpdatedFile` | `OnUpdatedFileV2` | Existing file in the configured folder is modified |

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need a OneDrive account with access to the folder to watch, and permission to consent to the connector.

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
- Connector Namespace and OneDrive connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The selected folder ID is saved as `ONEDRIVE_FOLDER_ID` on the azd environment. To skip folder selection, set the connector's folder ID in advance (`root` for the drive root, otherwise the `Id` returned by the connector's folder listing):

```sh
azd env set ONEDRIVE_FOLDER_ID "root"
```

An existing folder setting skips the picker, not any required OAuth consent. To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one OneDrive connection in `Connected` state and two triggers in `Enabled` state.

Create or modify a file in the selected folder, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or triggers are missing, rerun the hook and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [OneDrive connector operations](https://learn.microsoft.com/connectors/onedrive/)
- [All TypeScript samples](../README.md#samples)
