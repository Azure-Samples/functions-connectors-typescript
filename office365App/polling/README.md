# Office 365 Outlook Polling Triggers (TypeScript)

Azure Functions sample for the [Office 365 Outlook connector](https://learn.microsoft.com/connectors/office365/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) and [@azure/connectors](https://www.npmjs.com/package/@azure/connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/` and logs only the trigger name and item count.

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
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later, signed in with permission to read and write trigger configurations in the Connector Namespace
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

Run `azd up` in an interactive terminal: the postdeploy hook (`node ./infra/scripts/postdeploy.mjs`) opens the OAuth sign-in, which you complete with the mailbox account to monitor, then prompts for trigger inputs such as the calendar through live connector pickers. Use a different azd environment from webhook.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `OnSharedMailboxNewEmail` prompt | Choose **Configure** during postdeploy to monitor a shared mailbox; full mailbox access required |
| `azd env set POLLING_TRIGGER_INPUTS ""` then `azd hooks run postdeploy` | Clear saved trigger selections and inputs and prompt again |
| `azd hooks run postdeploy` | Rerun consent and trigger setup without redeploying |

Postdeploy asks **Skip** or **Configure** for each optional trigger and writes `AzureWebJobs.<Function>.Disabled` to the Function App settings and new local settings, so unselected listeners stay disabled. Deselected sample-owned Poll configurations are disabled, not deleted. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment. Trigger configuration names come from the `<Function>TriggerConfigName` settings in `local.settings.example.json`.

## Local development

If the Function App is already deployed, stop it before running locally to avoid competing listeners.

1. Prepare `local.settings.json`.

   Use the file generated during successful `azd up`; an existing file is never overwritten. Only if it is missing, rerun:

   ```bash
   azd hooks run postdeploy
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

- [Operations to Functions Signature Mapping](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Office 365 Outlook connector reference](https://learn.microsoft.com/connectors/office365/)
