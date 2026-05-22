# genericApp

Azure Functions sample using **`app.connectorTrigger` from [`@azure/functions`](https://www.npmjs.com/package/@azure/functions) directly** — with item types pulled from the [`@azure/connectors`](https://www.npmjs.com/package/@azure/connectors) generated SDK.

> **No dependency on `@azure/functions-extensions-connectors`.**

Use this approach when you want to:

- Avoid the extension package entirely and depend only on `@azure/functions` + (optionally) `@azure/connectors`.
- Bind a trigger for a connector that does **not** have a first-class wrapper in the extension package.
- Define a custom item shape (partial / extended / not-yet-in-SDK).

## How it works

`app.connectorTrigger` delivers the raw AI Gateway payload to your handler. The payload follows the standard envelope shape — modelled by `TriggerCallbackPayload<TItem>` in `@azure/connectors`:

```jsonc
{
    "body": {
        "value": [ /* TItem[] */ ]
    }
}
```

A tiny shared helper `unwrapTriggerPayload` (in [`src/unwrapTriggerPayload.ts`](./src/unwrapTriggerPayload.ts)) handles:

- string-vs-object normalisation (`typeof triggerInput === 'string' ? JSON.parse(...) : ...`)
- the `payload.body?.value ?? []` unwrap

Each function then imports its connector-specific item type from `@azure/connectors/generated/<Connector>Extensions` and types the unwrap call accordingly.

## Triggers included

| Function | Connector | Item type | Source |
|---|---|---|---|
| `OnGenericAzureBlobUpdated` | Azure Blob | `BlobMetadata` | `@azure/connectors/generated/AzureblobExtensions` |
| `OnGenericOffice365NewEmail` | Office 365 | `GraphClientReceiveMessage` | `@azure/connectors/generated/Office365Extensions` |
| `OnGenericSharepointNewFile` | SharePoint Online | `BlobMetadata` | `@azure/connectors/generated/SharepointonlineExtensions` |
| `OnGenericTeamsChannelMessage` | Teams | `ChatMessage` | `@azure/connectors/generated/TeamsExtensions` |
| `OnGenericCustomConnectorEvent` | _any custom connector_ | inline `CustomConnectorItem` | declared in the function file |

## Example: full trigger function

```typescript
import { BlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

app.connectorTrigger('OnGenericAzureBlobUpdated', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        const [, files] = unwrapTriggerPayload<BlobMetadata>(triggerInput);

        for (const file of files) {
            context.log(`Name: '${file.Name}'.`);
        }

        return triggerInput;
    },
});
```

## Dependencies

```jsonc
{
    "dependencies": {
        "@azure/connectors": "0.2.0-preview",   // only for generated item types + TriggerCallbackPayload
        "@azure/functions":  "^4.16.0"
    }
}
```

You can drop `@azure/connectors` entirely if you declare item types inline (see `OnGenericCustomConnectorEvent`).

## When to use this vs. the extension package

| Use case | API |
|---|---|
| Connector wrapped in `connectors.<x>.<y>()` (e.g. SharePoint, Teams) | `connectors.<connector>.<trigger>()` from `@azure/functions-extensions-connectors` (preferred — named context fields like `files`, `messages`, automatic envelope unwrap, `rawPayload` accessor) |
| You don't want the extension dep | `app.connectorTrigger(...)` from `@azure/functions` + `TriggerCallbackPayload<TItem>` from `@azure/connectors` (this sample) |
| Connector without any SDK type at all | `app.connectorTrigger(...)` + inline type (`OnGenericCustomConnectorEvent`) |

The extension package is essentially a typed wrapper around `app.connectorTrigger` that does the same unwrap + JSON-parse logic shown in [`src/unwrapTriggerPayload.ts`](./src/unwrapTriggerPayload.ts).

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
│   ├── index.ts                    # app.setup({ enableHttpStream: true })
│   ├── unwrapTriggerPayload.ts     # shared envelope-unwrap helper
│   └── functions/                  # one file per generic trigger
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
