# sharepointApp

Azure Functions sample app demonstrating the **SharePoint Online** connector triggers from
[`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors).

## Triggers included

| Function | Connector operation | Description |
| --- | --- | --- |
| `onSharepointNewFile`     | `OnNewFile`     | Fires when a new file is created in the configured library/folder |
| `onSharepointUpdatedFile` | `OnUpdatedFile` | Fires when an existing file in the configured library/folder is modified |

## Run locally

```sh
npm install
npm start
```

Update `local.settings.json` with your connector runtime URL and access token before starting.

## Deploy to Azure

`azd up` will provision:

- A Flex Consumption Function App (Node 20)
- A Storage account, Application Insights, Log Analytics
- A **Connector Namespace** (`Microsoft.Web/connectorGateways`) containing:
  - A **SharePoint Online connection**
  - Two **trigger configs**, one per Functions trigger above, each routed to
    the corresponding function's connector webhook URL

```sh
azd auth login
azd up
```

During the postdeploy step, if `SHAREPOINT_SITE_ADDRESS` / `SHAREPOINT_FOLDER_ID`
aren't already set on the azd environment, the script prompts you to enter
them and persists the answers via `azd env set` so subsequent runs are
non-interactive.

To skip the prompt (e.g. for CI), set them ahead of time:

```sh
azd env set SHAREPOINT_SITE_ADDRESS https://contoso.sharepoint.com/sites/MySite
azd env set SHAREPOINT_FOLDER_ID    "/Shared Documents"
```

After provisioning, an `azd` postdeploy hook
(`infra/scripts/postdeploy.ps1` / `.sh`) uses the
[`connector-namespace`](https://github.com/Azure/Connectors) Azure CLI extension to:

1. Ensure the SharePoint connection exists and grant your user access to it.
2. Walk you through **OAuth consent** by opening the consent link in your
   browser and polling until the connection flips to `Connected`.
3. Create one **trigger config** per Functions trigger, each bound to the
   SharePoint connection and parameterized with `SHAREPOINT_SITE_ADDRESS` /
   `SHAREPOINT_FOLDER_ID`.

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

## Verify the Connector Namespace, connection, and triggers

After `azd up` finishes, open the **Connector Namespaces** portal to verify
the resource was provisioned and that both triggers are wired to a
`Connected` SharePoint Online connection:

[Connectors — Connector Namespaces](https://connectors.azure.com/)

You should see:

- One **Connection** (SharePoint Online) with status **Connected**
- Two **Triggers** (one per function), each in **Enabled** state and bound
  to the connection above

![Connector Namespace overview showing connection and triggers](./docs/connector-namespace-overview-sharepoint.png)

If a trigger is not listed or the connection shows as `Unauthenticated`,
re-run `azd hooks run postdeploy` and complete the consent flow when prompted.

## Project layout

```
sharepointApp/
├── src/
│   ├── index.ts              # app.setup({ enableHttpStream: true })
│   └── functions/            # one file per trigger
├── infra/
│   ├── main.bicep            # azd entrypoint (subscription scope)
│   ├── resources.bicep       # Storage + App Insights + Function App
│   ├── connectorNamespace.bicep  # Connector Namespace + SharePoint connection
│   ├── main.parameters.json
│   └── scripts/
│       ├── postdeploy.ps1    # Creates trigger configs + OAuth consent (Windows)
│       └── postdeploy.sh     # Creates trigger configs + OAuth consent (Linux/macOS)
├── azure.yaml
├── host.json
├── local.settings.json
├── package.json
└── tsconfig.json
```
