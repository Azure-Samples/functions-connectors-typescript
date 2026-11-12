# Microsoft Teams Connector Sample

Azure Functions app demonstrating all Microsoft Teams triggers. Some triggers have named helpers in [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors); others do not. Use a named helper when available; otherwise, use the generic `connectorTrigger<T>` API. Handlers are in [src/functions](src/functions/).

| Function | Registration API | Connector operation |
| -------- | ------------------------------ | ------------------- |
| [OnNewChannelMessage](src/functions/onNewChannelMessage.ts) | `connectors.teams.onNewChannelMessage` | `OnNewChannelMessage` |
| [OnNewChannelMessageMentioningMe](src/functions/onNewChannelMessageMentioningMe.ts) | `connectors.teams.onNewChannelMessageMentioningMe` | `OnNewChannelMessageMentioningMe` |
| [OnGroupMembershipAdd](src/functions/onGroupMembershipAdd.ts) | `connectors.teams.onTeamMemberAdded` | `OnGroupMembershipAdd` |
| [OnGroupMembershipRemoval](src/functions/onGroupMembershipRemoval.ts) | `connectors.teams.onTeamMemberRemoved` | `OnGroupMembershipRemoval` |
| [OnWebhookAtMention](src/functions/onWebhookAtMention.ts) | `connectorTrigger<T>` | `WebhookAtMentionTrigger` |
| [OnWebhookMessageReaction](src/functions/onWebhookMessageReaction.ts) | `connectorTrigger<T>` | `WebhookMessageReactionTrigger` |
| [OnTranscriptAvailable](src/functions/onTranscriptAvailable.ts) | `connectorTrigger<T>` | `TranscriptTrigger` |
| [OnRecordingAvailable](src/functions/onRecordingAvailable.ts) | `connectorTrigger<T>` | `RecordingTrigger` |
| [OnWebhookChatMessage](src/functions/onWebhookChatMessage.ts) | `connectorTrigger<T>` | `WebhookChatMessageTrigger` |
| [OnWebhookKeyword](src/functions/onWebhookKeyword.ts) | `connectorTrigger<T>` | `WebhookKeywordTrigger` |
| [OnWebhookNewMessage](src/functions/onWebhookNewMessage.ts) | `connectorTrigger<T>` | `WebhookNewMessageTrigger` |

## Prerequisites

Follow the [shared prerequisites](../../README.md#prerequisites). You also need a Microsoft Teams account with access to the team and channel, and permission to consent to the connector.

The interactive team/channel picker uses Microsoft Graph through your Azure CLI sign-in. If your tenant restricts that access, set the team and channel IDs in advance.

## Deploy to Azure

Run from `teamsApp/webhook`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Both platform hooks follow this order:

1. Read saved team/channel IDs, or use the existing Microsoft Graph pickers and save your selections.
2. Complete OAuth consent and wait for the Teams connection to become `Connected`.
3. Use the shared [webhook setup](infra/scripts/setup-webhook-triggers.mjs) to configure or explicitly skip each of the seven additional triggers. Connector-backed pickers and free-form prompts run together in this stage, after authentication.
4. Create the four original trigger configurations plus the additional ones you configured, up to eleven.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and Microsoft Teams connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook saves your selections as `TEAMS_GROUP_ID` and `TEAMS_CHANNEL_ID` on the azd environment. To skip the picker, replace the values below with your team (Microsoft 365 group object ID) and channel IDs:

```sh
azd env set TEAMS_GROUP_ID "your-team-id"
azd env set TEAMS_CHANNEL_ID "19:your-channel-id@thread.tacv2"
```

These settings do not skip any required OAuth consent. To repeat connection and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

### Additional webhook inputs

After OAuth consent, the postdeploy hook asks whether to configure or skip each additional trigger. For each trigger you configure, you are guided through a series of prompts specific to that connector operation. Depending on the operation, you select values from numbered lists or enter free-form text. The prompts may change based on your earlier selections, and required inputs must be provided before the trigger is created.

These operation-specific inputs are collected each time you rerun the hook; only the original team/channel selections are saved.

Some choices require extra connector permissions or tenant access. Empty/failed picker responses, unavailable operations, or unsupported schemas stop setup rather than creating guessed configurations. Rerun the hook to retry or explicitly skip an unavailable trigger. Skipping a new trigger omits its configuration for that run; its handler still registers, and existing deployed configurations are not automatically deleted.

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Microsoft Teams connection in `Connected` state and eleven triggers in `Enabled` state if you configured all seven additional operations, or four plus the number you configured. The [example namespace overview](docs/connectors-namespace-overview-teams.png) predates the additional webhook examples.

Post a channel/chat message, mention the connected user, use a configured keyword or reaction, change team membership, or produce a transcript/recording in the selected scope. Then inspect the Function App logs in Application Insights. If the connection is unauthenticated or expected triggers are missing, rerun the hook and complete consent and setup.

## Run locally

Run `npm run setup:local`, then configure `local.settings.json` for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [Microsoft Teams connector operations](https://learn.microsoft.com/connectors/teams/)
- [All TypeScript samples](../../README.md#samples)
