# Office 365 Outlook Polling Triggers (TypeScript)

Azure Functions sample for the [Office 365 Outlook connector](https://learn.microsoft.com/connectors/office365/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/` and logs only the trigger name and item count.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnNewEmail` | [`OnNewEmailV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-arrives-(v3)) | New email in `Inbox`; batched (up to 4 events per invocation) |
| `OnFlaggedEmail` | [`OnFlaggedEmailV4`](https://learn.microsoft.com/connectors/office365/#when-an-email-is-flagged-(v4)-(preview)) | Flagged email (preview) |
| `OnNewMentionMeEmail` | [`OnNewMentionMeEmailV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-mentioning-me-arrives-(v3)) | Email mentioning me |
| `OnCalendarNewItems` | [`CalendarGetOnNewItemsV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-event-is-created-(v3)) | New event |
| `OnCalendarUpdatedItems` | [`CalendarGetOnUpdatedItemsV3`](https://learn.microsoft.com/connectors/office365/#when-an-event-is-modified-(v3)) | Modified event |
| `OnUpcomingEvent` | [`OnUpcomingEventsV3`](https://learn.microsoft.com/connectors/office365/#when-an-upcoming-event-is-starting-soon-(v3)) | Upcoming event |
| `OnSharedMailboxNewEmail` | [`SharedMailboxOnNewEmailV2`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-arrives-in-a-shared-mailbox-(v2)) | Shared mailbox email (opt-in) |
| Not included | [`CalendarGetOnChangedItemsV3`](https://learn.microsoft.com/connectors/office365/#when-an-event-is-added,-updated-or-deleted-(v3)) | Event added, updated or deleted; preview subscription fails with missing `TABLE` |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later, signed in with permission to read and write trigger configurations in the Connector Namespace
- PowerShell 7 (`pwsh`) on Windows, used by the `azd` hooks
- An Office 365 mailbox and permission to authorize the connection
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and Azurite for local development
- [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli), used for OAuth consent:

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  Or in PowerShell:

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

```bash
cd office365App/polling
az login
azd auth login
azd env new office365-polling
azd up
```

Run `azd up` in an interactive terminal: setup opens the OAuth sign-in for the mailbox account to monitor, then prompts for inputs such as the calendar through live connector pickers. Infrastructure provisions selected Poll triggers as **Enabled** after consent, then deploys the Function App with the trigger's polling endpoint before deploying the code. Use a different azd environment from webhook.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `OnSharedMailboxNewEmail` prompt | Choose **Configure** during setup to monitor a shared mailbox; full mailbox access required |
| `azd env set POLLING_TRIGGER_INPUTS=` then `azd provision triggers` | Clear saved trigger selections and inputs and prompt again |
| `azd provision triggers` | Rerun consent and trigger setup without reprovisioning base resources; then run `azd provision app` and `azd deploy` |

Setup first asks **Configure** or **Skip** for every trigger, then collects inputs only for selected triggers. Trigger configuration names come from the `<Function>TriggerConfigName` settings in `local.settings.example.json`.

At least one trigger must be configured. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment.

**What Skip means:** The function code is still deployed, but its listener is disabled with `AzureWebJobs.<Function>.Disabled=true`. Setup creates no connector trigger configuration for that function in the namespace. If this sample previously created one, setup disables it instead of deleting it.

## Local development

If the Function App is already deployed, stop it before running locally to avoid competing listeners.

1. Prepare `local.settings.json`.

   Use the file generated during successful `azd up`; an existing file is never overwritten. Only if it is missing, rerun:

   ```bash
   azd hooks run predeploy
   ```

2. Sign in with your developer account for local credentials.

   ```bash
   az login
   ```

3. Start Azurite in a separate terminal.

   ```bash
   azurite
   ```

4. Install dependencies, build, and start the local Functions host.

   ```bash
   npm ci
   npm run build
   func start
   ```

Do not copy cloud managed-identity settings locally. Never commit local settings.

## Verify

Check the connection is **Connected** and selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Generate mail/calendar events and check logs for `Received <FunctionName> trigger (<Count> items).`; build/deployment success alone is not real-event verification. Delivery is at least once and source detection may be delayed.

Run `azd down --purge` when finished to remove deployed resources.

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Office 365 Outlook connector reference](https://learn.microsoft.com/connectors/office365/)
