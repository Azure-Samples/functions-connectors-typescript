# Azure Functions Connectors — TypeScript Samples

End-to-end TypeScript samples demonstrating [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) — the strongly-typed binding layer for Azure Logic Apps connectors in Azure Functions (Node.js).

Each sample is an independent Azure Functions app, organised by connector and deployable with a single `azd up`.

## Samples at a glance

| App | Connector | Triggers demonstrated |
|---|---|---|
| [`azureblobApp/`](./azureblobApp) | Azure Blob | `onUpdatedFile` |
| [`kustoApp/`](./kustoApp) | Azure Data Explorer (Kusto) | `onQueryResult` |
| [`office365App/`](./office365App) | Office 365 Outlook | `onNewEmail`, `onFlaggedEmail`, `onNewMentionMeEmail`, `onNewCalendarEvent`, `onUpcomingEvent` |
| [`onedriveApp/`](./onedriveApp) | OneDrive for Business | `onNewFile`, `onUpdatedFile` |
| [`sharepointApp/`](./sharepointApp) | SharePoint Online | `onNewFile`, `onUpdatedFile` |
| [`teamsApp/`](./teamsApp) | Microsoft Teams | `onNewChannelMessage`, `onNewChannelMessageMentioningMe`, `onGroupMembershipAdd`, `onGroupMembershipRemoval` |
| [`genericApp/`](./genericApp) | _any connector_ (uses generic `connectorTrigger<TItem>` API) | Azure Blob, Office 365, SharePoint, Teams, and a custom-type example |

> **Coverage:** All 15 first-class trigger registrations exposed by `@azure/functions-extensions-connectors@0.0.2-preview` are demonstrated by at least one sample function. The `genericApp` additionally demonstrates the lower-level `connectorTrigger<TItem>` API for connectors without a first-class wrapper or for custom item types.

## What each sample shows

### `azureblobApp` — Azure Blob

A single function `OnAzureBlobUpdatedFile` that fires when blobs in a watched Azure Blob container are updated. Receives a typed `AzureBlobFileTriggerContext` whose `context.files` is `AzureBlobMetadata[]` — read `Name`, `Path`, `Size`, `LastModified` with full IntelliSense.

### `kustoApp` — Azure Data Explorer (Kusto)

`OnKustoQueryResult` runs whenever the configured Kusto query produces a non-empty result. Each row arrives as a `KustoRow` (record-of-unknown) under `context.rows`.

### `office365App` — Office 365 Outlook

Five Outlook triggers:

| Function | Fires when… |
|---|---|
| `OnNewEmail` | A new email lands in the watched mailbox/folder |
| `OnFlaggedEmail` | An email is flagged (follow-up) |
| `OnNewMentionMeEmail` | A new email @-mentions the connection identity |
| `OnNewCalendarEvent` | A new calendar event is created |
| `OnUpcomingEvent` | A calendar event is about to start (lead-time configured on the connector) |

Email triggers expose `context.emails` (`GraphClientReceiveMessage[]`); calendar triggers expose `context.calendarEvents` (`GraphCalendarEventClientReceive[]`).

### `onedriveApp` — OneDrive for Business

`OnOneDriveNewFile` and `OnOneDriveUpdatedFile`. Both expose `context.files` as `OneDriveBlobMetadata[]`.

### `sharepointApp` — SharePoint Online

`OnSharepointNewFile` and `OnSharepointUpdatedFile`. Both expose `context.files` as `BlobMetadata[]` (the SharePoint SDK item type).

### `teamsApp` — Microsoft Teams

Four Teams triggers:

| Function | Fires when… | Named context property |
|---|---|---|
| `OnNewChannelMessage` | A new channel message is posted | `messages: ChatMessage[]` |
| `OnNewChannelMessageMentioningMe` | A channel message @-mentions the connection identity | `messages: ChatMessage[]` |
| `OnGroupMembershipAdd` | A user is added to a Teams group | `members: GroupMembershipChange[]` |
| `OnGroupMembershipRemoval` | A user is removed from a Teams group | `members: GroupMembershipChange[]` |

### `genericApp` — generic `connectorTrigger<TItem>` API

Demonstrates the **lower-level generic API** that works for any Azure Logic Apps connector — including connectors that do not have a first-class wrapper. Use it when you need full control over the item type, or when wiring a custom / not-yet-wrapped connector.

| Function | Connector | Item type |
|---|---|---|
| `OnGenericAzureBlobUpdated` | Azure Blob | `AzureBlobMetadata` |
| `OnGenericOffice365NewEmail` | Office 365 | `GraphClientReceiveMessage` |
| `OnGenericSharepointNewFile` | SharePoint Online | `BlobMetadata` |
| `OnGenericTeamsChannelMessage` | Teams | `ChatMessage` |
| `OnGenericCustomConnectorEvent` | _any custom connector_ | inline `CustomConnectorItem` |

Handlers receive a `ConnectorTriggerContext<TItem>` whose `context.items` is the typed item array. The first-class `connectors.<x>.<y>()` helpers are preferred when available because they add named fields (`files`, `messages`, `emails`, ...) on top of `items`; `genericApp` is the escape hatch when that wrapper does not exist.

```typescript
import { AzureBlobMetadata, connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<AzureBlobMetadata>('OnGenericAzureBlobUpdated', {
    handler: async (context, invocationContext) => {
        for (const file of context.items) {
            invocationContext.log(`Name: '${file.Name}'.`);
        }
        return context.rawPayload;
    },
});
```

## Connectors **not** sampled (action-only)

The following connectors in `@azure/connectors@0.2.0-preview` expose **no trigger methods** and are intentionally omitted. They are consumed as action clients directly via `@azure/connectors`:

| Connector | What you'd use it for | How to consume |
|---|---|---|
| `arm` | Subscription, resource group, deployment management | `new ArmClient(...)` from `@azure/connectors/generated/ArmExtensions` |
| `azuremonitorlogs` | KQL `queryData` / `visualizeQuery` | `new AzuremonitorlogsClient(...)` |
| `mq` | IBM MQ read / receive / send / delete | `new MqClient(...)` |
| `msgraphgroupsanduser` | Directory list users / groups / licenses | `new MsgraphgroupsanduserClient(...)` |
| `office365users` | User profile / photo / search | `new Office365usersClient(...)` |
| `smtp` | `sendEmail` | `new SmtpClient(...)` |

## Prerequisites

- [Node.js 20+](https://nodejs.org/).
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local).
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd).
- An Azure subscription.
- A configured AI Gateway connection for the connector you want to trigger on (see the [connection-setup guide](https://github.com/Azure/Connectors-NodeJS-SDK/blob/main/docs/connection-setup.md)).

## Run a sample locally

```bash
cd <connectorApp>
npm install
npm start
```

Update `local.settings.json` with the runtime URL and access token for your connector before starting. The keys differ per connector (e.g. `Office365Connection` / `OFFICE365_TOKEN`, `TeamsConnection` / `TEAMS_TOKEN`).

## Deploy a sample to Azure

```bash
cd <connectorApp>
azd auth login
azd up
```

`azd up` provisions a resource group containing:

- Azure Storage account (Function App backing store)
- Linux Consumption Function App (Node 20) with system-assigned managed identity
- Application Insights + Log Analytics workspace

It then runs the `prepackage` hook (`npm install && npm run build`) and deploys the compiled output.

After provisioning, configure the connector runtime URL and token:

```bash
azd env set CONNECTOR_RUNTIME_URL '<your-connector-runtime-url>'
azd env set CONNECTOR_TOKEN '<your-token>'
azd provision   # re-runs the Bicep to push the new app settings
```

> **Note:** The connector trigger requires the **Experimental** Functions Extension Bundle (`Microsoft.Azure.Functions.ExtensionBundle.Experimental`, version `[4.6.*, 5.0.0)`) — already pre-configured in every sample's `host.json`.

## Repository layout

```
functions-connectors-typescript/
├── README.md
├── PR_DESCRIPTION.md
├── .gitignore
├── .scaffold/                  # shared template (host.json, tsconfig, infra/, src/index.ts)
├── azureblobApp/
├── kustoApp/
├── office365App/
├── onedriveApp/
├── sharepointApp/
├── teamsApp/
└── genericApp/                  # generic connectorTrigger<TItem> API
```

Each app folder is self-contained:

```
<connectorApp>/
├── src/
│   ├── index.ts                # app.setup({ enableHttpStream: true })
│   └── functions/              # one file per trigger
├── infra/
│   ├── main.bicep              # subscription-scope: creates RG, delegates to resources.bicep
│   ├── resources.bicep         # Storage + App Insights + Function App
│   └── main.parameters.json    # ${AZURE_ENV_NAME}, ${AZURE_LOCATION}, ${CONNECTOR_RUNTIME_URL=}, ${CONNECTOR_TOKEN=}
├── azure.yaml                  # azd service definition + prepackage hook
├── host.json                   # Experimental extension bundle + logging
├── local.settings.json         # placeholders for runtime URL + token
├── package.json
├── tsconfig.json
└── README.md
```

## How the trigger code looks

Every sample handler is a thin first-class wrapper that gives you a typed `context` plus a named alias:

```typescript
import { InvocationContext } from '@azure/functions';
import { connectors, EmailTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onNewEmail('OnNewEmail', {
    handler: async (context: EmailTriggerContext, invocationContext: InvocationContext) => {
        for (const email of context.emails) {
            invocationContext.log(`Subject: '${email.subject}'.`);
        }
        return context.rawPayload;
    },
});
```

- `context.emails` (or `files`, `messages`, `members`, `rows`, `calendarEvents`) is the typed array — same data as `context.items`, just named for clarity.
- `context.payload` is the normalised envelope (`{ body: { value: T[] } }`).
- `context.rawPayload` is the original payload — useful for forwarding or persisting.

## Related repos

| Repo | Purpose |
|---|---|
| [Azure/Connectors-NodeJS-SDK](https://github.com/Azure/Connectors-NodeJS-SDK) | `@azure/connectors` — generated TypeScript SDK for Azure Logic Apps connectors |
| [Azure/azure-functions-nodejs-extensions](https://github.com/Azure/azure-functions-nodejs-extensions) | `@azure/functions-extensions-connectors` — the binding extension consumed by these samples |
