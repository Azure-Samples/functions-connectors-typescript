# Planner Connector Sample

Azure Functions app covering all three `connectors.planner` helpers.

| Function | Helper | Connector operation | Required parameters |
| -------- | ------ | ------------------- | ------------------- |
| [OnPlannerCompleteTask](src/functions/onPlannerCompleteTask.ts) | `onCompleteTask` | `OnCompleteTask_V3` | `groupId`, `id` |
| [OnPlannerNewTask](src/functions/onPlannerNewTask.ts) | `onNewTask` | `OnNewTask_V3` | `groupId`, `id` |
| [OnPlannerTaskAssignedToMe](src/functions/onPlannerTaskAssignedToMe.ts) | `onTaskAssignedToMe` | `OnTaskAssignedToMe_V2` | None |

Handlers use `PlannerTaskTriggerContext.tasks`, typed as SDK `GetTaskResponseV2[]` (`PlannerTask[]`). They log task IDs, titles, completion or assignment metadata, and return the original payload unchanged. The `id` operation parameter is the **plan ID**, not the task ID.

## Prerequisites and local development

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js 24+. Live events require a test Microsoft 365 account with Planner access and permissions for the selected group and plan.

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

Use a unique azd environment. This app does **not** automatically provision a Connector Namespace, connection, or triggers. Follow [manual connector setup](../README.md#manual-connector-setup) with connector ID `planner` and each table entry's exact operation and callback function name.

Use `PlannerTriggerOperations` / `PlannerTriggerParameters` from `@azure/connectors/generated/PlannerExtensions` to select actual group and plan IDs. The assigned-to-me operation uses the authenticated user and needs no operation parameters.

## Verify

Confirm the connection is `Connected` and the desired subscriptions are `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Create a test task, complete it, or assign it to the connected user, then inspect Function App logs. Offline tests cover all three wrappers and payload scenarios, not live delivery.
