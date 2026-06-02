# office365App

Azure Functions sample app demonstrating the **Office 365 Outlook** connector triggers from
[`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors).

## Triggers included

- `onNewEmail`
- `onFlaggedEmail`
- `onNewMentionMeEmail`
- `onNewCalendarEvent`
- `onUpcomingEvent`

## Run locally

`ash
npm install
npm start
`

Update `local.settings.json` with your connector runtime URL and access token before starting.

## Deploy to Azure

`azd up` will provision a Flex Consumption Function App (Node 20), a Storage account,
Application Insights, Log Analytics, and a **Connector Namespace** with an Office 365
Outlook connection. After deployment, an `azd` postdeploy hook
(`infra/scripts/postdeploy.ps1` / `.sh`) uses the
[`connector-namespace`](https://github.com/Azure/Connectors) Azure CLI extension to:

1. Create one Connector Namespace **trigger config** per Functions trigger
   in this app, each pointing at the function's connector webhook URL.
2. Walk you through **OAuth consent** for the Office 365 connection by
   opening the consent link in your browser and polling until the
   connection flips to `Connected`.

```sh
azd auth login
azd up
```

The Bash script requires `jq`. The PowerShell script requires PowerShell 7+ (`pwsh`).

> Connector Namespace currently requires the `brazilsouth` region (the only
> region with the required preview features as of writing). Override via
> `azd env set CONNECTOR_NAMESPACE_LOCATION <region>` if needed.

To re-run only the post-deployment configuration without redeploying code:

```sh
azd hooks run postdeploy
```

The connector trigger requires the **Preview** Functions Extension Bundle
(`Microsoft.Azure.Functions.ExtensionBundle.Preview`). This is already configured in `host.json`.

## Project layout

`
office365App/
├── src/
│   ├── index.ts              # app.setup({ enableHttpStream: true })
│   └── functions/            # one file per trigger
├── infra/
│   ├── main.bicep            # azd entrypoint (subscription scope)
│   ├── resources.bicep       # Storage + App Insights + Function App
│   └── main.parameters.json
├── azure.yaml
├── host.json
├── local.settings.json
├── package.json
└── tsconfig.json
`

