# Dataflows Connector Sample

Azure Functions app covering `connectors.dataflows.onRefreshComplete` from `@azure/functions-extensions-connectors@0.2.0-preview`.

| Function | Connector operation | Required parameters |
| -------- | ------------------- | ------------------- |
| [OnDataflowRefreshComplete](src/functions/onDataflowRefreshComplete.ts) | `OnRefreshComplete` | `workspaceType`, `groupIdForOnRefreshComplete`, `dataflowIdForOnRefreshComplete` |

The handler receives `DataflowRefreshTriggerContext.refreshes`, typed as SDK `RefreshModel[]`, and logs the dataflow name, refresh status, and times. `DataflowsOnRefreshCompleteTriggerPayload` describes the **normalized** callback context; the SDK does not export a raw callback-envelope alias. The handler returns `context.rawPayload` unchanged.

## Prerequisites and local development

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js 24+. For live events, use a test account with access to the selected Power BI workspace or Power Platform environment and dataflow.

From this folder:

```sh
npm ci
npm test
npm start
```

Configure [local.settings.json](local.settings.json) without committing credentials, and run Azurite for development storage. Local event delivery also needs a reachable HTTPS callback and a separately configured subscription.

## Deploy and configure

Keep the full repository checkout: [infra/main.bicep](infra/main.bicep) reuses [genericApp's deployment module](../genericApp/infra/main.bicep) to provision a Node.js 24 Flex Consumption Function App, host storage, and monitoring.

```sh
az login
azd auth login
azd up
```

Use a unique azd environment. This app does **not** automatically provision a Connector Namespace, connection, or trigger. Follow [manual connector setup](../README.md#manual-connector-setup) with connector ID `dataflows`, operation `OnRefreshComplete`, and callback function name `OnDataflowRefreshComplete`.

Use `DataflowsTriggerOperations` / `DataflowsTriggerParameters` from `@azure/connectors/generated/DataflowsExtensions`. `workspaceType` must be `Workspace` or `Environment`; select actual group and dataflow IDs through the connector's dynamic-value operations.

## Verify

Confirm the connection is `Connected` and the subscription is `Enabled` in [Connector Namespaces](https://connectors.azure.com/), then refresh the selected test dataflow. Inspect Function App logs for its name and status. Offline tests exercise the typed handler, not live service delivery.
