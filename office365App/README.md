# Office 365 Outlook Connector Sample

Azure Functions app demonstrating typed Office 365 Outlook triggers from [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors). Handlers are in [src/functions](src/functions/).

| Function | Helper under `connectors.office365` | Connector operation |
| -------- | ---------------------------------- | ------------------- |
| [OnNewEmail](src/functions/onNewEmail.ts) | `onNewEmail` | `OnNewEmailV3` |
| [OnFlaggedEmail](src/functions/onFlaggedEmail.ts) | `onFlaggedEmail` | `OnFlaggedEmailV4` |
| [OnNewMentionMeEmail](src/functions/onNewMentionMeEmail.ts) | `onNewEmailMentioningMe` | `OnNewMentionMeEmailV3` |
| [OnNewCalendarEvent](src/functions/onNewCalendarEvent.ts) | `onNewCalendarEvent` | `CalendarGetOnNewItemsV3` |
| [OnUpcomingEvent](src/functions/onUpcomingEvent.ts) | `onUpcomingEvents` | `OnUpcomingEventsV3` |
| [OnCalendarNewItems](src/functions/onCalendarNewItems.ts) | `onCalendarNewItems` | `CalendarGetOnNewItemsV3` |
| [OnCalendarUpdatedItems](src/functions/onCalendarUpdatedItems.ts) | `onCalendarUpdatedItems` | `CalendarGetOnUpdatedItemsV3` |
| [OnCalendarChangedItems](src/functions/onCalendarChangedItems.ts) | `onCalendarChangedItems` | `CalendarGetOnChangedItemsV3` |
| [OnSharedMailboxNewEmail](src/functions/onSharedMailboxNewEmail.ts) | `onSharedMailboxNewEmail` | `SharedMailboxOnNewEmailV2` |

All nine exported helpers have examples. `onCalendarNewItems` aliases `onNewCalendarEvent`; the sample registers both, so a new calendar event can reach both functions. Choose one subscription for that operation in production. Changed-calendar events use `CalendarChangedEventTriggerContext` and the SDK's case-sensitive `ActionType` field.

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

The deployment builds the TypeScript app and runs the [postdeploy hook](azure.yaml). Complete the OAuth consent flow in your browser when prompted. Both platform hooks wait for the connection to become `Connected`, then create eight trigger configurations, or nine when a shared mailbox is configured.

## Resources provisioned

- Flex Consumption Function App with a system-assigned managed identity.
- Storage account, Application Insights, and Log Analytics workspace.
- Connector Namespace and Office 365 Outlook connection.

The Preview Functions Extension Bundle is already configured in [host.json](host.json).

## Connector configuration

The hook configures email triggers for `Inbox`, calendar triggers for `Calendar`, and a 15-minute look-ahead for upcoming events. To enable the shared mailbox example, set a mailbox the connected user can access:

```sh
azd env set OFFICE365_SHARED_MAILBOX_ADDRESS "shared@contoso.com"
```

Without that setting, the shared mailbox subscription is skipped with an explicit warning; its handler still registers. To repeat connection consent and trigger setup without redeploying:

```sh
azd hooks run postdeploy
```

## Verify

Open [Connector Namespaces](https://connectors.azure.com/) and select the namespace created by azd. Expect one Office 365 Outlook connection in `Connected` state and eight triggers in `Enabled` state, or nine with the shared mailbox setting. The [historical namespace overview](docs/connector-namespace-overview-office365.png) predates the additional examples.

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
