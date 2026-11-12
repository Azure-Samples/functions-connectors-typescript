# Planner Connector Sample

Azure Functions app covering all three `connectors.planner` helpers.

| Function | Helper | Connector operation | Required parameters |
| -------- | ------ | ------------------- | ------------------- |
| [OnPlannerCompleteTask](src/functions/onPlannerCompleteTask.ts) | `onCompleteTask` | `OnCompleteTask_V3` | `groupId`, `id` |
| [OnPlannerNewTask](src/functions/onPlannerNewTask.ts) | `onNewTask` | `OnNewTask_V3` | `groupId`, `id` |
| [OnPlannerTaskAssignedToMe](src/functions/onPlannerTaskAssignedToMe.ts) | `onTaskAssignedToMe` | `OnTaskAssignedToMe_V2` | None |

Handlers use `PlannerTaskTriggerContext.tasks`, typed as SDK `GetTaskResponseV2[]` (`PlannerTask[]`). They log task IDs, titles, completion or assignment metadata, and return the original payload unchanged. The `id` operation parameter is the **plan ID**, not the task ID.

## Prerequisites and local development

Follow the [shared prerequisites](../../README.md#prerequisites), including Node.js 24+. Live events require a test Microsoft 365 account with Planner access and permissions for the selected group and plan.

From this folder:

```sh
npm ci
npm test
npm start
```

Run `npm run setup:local`, then configure `local.settings.json` without committing credentials, and run Azurite for development storage. Local callbacks require reachable HTTPS and separate subscriptions; starting the host does not create them.

## Deploy and configure

The self-contained [infra/main.bicep](infra/main.bicep) template provisions a Node.js 24 Flex Consumption Function App, host storage, monitoring, a Connector Namespace, a `planner` connection, and access policies for the namespace, Function App, and deployer.

```sh
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-planner-webhook-environment>
azd up
```

Packaging, provisioning, and deployment run sequentially before the interactive postdeploy hook. If needed, the hook runs `az connector-namespace connection authenticate`; complete consent in your normal browser and keep the terminal open. It verifies `Connected`, lets you configure or skip each trigger, creates selected webhook subscriptions, and applies `PlannerConnection` and listener-enabled settings automatically. It retrieves the extension key without printing it or placing it in the callback URL. The CLI extension must support `connection authenticate`.

Only required selectors prompt, for example Group Id and Plan Id. Authenticated pickers supply actual identifiers; optional fields remain at defaults. If a picker has no usable choices, enter the actual connector identifier manually, or leave blank to skip that trigger. The assigned-to-me operation uses the authenticated user and needs no selectors.

During consent, the terminal checks Azure connection status every 10 seconds. A browser popup that stays open is not proof of failure: wait for **authentication confirmed: Azure connection is Connected**, then close the sign-in windows and continue in the terminal. Setup does not wait for a missing browser redirect once Azure confirms the connection. If setup failed or was interrupted, run `azd hooks run postdeploy` to retry without redeploying.

Selections are saved in `PLANNER_WEBHOOK_TRIGGER_INPUTS`. Reruns reuse unchanged subscriptions; clear it with `azd env set PLANNER_WEBHOOK_TRIGGER_INPUTS=`, then run `azd hooks run postdeploy` to select again. Skipped owned subscriptions and listeners are disabled without deleting them or changing their selectors. Skipping everything stops before changes. Poll or other apps' subscriptions are never overwritten.

A fresh `local.settings.json` receives the runtime URL; existing local settings are preserved. For local callbacks, use a separate subscription and reachable HTTPS rather than retargeting the deployed subscription.

## Verify

Confirm the connection is `Connected` and the desired subscriptions are `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Create a test task, complete it, or assign it to the connected user, then inspect Function App logs. Offline tests cover all three wrappers and payload scenarios, not live delivery.
