# Kusto Query-Result Callback Sample

Azure Functions app covering the extension's `connectors.kusto.onQueryResult` helper.

| Function | Context | Named property |
| -------- | ------- | -------------- |
| [OnKustoQueryResult](src/functions/onKustoQueryResult.ts) | `QueryResultTriggerContext` | `rows: KustoRow[]` |

Kusto rows have dynamic columns (`[key: string]: unknown`), so the handler logs each row as JSON without inventing a schema or casting column values. It returns the original callback payload unchanged.

**This SDK release exports no Kusto trigger-operation or trigger-parameter metadata.** `onQueryResult` registers a typed Functions handler; it does not create a Kusto subscription or run a query. Do not use a fabricated `OnQueryResult` operation with `az connector-namespace trigger create`.

## Prerequisites and local development

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js 24+. A live workflow needs permission to query the intended Azure Data Explorer cluster and database.

From this folder:

```sh
npm ci
npm test
npm start
```

Configure [local.settings.json](local.settings.json) without committing credentials and run Azurite for development storage. The offline tests invoke the real typed wrapper with synthetic rows; they do not execute KQL or call Azure.

## Deploy and deliver results

Keep the full repository checkout: [infra/main.bicep](infra/main.bicep) reuses [genericApp's deployment module](../genericApp/infra/main.bicep) to provision a Node.js 24 Flex Consumption Function App, host storage, and monitoring.

```sh
az login
azd auth login
azd up
```

Use a unique azd environment. Deployment does not provision a Connector Namespace, Kusto connection, scheduler, query, or subscription.

Configure a separate, verified workflow that delivers compatible query-result callbacks to:

```text
https://<functions-host>/runtime/webhooks/connector?functionName=OnKustoQueryResult
```

Keep the connector extension system key in the callback authentication configuration, not source control. The wrapper expects an envelope such as:

```json
{ "body": { "value": [{ "Result": "test-row", "Count": 1 }] } }
```

Follow the [manual setup guidance](../README.md#manual-connector-setup) for connection/authentication concepts, but only provision operations supported by the actual result-delivery workflow. Confirm its callback contract and inspect Function App logs with a test row before relying on live delivery.
