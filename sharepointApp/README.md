# SharePoint Online Connector Sample

Azure Functions app demonstrating typed SharePoint Online triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| `OnSharepointNewFile` | `OnNewFile` | New file is created in the configured library or folder |
| `OnSharepointUpdatedFile` | `OnUpdatedFile` | Existing file in the configured library or folder is modified |

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need a SharePoint Online account with access to the site and document library, and permission to consent to the connector.

## Deploy to Azure

Run from `sharepointApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Enter the SharePoint site address and folder when prompted, and complete OAuth consent in your browser. The hook creates two triggers for the chosen location.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and SharePoint Online connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook saves your selections as `SHAREPOINT_SITE_ADDRESS` and `SHAREPOINT_FOLDER_ID` on the azd environment. To skip these prompts, set them in advance:

```sh
azd env set SHAREPOINT_SITE_ADDRESS "https://contoso.sharepoint.com/sites/MySite"
azd env set SHAREPOINT_FOLDER_ID "/Shared Documents"
```

These settings do not skip any required OAuth consent. To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one SharePoint Online connection in `Connected` state and two triggers in `Enabled` state.

Create or modify a file in the selected location, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or triggers are missing, rerun the hook and complete consent.

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
