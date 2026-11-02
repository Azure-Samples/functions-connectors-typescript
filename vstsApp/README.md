# Azure DevOps (VSTS) Connector Sample

Azure Functions app covering all nine `connectors.vsts` helpers. The remote connector ID is `visualstudioteamservices`, not `vsts`.

| Function | Helper | Connector operation |
| -------- | ------ | ------------------- |
| [OnVstsBuildCompleted](src/functions/onVstsBuildCompleted.ts) | `onBuildCompleted` | `OnBuildCompleted` |
| [OnVstsGitPullClosed](src/functions/onVstsGitPullClosed.ts) | `onGitPullClosed` | `OnGitPullClosed` |
| [OnVstsGitPullCreated](src/functions/onVstsGitPullCreated.ts) | `onGitPullCreated` | `OnGitPullCreated` |
| [OnVstsGitPush](src/functions/onVstsGitPush.ts) | `onGitPush` | `OnGitPush` |
| [OnVstsTfvcCheckIn](src/functions/onVstsTfvcCheckIn.ts) | `onTfvcCheckIn` | `OnTfvcCheckIn` |
| [OnVstsWorkItemAssigned](src/functions/onVstsWorkItemAssigned.ts) | `onWorkItemAssigned` | `OnWorkItemAssignedV2` |
| [OnVstsWorkItemClosed](src/functions/onVstsWorkItemClosed.ts) | `onWorkItemClosed` | `OnWorkItemClosedV2` |
| [OnVstsWorkItemCreated](src/functions/onVstsWorkItemCreated.ts) | `onWorkItemCreated` | `OnWorkItemCreatedV2` |
| [OnVstsWorkItemUpdated](src/functions/onVstsWorkItemUpdated.ts) | `onWorkItemUpdated` | `OnWorkItemUpdatedV2` |

Handlers use the named typed collections `builds`, `pullRequests`, `pushes`, `changesets`, and `workItems`, and preserve the original callback payload. Work item fields remain `Record<string, unknown>` rather than a fabricated project schema.

## Prerequisites and local development

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js 24+. Live events require a test Azure DevOps organization/project and an account authorized for the selected build, repository, team, or work items. TFVC examples require a TFVC project.

From this folder:

```sh
npm ci
npm test
npm start
```

Configure [local.settings.json](local.settings.json) without committing credentials, and run Azurite for development storage. Local callbacks require reachable HTTPS and separately configured subscriptions.

## Deploy and configure

Keep the full repository checkout: [infra/main.bicep](infra/main.bicep) reuses [genericApp's deployment module](../genericApp/infra/main.bicep) to provision a Node.js 24 Flex Consumption Function App, host storage, and monitoring.

```sh
az login
azd auth login
azd up
```

Use a unique azd environment. This app does **not** automatically provision a Connector Namespace, connection, or triggers. Follow [manual connector setup](../README.md#manual-connector-setup) with connector ID `visualstudioteamservices` and each table entry's exact operation and callback function name.

Use `VisualstudioteamservicesTriggerOperations` / `VisualstudioteamservicesTriggerParameters` from `@azure/connectors/generated/VisualstudioteamservicesExtensions`:

- Every operation requires `account` and `project`.
- Pull request and push operations also require `repository`.
- Assigned work items additionally require `team` and `wiql__System_AssignedTo`.
- Build result/definition filters, branch filters, and other work item/team filters are optional; choose values matching the test project and the SDK metadata.

## Verify

Confirm the connection is `Connected` and the desired subscriptions are `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Generate the corresponding test event and inspect Function App logs. Offline tests cover all nine typed wrappers, not live subscriptions, repository permissions, or organization-specific work item rules.
