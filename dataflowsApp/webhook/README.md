# Dataflows Connector Sample

Azure Functions app covering `connectors.dataflows.onRefreshComplete` from `@azure/functions-extensions-connectors@0.2.0-preview`.

| Function | Connector operation | Required parameters |
| -------- | ------------------- | ------------------- |
| [OnDataflowRefreshComplete](src/functions/onDataflowRefreshComplete.ts) | `OnRefreshComplete` | `workspaceType`, `groupIdForOnRefreshComplete`, `dataflowIdForOnRefreshComplete` |

The handler receives `DataflowRefreshTriggerContext.refreshes`, typed as SDK `RefreshModel[]`, and logs the dataflow name, refresh status, and times. `DataflowsOnRefreshCompleteTriggerPayload` describes the **normalized** callback context; the SDK does not export a raw callback-envelope alias. The handler returns `context.rawPayload` unchanged.

## Prerequisites and local development

Follow the [shared prerequisites](../../README.md#prerequisites), including Node.js 24+. For live events, use a test account with access to the selected Power BI workspace or Power Platform environment and dataflow.

From this folder:

```sh
npm ci
npm test
npm start
```

Run `npm run setup:local`, then configure `local.settings.json` without committing credentials, and run Azurite for development storage. Local event delivery also needs a reachable HTTPS callback and a separately configured subscription.

## Deploy and configure

The self-contained [infra/main.bicep](infra/main.bicep) template provisions a Node.js 24 Flex Consumption Function App, host storage, monitoring, a Connector Namespace, a `dataflows` connection, and access policies for the namespace, Function App, and deployer.

```sh
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-dataflows-webhook-environment>
azd up
```

Packaging, provisioning, and deployment run sequentially before the interactive postdeploy hook. If needed, it runs `az connector-namespace connection authenticate`; complete consent in your normal browser and keep the terminal open. The CLI extension must support that command. Setup verifies `Connected`, asks whether to configure the trigger, then collects only required selectors, for example Group Type and Dataflow. Group Type selects `Workspace` or `Environment`; authenticated pickers resolve the dependent group and dataflow IDs.

An empty usable picker allows manual connector-ID entry; blank skips the trigger. With no selected trigger, setup stops before changes. The hook retrieves the extension key securely, creates the webhook subscription, and sets `DataflowsConnection` and listener-enabled settings.

Selections are saved in `DATAFLOWS_WEBHOOK_TRIGGER_INPUTS`; unchanged reruns reuse the subscription. Clear it with `azd env set DATAFLOWS_WEBHOOK_TRIGGER_INPUTS=`, then run `azd hooks run postdeploy` to select again. Poll and other apps' subscriptions are never overwritten.

A fresh `local.settings.json` receives the runtime URL; existing local settings are preserved. Local callbacks still need a separate subscription and reachable HTTPS.

## Verify

Confirm the connection is `Connected` and the subscription is `Enabled` in [Connector Namespaces](https://connectors.azure.com/), then refresh the selected test dataflow. Inspect Function App logs for its name and status. Offline tests exercise the typed handler, not live service delivery.
