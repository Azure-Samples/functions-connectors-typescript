# Azure Blob Storage Connector Sample

Azure Functions app demonstrating an Azure Blob Storage trigger using the generic `connectorTrigger<TItem>` API from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The handler is in [src/functions](src/functions/).

Version `0.2.0-preview` exports neither `connectors.azureblob` nor `AzureBlobMetadata`. The sample imports `BlobMetadata` directly from `@azure/connectors/generated/AzureblobExtensions` under the alias `AzureBlobMetadata`, and uses `context.items`. Its function name and remote subscription remain unchanged.

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| [OnAzureBlobUpdatedFile](src/functions/onAzureBlobUpdatedFile.ts) | `OnUpdatedFiles_V2` | Blob is added or modified in the configured container (properties only) |

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). Deployment creates the storage account and container to watch and configures the connection with managed identity.

## Deploy to Azure

Run from `azureblobApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postup hook](azure.yaml). The hook configures the connection with the namespace's system-assigned managed identity and creates one trigger targeting the provisioned test storage account's `testcontainer`.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Host/deployment storage account, Application Insights, and Log Analytics workspace.
- Separate monitored storage account with a private `testcontainer` container and shared-key authentication disabled.
- Connector Namespace with a system-assigned managed identity and an Azure Blob Storage connection.

The Functions host and deployment package continue to use the original storage account. The connector watches only the separate test account. The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The namespace's managed identity has **Storage Blob Data Reader**, scoped to `testcontainer`, to list/read blobs and detect changes. The Function App's identity retains its host/deployment storage permissions and permission to use the connection; it is not granted access to the monitored account. The deployer receives **Storage Blob Data Contributor** on `testcontainer` to upload test blobs.

Both hooks read `monitoredStorageAccountName` and `monitoredContainerName` from infrastructure outputs and derive `dataset` and the encoded `folderId`. For V2 operations, `dataset` is the storage account name; see the [connector limitations](https://learn.microsoft.com/connectors/azureblob/#general-known-issues-and-limitations).

Storage RBAC changes can take up to 10 minutes to propagate.

To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postup
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Azure Blob Storage connection in `Ready` or `Connected` state and one trigger in `Enabled` state. See the [example namespace overview](docs/connectors-namespace-overview-blob.png).

Add or modify a blob in `testcontainer` in the account reported by the hook, then inspect the Function App logs in Application Insights. This is a polling trigger, so delivery is not immediate.

To upload using your signed-in Azure CLI identity:

```sh
az storage blob upload --auth-mode login \
  --account-name "$(azd env get-value monitoredStorageAccountName)" \
  --container-name testcontainer --name test.txt --file ./test.txt --overwrite
```

Create `test.txt` locally first. If authorization fails just after provisioning, allow time for RBAC propagation and retry. If the connection or trigger needs reconfiguring, rerun `azd hooks run postup`.

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
