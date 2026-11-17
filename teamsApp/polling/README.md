# Microsoft Teams Polling Triggers (TypeScript)

Azure Functions sample for the [Microsoft Teams connector](https://learn.microsoft.com/connectors/teams/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors) with `deliveryMode: DeliveryMode.Poll`. The host receives events outbound from the Connector Namespace; no public callback or tunnel is required. Each function is in its own file under `src/functions/`. Typed handlers (`connectors.teams.*`) log only `Received <FunctionName> trigger (<Count> items).`; RAW handlers (`app.connectorTrigger`) return the event envelope unchanged and log `Received <FunctionName> trigger.`

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnNewChannelMessage` | [`OnNewChannelMessage`](https://learn.microsoft.com/connectors/teams/#when-a-new-channel-message-is-added) | New root channel message |
| `OnNewChannelMessageMentioningMe` | [`OnNewChannelMessageMentioningMe`](https://learn.microsoft.com/connectors/teams/#when-i-am-mentioned-in-a-channel-message) | Channel message mentioning the connection user |
| `OnGroupMembershipAdd` | [`OnGroupMembershipAdd`](https://learn.microsoft.com/connectors/teams/#when-a-new-team-member-is-added) | Team member added |
| `OnGroupMembershipRemoval` | [`OnGroupMembershipRemoval`](https://learn.microsoft.com/connectors/teams/#when-a-new-team-member-is-removed) | Team member removed |
| `OnWebhookChatMessage` | [`WebhookChatMessageTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-new-chat-message-is-added) | New chat message (opt-in, RAW) |
| `OnWebhookNewMessage` | [`WebhookNewMessageTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-new-message-is-added-to-a-chat-or-channel) | New chat/channel message (opt-in, RAW) |
| `OnWebhookAtMention` | [`WebhookAtMentionTrigger`](https://learn.microsoft.com/connectors/teams/#when-i'm-@mentioned) | @mention (opt-in, RAW) |
| `OnWebhookKeyword` | [`WebhookKeywordTrigger`](https://learn.microsoft.com/connectors/teams/#when-keywords-are-mentioned) | Keyword mention (opt-in, RAW) |
| `OnWebhookMessageReaction` | [`WebhookMessageReactionTrigger`](https://learn.microsoft.com/connectors/teams/#when-someone-reacted-to-a-message-in-chat) | Message reaction (opt-in, RAW) |
| `OnRecordingAvailable` | [`RecordingTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-recording-is-available) | Recording available (opt-in, RAW) |
| `OnTranscriptAvailable` | [`TranscriptTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-transcript-is-available) | Transcript available (opt-in, RAW) |

`Webhook` operation-name prefixes describe connector source subscriptions, not Functions delivery; those operations still use Poll delivery here.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later, signed in with permission to read and write trigger configurations in the Connector Namespace
- PowerShell 7 (`pwsh`) on Windows, used by the `azd` hooks
- A Teams account with team/channel access and permission to authorize the connection
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
cd teamsApp/polling
az login
azd auth login
azd env new teams-polling
azd up
```

Run `azd up` in an interactive terminal: setup opens the OAuth sign-in, then collects the team, channel, and operation-specific inputs through live connector pickers. Infrastructure provisions selected Poll triggers as **Enabled** after consent, then deploys the Function App with the trigger's polling endpoint before deploying the code. Use a different azd environment from webhook.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| Opt-in trigger prompts | Choose **Skip** or **Configure** for each of the seven RAW triggers during setup |
| `azd env set POLLING_TRIGGER_INPUTS=` then `azd provision triggers` | Clear saved trigger selections and inputs and prompt again |
| `azd provision triggers` | Rerun consent and trigger setup without reprovisioning base resources; then run `azd provision app` and `azd deploy` |

The four typed triggers are always configured. Function App infrastructure sets `AzureWebJobs.<Function>.Disabled`, and new local settings contain the same flags, so unselected listeners stay disabled; deselected sample-owned Poll configurations are disabled, not deleted. `OnWebhookChatMessage` monitors all chats of the connection user, and recording/transcript triggers need appropriate meeting licenses and policies. Selections are saved as `POLLING_TRIGGER_INPUTS` in the azd environment and reused on redeployment. Trigger configuration names come from the `<Function>TriggerConfigName` settings in `local.settings.example.json`.

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

Check the connection is **Connected** and selected triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Post a new root channel message, not a reply, and look for `Received OnNewChannelMessage trigger` in logs. Opt-in triggers require their scoped source action and prerequisites. Allow upstream detection delays; delivery is at least once.

Run `azd down --purge` when finished to remove deployed resources.

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md#microsoft-teams-connector)
- [Microsoft Teams connector reference](https://learn.microsoft.com/connectors/teams/)
