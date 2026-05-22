# Azure Functions Connectors — TypeScript Samples

End-to-end TypeScript samples demonstrating [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) — the strongly-typed binding layer for Azure Logic Apps connectors in Azure Functions (Node.js).

Each sample is an independent Azure Functions app, organised by connector and deployable with a single `azd up`.

## Samples

| App | Connector | Triggers demonstrated |
|---|---|---|
| [`azureblobApp/`](./azureblobApp) | Azure Blob | `onUpdatedFile` |
| [`kustoApp/`](./kustoApp) | Azure Data Explorer (Kusto) | `onQueryResult` |
| [`office365App/`](./office365App) | Office 365 Outlook | `onNewEmail`, `onFlaggedEmail`, `onNewMentionMeEmail`, `onNewCalendarEvent`, `onUpcomingEvent` |
| [`onedriveApp/`](./onedriveApp) | OneDrive for Business | `onNewFile`, `onUpdatedFile` |
| [`sharepointApp/`](./sharepointApp) | SharePoint Online | `onNewFile`, `onUpdatedFile` |
| [`teamsApp/`](./teamsApp) | Microsoft Teams | `onNewChannelMessage`, `onNewChannelMessageMentioningMe`, `onGroupMembershipAdd`, `onGroupMembershipRemoval` |

## Prerequisites

- [Node.js 20+](https://nodejs.org/) (the connector extension package targets `>=24.0.0`; samples relax to `>=20.0.0` for broader runtime support).
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

Update `local.settings.json` with the runtime URL and access token for your connector before starting.

## Deploy a sample to Azure

```bash
cd <connectorApp>
azd up
```

`azd up` provisions:

- An Azure Storage account (Function App backing store)
- A Linux Consumption Function App running Node 20
- Application Insights for observability

After provisioning, `azd` packages the TypeScript app, transpiles it, and deploys.

> **Note:** The connector trigger itself requires the **Experimental** Functions Extension Bundle (`Microsoft.Azure.Functions.ExtensionBundle.Experimental`, version `[4.6.*, 5.0.0)`) and a valid connector runtime URL/token. Configure them as app settings on the deployed Function App before invoking the triggers (see each app's README).

## Repo layout

```
functions-connectors-typescript/
├── azureblobApp/
├── kustoApp/
├── office365App/
├── onedriveApp/
├── sharepointApp/
├── teamsApp/
└── README.md
```

Each app folder contains:

```
<connectorApp>/
├── src/
│   ├── index.ts                # app.setup() entry
│   └── functions/              # one file per trigger
├── infra/
│   ├── main.bicep              # Storage + Function App + App Insights
│   └── main.parameters.json
├── azure.yaml                  # azd service definition
├── host.json                   # extension bundle + logging
├── local.settings.json         # local connector runtime URL + token placeholders
├── package.json
├── tsconfig.json
└── README.md
```
