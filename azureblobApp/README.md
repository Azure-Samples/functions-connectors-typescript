# Azure Blob Storage Connector Sample

Azure Functions app demonstrating an Azure Blob Storage trigger from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The handler is in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| `OnAzureBlobUpdatedFile` | `OnUpdatedFiles_V2` | Blob is added or modified in the configured container (properties only) |

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need an Azure Storage account, its access key, and an existing blob container to watch.

## Deploy to Azure

Run from `azureblobApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postup hook](azure.yaml). Enter the storage account name or blob endpoint, access key, and container name when prompted. The hook configures the connection and creates one trigger.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and Azure Blob Storage connection.

The app's provisioned storage account supports the Functions host; the connector watches the account and container you select. The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook saves the non-secret account and container values as `BLOB_ACCOUNT` and `BLOB_CONTAINER` on the azd environment. The access key is prompted for separately and is not saved as an azd environment value.

For V2 operations, use the storage account name as the connector's custom value; see the [connector limitations](https://learn.microsoft.com/connectors/azureblob/#general-known-issues-and-limitations). The hook derives `dataset` and the encoded `folderId` from your selections.

To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postup
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Azure Blob Storage connection in `Connected` state and one trigger in `Enabled` state. See the [example namespace overview](docs/connectors-namespace-overview-blob.png).

Add or modify a blob in the selected container, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or the trigger is missing, rerun the hook and enter the account details again.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [Azure Blob Storage connector operations](https://learn.microsoft.com/connectors/azureblob/)
- [All TypeScript samples](../README.md#samples)
