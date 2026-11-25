<!--
---
name: "Azure Functions Connector Samples (TypeScript): Microsoft Dataverse polling"
description: Receive Microsoft Dataverse row and action events with polling in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-dataverse-polling-typescript
---
-->

# Microsoft Dataverse Polling Triggers (TypeScript)

Azure Functions sample using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). With `deliveryMode: DeliveryMode.Poll`, the host receives events outbound from the Connector Namespace; no public callback or tunnel is needed.

Each function is in its own file under `src/functions/`, uses the raw `app.connectorTrigger` API with an `unknown` payload, and logs only the trigger name.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnDataverseRowChanged` | [`SubscribeWebhookTrigger`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-added,-modified-or-deleted) | Row added, modified or deleted (`message=7`, `scope=4`) |
| `OnDataverseActionPerformed` | [`BusinessEventsTrigger`](https://learn.microsoft.com/connectors/commondataservice/#when-an-action-is-performed) | Selected action performed |
| `OnDataverseRowAdded` | [`SubscribeOnNewItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-added-%5Bdeprecated%5D) | When a row is added |
| `OnDataverseRowModified` | [`SubscribeOnUpdatedItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-modified-%5Bdeprecated%5D) | When a row is modified |
| `OnDataverseRowDeleted` | [`SubscribeOnDeletedItems`](https://learn.microsoft.com/connectors/commondataservice/#when-a-row-is-deleted-%5Bdeprecated%5D) | When a row is deleted |

The connector is [Microsoft Dataverse (`commondataservice`)](https://learn.microsoft.com/connectors/commondataservice/); its separate row operations are marked deprecated in connector metadata. They overlap the combined row-change event, so one row change can invoke both.

## Prerequisites

- [Node.js 24](https://nodejs.org/) or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell 7 (`pwsh`) on Windows, used by the `azd` hooks in `azure.yaml`
- A Dataverse environment and an account permitted to register organization-scoped events
- For local development: [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
- The [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli) with `connection authenticate` support:

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

```bash
cd dataverseApp/polling
az login
azd auth login
azd env new dataverse-polling
azd up
```

Complete the Dataverse OAuth sign-in in your browser when prompted. First choose **Configure** or **Skip** for every trigger; at least one must be configured. Setup then collects environment, table, scope, and action inputs only for selected triggers. Infrastructure provisions selected Poll triggers as **Enabled** after consent, then deploys the Function App with the trigger's polling endpoint before deploying the code. Use a different azd environment from the webhook sample. To retry an interrupted trigger setup, run `azd provision triggers`, `azd provision app`, and `azd deploy`.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `AZURE_LOCATION` | Function App region; prompted if unset |
| `CONNECTOR_NAMESPACE_LOCATION` | Connector Namespace region; default `brazilsouth` |
| `POLLING_TRIGGER_INPUTS` | Saved trigger selections, reused on reruns; clear with `azd env set POLLING_TRIGGER_INPUTS=` and rerun `azd provision triggers` to select again |
| `<Function>TriggerConfigName` | Trigger configuration name per function (see `local.settings.example.json`) |
| `AzureWebJobs.<Function>.Disabled` | Set in Function App infrastructure; `true` for skipped triggers |

Setup prompts only for required selectors. If a picker returns no choices, enter the actual connector identifier, or leave it blank to skip that trigger. Run `azd provision app` and `azd deploy` after changing selections. Action-performed needs a real catalog, category, table, and action available to the signed-in user.

At least one trigger must be configured. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment.

**What Skip means:** The function code is still deployed, but its listener is disabled with `AzureWebJobs.<Function>.Disabled=true`. Setup creates no connector trigger configuration for that function in the namespace. If this sample previously created one, setup disables it instead of deleting it.

## Local development

Stop the deployed Function App or use separate trigger configurations to avoid competing listeners.

1. Prepare `local.settings.json`. `azd up` creates it with the polling endpoint and trigger config names; existing files are preserved. Otherwise run `npm run setup:local` and fill in the placeholders.
2. Sign in with the developer identity granted connection access:

   ```bash
   az login
   ```

3. Start Azurite in a separate terminal:

   ```bash
   azurite
   ```

4. Install, build, and start:

   ```bash
   npm ci
   npm run build
   func start
   ```

## Verify

In [Connector Namespaces](https://connectors.azure.com/), check the connection is **Connected** and the selected trigger configurations are **Enabled**.

Create, modify, and delete a test row, then look for `Received OnDataverseRowChanged trigger.` (and the matching `Received <Function> trigger.` logs for other selected triggers). Delivery is at least once; make processing idempotent.

Remove this environment's Azure resources from this folder:

```bash
azd down --purge
```

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Microsoft Dataverse connector reference](https://learn.microsoft.com/connectors/commondataservice/)
