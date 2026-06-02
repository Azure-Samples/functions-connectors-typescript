# Azure Functions connectors samples

This repository is the canonical index of TypeScript samples that show how to use the new **Connector Namespace** integration with Azure Functions. Each sample lives in its own folder so you can clone, deploy, and explore independently with a single `azd up`.

> [!NOTE]
> Connectors in Azure Functions are in **public preview**. The Connector Namespace is currently available in **West Central US (`westcentralus`)**; your function app can be deployed in any region that supports the chosen hosting plan. Supported languages: **.NET 10** and **.NET 8 isolated worker**, **Python 3.13+**, and **Node.js 22+**. See the [overview](https://learn.microsoft.com/azure/azure-functions/) for details.

## What are Functions connectors?

Azure Functions integrates with the managed connectors platform that backs Logic Apps and Power Platform, giving your functions:

- **Connector triggers** — a function runs when an event occurs in an external service (new email in Office 365, file added to SharePoint or OneDrive, message posted to Microsoft Teams, and many more). The runtime exposes a `connectorTrigger` binding that receives webhook callbacks from the Connector Namespace.
- **Connector SDK actions** — function code calls connector operations through strongly-typed clients (Office 365 Outlook, Office 365 Users, Microsoft Teams, SharePoint, OneDrive, …) or through dynamic payload models for any other connector.

The connector platform handles webhook registration, OAuth flows, token refresh, and retry — you focus on the business logic.

## Getting-started samples

Six self-contained Azure Functions apps, each deployable with `azd up`:

| App | Connector | Triggers demonstrated |
|---|---|---|
| [`azureblobApp/`](./azureblobApp) | Azure Blob | `onUpdatedFile` |
| [`office365App/`](./office365App) | Office 365 Outlook | `onNewEmail`, `onFlaggedEmail`, `onNewMentionMeEmail`, `onNewCalendarEvent`, `onUpcomingEvent` |
| [`onedriveApp/`](./onedriveApp) | OneDrive for Business | `onNewFile`, `onUpdatedFile` |
| [`sharepointApp/`](./sharepointApp) | SharePoint Online | `onNewFile`, `onUpdatedFile` |
| [`teamsApp/`](./teamsApp) | Microsoft Teams | `onNewChannelMessage`, `onNewChannelMessageMentioningMe`, `onGroupMembershipAdd`, `onGroupMembershipRemoval` |
| [`genericApp/`](./genericApp) | _any connector_ — uses the generic `connectorTrigger<TItem>` API | Azure Blob, Office 365, SharePoint, Teams + a custom-type example |

**Coverage:** every first-class trigger registration shipped by [`@azure/functions-extensions-connectors@0.0.2-preview`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) (14 across five connectors) is demonstrated by at least one sample function.

## The packages these samples use

| Package | Role |
|---|---|
| [`@azure/functions`](https://www.npmjs.com/package/@azure/functions) | The Functions Node.js worker. Provides `app.connectorTrigger` and the broader bindings surface. |
| [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) | Strongly-typed binding layer on top of `app.connectorTrigger`. Exposes the `connectors.<name>.<trigger>()` namespace with normalised payloads and typed context (`files`, `emails`, `messages`, …). Used by all seven samples. |
| [`@azure/connectors`](https://www.npmjs.com/package/@azure/connectors) | Generated TypeScript SDK for connector **actions** (`Office365Client`, `SharepointClient`, `TeamsClient`, …). Also the source of item types like `BlobMetadata`, `GraphClientReceiveMessage`, `ChatMessage`. Use directly to call connector operations from your handler. |

## What each sample shows

### `azureblobApp` — Azure Blob

A single function `OnAzureBlobUpdatedFile` that fires when blobs in a watched Azure Blob container are updated. `context.files` is typed as `AzureBlobMetadata[]` — read `Name`, `Path`, `Size`, `LastModified` with full IntelliSense.

### `office365App` — Office 365 Outlook

Five Outlook triggers:

| Function | Fires when… |
|---|---|
| `OnNewEmail` | A new email lands in the watched mailbox / folder |
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

Demonstrates the lower-level generic API that works for any Azure Logic Apps connector — including connectors that do not have a first-class wrapper yet. Use it when you need full control over the item type or are wiring a custom / not-yet-wrapped connector.

| Function | Connector | Item type |
|---|---|---|
| `OnGenericAzureBlobUpdated` | Azure Blob | `AzureBlobMetadata` |
| `OnGenericOffice365NewEmail` | Office 365 | `GraphClientReceiveMessage` |
| `OnGenericSharepointNewFile` | SharePoint Online | `BlobMetadata` |
| `OnGenericTeamsChannelMessage` | Teams | `ChatMessage` |
| `OnGenericCustomConnectorEvent` | _any custom connector_ | inline `CustomConnectorItem` |

The first-class `connectors.<name>.<trigger>()` helpers are preferred when available because they add named context fields on top of `items`; `genericApp` is the escape hatch when that wrapper does not exist.

> **Note:** `azd up` for `genericApp` only provisions the Functions App and its Connector Namespace — it does **not** create or authorize the underlying connections. After deploy, navigate to [connectors.azure.com](https://connectors.azure.com) to create and manage the connections referenced by each generic trigger.

## How a trigger function looks

### Preferred: first-class `connectors` namespace

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
- `context.payload` is the normalised envelope (`{ body: { value: TItem[] } }`).
- `context.rawPayload` is the original payload — useful for forwarding or persisting.

### Generic: any connector via `connectorTrigger<TItem>`

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

The following connectors in `@azure/connectors@0.2.0-preview` expose **no trigger methods** and are intentionally omitted from the trigger samples. Consume them as action clients from your handler:

| Connector | What you'd use it for | How to consume |
|---|---|---|
| `arm` | Subscription, resource group, deployment management | `new ArmClient(...)` from `@azure/connectors/generated/ArmExtensions` |
| `azuremonitorlogs` | KQL `queryData` / `visualizeQuery` | `new AzuremonitorlogsClient(...)` |
| `mq` | IBM MQ read / receive / send / delete | `new MqClient(...)` |
| `msgraphgroupsanduser` | Directory list users / groups / licenses | `new MsgraphgroupsanduserClient(...)` |
| `office365users` | User profile / photo / search | `new Office365usersClient(...)` |
| `smtp` | `sendEmail` | `new SmtpClient(...)` |

## Prerequisites

- [Node.js 20+](https://nodejs.org/) (samples target Node 20 to match the Linux Consumption Function App runtime).
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local).
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) for deployment.
- An Azure subscription.
- A configured AI Gateway connection for the connector you want to trigger on — see the [connection-setup guide](https://github.com/Azure/Connectors-NodeJS-SDK/blob/main/docs/connection-setup.md).

> The connector trigger requires the **Experimental** Functions Extension Bundle (`Microsoft.Azure.Functions.ExtensionBundle.Experimental`, version `[4.6.*, 5.0.0)`) — already pre-configured in every sample's `host.json`.

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

- Azure Storage account (Function App backing store).
- Linux Consumption Function App (Node 20) with system-assigned managed identity.
- Application Insights + Log Analytics workspace.

It then runs the `prepackage` hook (`npm install && npm run build`) and deploys the compiled output.

After provisioning, configure the connector runtime URL and token:

```bash
azd env set CONNECTOR_RUNTIME_URL '<your-connector-runtime-url>'
azd env set CONNECTOR_TOKEN '<your-token>'
azd provision   # re-runs the Bicep to push the new app settings
```

## Repository layout

```
functions-connectors-typescript/
├── README.md
├── PR_DESCRIPTION.md
├── .gitignore
├── .scaffold/                  # shared template (host.json, tsconfig, infra/, src/index.ts)
├── azureblobApp/
├── office365App/
├── onedriveApp/
├── sharepointApp/
├── teamsApp/
└── genericApp/                 # generic connectorTrigger<TItem> API
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

## Related repos

| Repo | Purpose |
|---|---|
| [Azure/Connectors-NodeJS-SDK](https://github.com/Azure/Connectors-NodeJS-SDK) | `@azure/connectors` — generated TypeScript SDK for Azure Logic Apps connectors. |
| [Azure/azure-functions-nodejs-extensions](https://github.com/Azure/azure-functions-nodejs-extensions) | `@azure/functions-extensions-connectors` — the binding extension consumed by these samples. |
