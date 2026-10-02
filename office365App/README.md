# Office 365 Outlook Connector Sample

Azure Functions app demonstrating typed Office 365 Outlook triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Connector operation | Description |
| -------- | ------------------- | ----------- |
| `OnNewEmail` | `OnNewEmailV3` | New email arrives in Inbox |
| `OnFlaggedEmail` | `OnFlaggedEmailV3` | An email is flagged in Inbox |
| `OnNewMentionMeEmail` | `OnNewMentionMeEmailV3` | New email mentioning you arrives in Inbox |
| `OnNewCalendarEvent` | `CalendarGetOnNewItemsV3` | New event is created in Calendar |
| `OnUpcomingEvent` | `OnUpcomingEventsV3` | Calendar event starts within 15 minutes |

> These handlers log email and calendar metadata. Use a test account and avoid sensitive data.

## Prerequisites

Follow the [shared prerequisites](../README.md#prerequisites). You also need an Office 365 account with access to Outlook email and calendar, and permission to consent to the connector.

## Deploy to Azure

Run from `office365App`:

```sh
az login
azd auth login
azd up
```

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Complete the OAuth consent flow in your browser when prompted. The hook waits for the connection to become `Connected`, then creates five trigger configurations.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and Office 365 Outlook connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook configures email triggers for `Inbox`, calendar triggers for `Calendar`, and a 15-minute look-ahead for upcoming events. To repeat connection consent and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Office 365 Outlook connection in `Connected` state and five triggers in `Enabled` state. See the [example namespace overview](docs/connector-namespace-overview-office365.png).

Send an email to the connected account or create a calendar event, then inspect the Function App logs in Application Insights. If the connection is unauthenticated or triggers are missing, rerun the hook and complete consent.

## Run locally

Configure [local.settings.json](local.settings.json) for your environment and start Azurite if using the default development storage setting:

```sh
npm install
npm start
```

This builds the app and starts the Functions host. Receiving connector events locally also requires a reachable HTTPS callback and a separate trigger configuration targeting it; `npm start` does not create subscriptions.

## More

- [Office 365 Outlook connector operations](https://learn.microsoft.com/connectors/office365/)
- [All TypeScript samples](../README.md#samples)
