# Generic Connector Trigger Sample

Azure Functions app demonstrating the generic `connectorTrigger<TItem>` API from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Use it for connectors without a typed wrapper or when you want a custom or partial item type. Handlers are in [src/functions](src/functions/).

| Function | Connector | Item type |
| -------- | --------- | --------- |
| `OnGenericAzureBlobUpdated` | Azure Blob Storage | `AzureBlobMetadata` |
| `OnGenericOffice365NewEmail` | Office 365 Outlook | `GraphClientReceiveMessage` |
| `OnGenericSharepointNewFile` | SharePoint Online | `BlobMetadata` |
| `OnGenericTeamsChannelMessage` | Microsoft Teams | `ChatMessage` |
| `OnGenericCustomConnectorEvent` | Custom connector | Inline `CustomConnectorItem` |

## Choosing the API

| Use case | API |
| -------- | --- |
| Connector with a typed wrapper and named context fields such as `emails`, `files`, or `messages` | `connectors.<connector>.<trigger>()` |
| Connector without a wrapper, or a custom item type | `connectorTrigger<TItem>(...)` |

Each handler receives a `ConnectorTriggerContext<TItem>` with `items`, the normalized `payload`, the original `rawPayload`, and `toJSON()`. The generic API changes the TypeScript handler declaration, not the connector operation. A separate trigger configuration must route the desired operation to the exact registered function name.

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). To receive real events, you also need a Connector Namespace, a configured connection, and a trigger configuration for each example you want to run.

## Deploy to Azure

Run from `genericApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and provisions a Flex Consumption Function App, Storage account, Application Insights, and Log Analytics workspace. The Preview Functions Extension Bundle is already configured in [host.json](host.json).

**This sample does not provision a Connector Namespace, connections, or trigger configurations.** Start with a [connector-specific sample](../README.md#samples) for an automated deployment, or configure these resources separately for this app.

## Connector configuration

Use the [operation mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md) to choose the operation and parameters. Route its trigger configuration to:

```text
https://<functions-host>/runtime/webhooks/connector?functionName=<registered-function-name>
```

Keep the connector extension key in `notificationDetails.authentication` with type `QueryString` and name `code`, rather than embedding it in the callback URL. The connector-specific samples' deployment scripts show the complete payload.

## Verify

Confirm the selected connection is `Connected` and its trigger is `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Check that the callback targets the matching function name in the table above, then generate an event and inspect the Function App logs.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment without committing secrets. Start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

Starting the host does not create connector subscriptions. Local event delivery requires a reachable HTTPS callback and a separate trigger configuration targeting it.

## More

- [Connector trigger extension](https://github.com/Azure/azure-functions-connector-extension)
- [All TypeScript samples](../README.md#samples)
