<!--
---
name: "Azure Functions Connector Samples (TypeScript): Office 365 Outlook webhook"
description: Receive Office 365 Outlook email and calendar events with webhooks in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-office365-webhook-typescript
---
-->

# Office 365 Outlook Webhook Triggers (TypeScript)

Azure Functions sample for the [Office 365 Outlook connector](https://learn.microsoft.com/connectors/office365/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/` and logs `<FunctionName> trigger received.` followed by email or event metadata, so use a test account.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnNewEmail` | [`OnNewEmailV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-arrives-(v3)) | New email |
| `OnFlaggedEmail` | [`OnFlaggedEmailV4`](https://learn.microsoft.com/connectors/office365/#when-an-email-is-flagged-(v4)-(preview)) | Flagged email (preview) |
| `OnNewMentionMeEmail` | [`OnNewMentionMeEmailV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-mentioning-me-arrives-(v3)) | Email mentioning me |
| `OnCalendarNewItems` | [`CalendarGetOnNewItemsV3`](https://learn.microsoft.com/connectors/office365/#when-a-new-event-is-created-(v3)) | New event |
| `OnCalendarUpdatedItems` | [`CalendarGetOnUpdatedItemsV3`](https://learn.microsoft.com/connectors/office365/#when-an-event-is-modified-(v3)) | Modified event |
| `OnCalendarChangedItems` | [`CalendarGetOnChangedItemsV3`](https://learn.microsoft.com/connectors/office365/#when-an-event-is-added,-updated-or-deleted-(v3)) | Event added, updated or deleted |
| `OnUpcomingEvent` | [`OnUpcomingEventsV3`](https://learn.microsoft.com/connectors/office365/#when-an-upcoming-event-is-starting-soon-(v3)) | Upcoming event (15-minute look-ahead) |
| `OnSharedMailboxNewEmail` | [`SharedMailboxOnNewEmailV2`](https://learn.microsoft.com/connectors/office365/#when-a-new-email-arrives-in-a-shared-mailbox-(v2)) | Shared mailbox email (opt-in) |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell for the Windows hook (`postdeploy.ps1`), or Bash and `jq` for the macOS/Linux hook (`postdeploy.sh`)
- An Office 365 mailbox and permission to authorize the connection
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and Azurite for local development
- [`connector-namespace` CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli):

  ```bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  Or in PowerShell:

  ```powershell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Deploy to Azure

```bash
cd office365App/webhook
az login
azd auth login
azd env new office365-webhook
azd up
```

Complete the OAuth sign-in opened by `azd up` with the mailbox account to monitor. The postdeploy hook then creates one trigger configuration per function, using `Inbox` for email triggers and `Calendar` for calendar triggers, with callbacks to the deployed Function App. Use a different azd environment from polling.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `OFFICE365_SHARED_MAILBOX_ADDRESS=<address>` | Shared mailbox email for `OnSharedMailboxNewEmail` (monitors its `Inbox`); full mailbox access required |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `azd hooks run postdeploy` | Rerun consent and trigger registration without redeploying |

Set values with `azd env set` before `azd up`, or rerun the hook afterwards. Without a shared mailbox address, its subscription is skipped with a warning; the handler still registers. Hook reruns delete and recreate the sample's trigger configurations.

## Local development

1. Create `local.settings.json` from the example (an existing file is preserved).

   ```bash
   npm run setup:local
   ```

2. Start Azurite in a separate terminal.

   ```bash
   azurite
   ```

3. Install dependencies, build, and start the local Functions host with authentication enabled.

   ```bash
   npm ci
   npm run build
   func start --enableAuth
   ```

   Core Tools v4 bypasses local key authentication by default. Use `--enableAuth` before exposing the host through a public tunnel so callback requests must present the system key.

4. Expose port 7071 over public HTTPS. Get the **local** `connector_extension` system key from Azurite's `azure-webjobs-secrets`, not the Azure Function App's key or a function key. Keep it private.

5. The postdeploy hook only targets the deployed Function App. Register a **separate** trigger configuration with `az connector-namespace trigger create` whose callback is `https://<tunnel-host>/runtime/webhooks/connector?functionName=<FunctionName>`, authenticated with the local key as the `code` query parameter. Delete it with `az connector-namespace trigger delete` when finished.

Functions host storage is required. Never commit keys, callback URLs, or local settings.

## Verify

Check the connection is **Connected** and triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Send an email to the connected account or create a calendar event, then check logs for `<FunctionName> trigger received.`; build/deployment success alone is not real-event verification. Delivery is at least once and source detection may be delayed.

Run `azd down --purge` when finished to remove deployed resources.

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md)
- [Office 365 Outlook connector reference](https://learn.microsoft.com/connectors/office365/)
