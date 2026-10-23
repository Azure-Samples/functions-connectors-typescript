# Microsoft Teams Connector Sample

Azure Functions app demonstrating typed Teams triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| `OnNewChannelMessage` | `OnNewChannelMessage` | New root message is posted to a channel |
| `OnNewChannelMessageMentioningMe` | `OnNewChannelMessageMentioningMe` | Channel message mentions the signed-in user |
| `OnGroupMembershipAdd` | `OnGroupMembershipAdd` | Member is added to the team |
| `OnGroupMembershipRemoval` | `OnGroupMembershipRemoval` | Member is removed from the team |

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need a Microsoft Teams account with access to the team and channel, and permission to consent to the connector.

The interactive team/channel picker uses Microsoft Graph through your Azure CLI sign-in. If your tenant restricts that access, set the team and channel IDs in advance.

## Deploy to Azure

Run from `teamsApp`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Select a team and channel when prompted, and complete OAuth consent in your browser. The hook creates four trigger configurations.

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

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Microsoft Teams connection in `Connected` state and four triggers in `Enabled` state. See the [example namespace overview](docs/connectors-namespace-overview-teams.png).

Post a channel message or change team membership, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or triggers are missing, rerun the hook and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [Microsoft Teams connector operations](https://learn.microsoft.com/connectors/teams/)
- [All TypeScript samples](../README.md#samples)
