# kustoApp

Azure Functions sample app demonstrating the **Azure Data Explorer (Kusto)** connector triggers from
[`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors).

## Triggers included

- `onKustoQueryResult`

## Run locally

`ash
npm install
npm start
`

Update `local.settings.json` with your connector runtime URL and access token before starting.

## Deploy to Azure

`azd up` will provision a Linux Consumption Function App (Node 20), a Storage account, Application Insights,
and Log Analytics, then build and deploy the TypeScript code.

`ash
azd auth login
azd up
`

At the end of provisioning, configure the connector runtime URL and token on the Function App:

`ash
azd env set CONNECTOR_RUNTIME_URL '<your-connector-runtime-url>'
azd env set CONNECTOR_TOKEN '<your-token>'
azd provision
`

The connector trigger requires the **Experimental** Functions Extension Bundle (`Microsoft.Azure.Functions.ExtensionBundle.Experimental`).
This is already configured in `host.json`.

## Project layout

`
kustoApp/
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
