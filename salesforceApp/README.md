# Salesforce Connector Sample

Azure Functions app covering both `connectors.salesforce` helpers.

| Function | Helper | Connector operation | Required parameters |
| -------- | ------ | ------------------- | ------------------- |
| [OnSalesforceNewItems](src/functions/onSalesforceNewItems.ts) | `onNewItems` | `GetOnNewItems` | `table` |
| [OnSalesforceUpdatedItems](src/functions/onSalesforceUpdatedItems.ts) | `onUpdatedItems` | `GetOnUpdatedItems` | `table` |

Handlers use `SalesforceRecordTriggerContext.records`, typed as SDK `SalesforceItem[]`. They log whole records as JSON, preserving `dynamicProperties` and any raw callback fields without fabricating a fixed Salesforce object schema. The original payload is returned unchanged. Use a sandbox or test records because dynamic fields may contain sensitive information.

## Prerequisites and local development

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js 24+. Live events require a Salesforce account and connector permissions for the selected object.

From this folder:

```sh
npm ci
npm test
npm start
```

Configure [local.settings.json](local.settings.json) without committing credentials, and run Azurite for development storage. Local callbacks require reachable HTTPS and separate subscriptions; starting the host does not create them.

## Deploy and configure

Keep the full repository checkout: [infra/main.bicep](infra/main.bicep) reuses [genericApp's deployment module](../genericApp/infra/main.bicep) to provision a Node.js 24 Flex Consumption Function App, host storage, and monitoring.

```sh
az login
azd auth login
azd up
```

Use a unique azd environment. This app does **not** automatically provision a Connector Namespace, connection, or triggers. Follow [manual connector setup](../README.md#manual-connector-setup) with connector ID `salesforce`, the selected object as `table`, and each table entry's exact operation and callback function name.

Use `SalesforceTriggerOperations` / `SalesforceTriggerParameters` from `@azure/connectors/generated/SalesforceExtensions`. Choose the actual object through the connector's picker; optional `$filter`, `$orderby`, and `$select` parameters can narrow the subscription.

## Verify

Confirm the connection is `Connected` and the desired subscriptions are `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Create or modify a sandbox record in the selected object, then inspect Function App logs. Offline tests exercise typed dynamic records, not live delivery or Salesforce permissions.
