# genericApp

Azure Functions sample demonstrating the **generic `connectorTrigger<TItem>` API** from
[`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors).

Use the generic API when you want to:

- Bind a trigger for a connector that does **not** have a first-class wrapper yet.
- Define your own item shape (custom or partial types).
- Bypass the typed `connectors.<connector>.<trigger>()` helpers entirely.

> The function **name** still binds to the connector + operation on the host side. The
> generic API only changes how the handler is declared in TypeScript — it does **not**
> change which operation the function listens to.

## Triggers included

| Function | Connector | Item type |
|---|---|---|
| `OnGenericAzureBlobUpdated` | Azure Blob | `AzureBlobMetadata` |
| `OnGenericOffice365NewEmail` | Office 365 | `GraphClientReceiveMessage` |
| `OnGenericSharepointNewFile` | SharePoint Online | `BlobMetadata` |
| `OnGenericTeamsChannelMessage` | Teams | `ChatMessage` |
| `OnGenericCustomConnectorEvent` | _any custom connector_ | inline `CustomConnectorItem` |

Each handler receives a `ConnectorTriggerContext<TItem>`:

- `context.items` — the typed item array (`TItem[]`).
- `context.payload` — the full envelope `{ body: { value: TItem[] } }`.
- `context.rawPayload` — the original payload object.
- `context.toJSON()` — serialised payload (useful for output bindings).

## When to use this vs. the first-class API

| Use case | API |
|---|---|
| Connector wrapped in `connectors.<x>.<y>()` (e.g. SharePoint, Teams) | `connectors.<connector>.<trigger>()` (preferred — named context fields like `files`, `messages`) |
| Connector without a first-class wrapper | `connectorTrigger<TItem>(...)` (this sample) |
| Custom payload type / partial type | `connectorTrigger<MyType>(...)` (this sample) |

## Run locally

```bash
npm install
npm start
```

Update `local.settings.json` with the runtime URL and token for each connection you want to trigger on.

## Deploy to Azure

```bash
azd auth login
azd up
azd env set CONNECTOR_RUNTIME_URL '<your-connector-runtime-url>'
azd env set CONNECTOR_TOKEN '<your-token>'
azd provision
```

## Project layout

```
genericApp/
├── src/
│   ├── index.ts              # app.setup({ enableHttpStream: true })
│   └── functions/            # one file per generic trigger
├── infra/
│   ├── main.bicep
│   ├── resources.bicep
│   └── main.parameters.json
├── azure.yaml
├── host.json
├── local.settings.json
├── package.json
└── tsconfig.json
```
