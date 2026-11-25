<!--
---
name: "Azure Functions Connector Samples (TypeScript): Microsoft Teams webhook"
description: Receive Microsoft Teams message, membership, and meeting events with webhooks in a TypeScript Azure Functions app deployed using azd.
page_type: sample
languages:
- typescript
- bicep
- azdeveloper
products:
- azure
- azure-functions
urlFragment: functions-connectors-teams-webhook-typescript
---
-->

# Microsoft Teams Webhook Triggers (TypeScript)

Azure Functions sample for the [Microsoft Teams connector](https://learn.microsoft.com/connectors/teams/) using [@azure/functions-extensions-connectors](https://www.npmjs.com/package/@azure/functions-extensions-connectors). The Connector Namespace delivers events to the function's public HTTPS callback. Each function is in its own file under `src/functions/`: four use typed `connectors.teams.*` helpers and seven use the generic `connectorTrigger<T>` API. Handlers log `<FunctionName> trigger received.` followed by message, member, or event content, so use a test account.

| Function | Connector operation | Description |
| --- | --- | --- |
| `OnNewChannelMessage` | [`OnNewChannelMessage`](https://learn.microsoft.com/connectors/teams/#when-a-new-channel-message-is-added) | New root channel message |
| `OnNewChannelMessageMentioningMe` | [`OnNewChannelMessageMentioningMe`](https://learn.microsoft.com/connectors/teams/#when-i-am-mentioned-in-a-channel-message) | Channel message mentioning the connection user |
| `OnGroupMembershipAdd` | [`OnGroupMembershipAdd`](https://learn.microsoft.com/connectors/teams/#when-a-new-team-member-is-added) | Team member added |
| `OnGroupMembershipRemoval` | [`OnGroupMembershipRemoval`](https://learn.microsoft.com/connectors/teams/#when-a-new-team-member-is-removed) | Team member removed |
| `OnWebhookChatMessage` | [`WebhookChatMessageTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-new-chat-message-is-added) | New chat message (opt-in) |
| `OnWebhookNewMessage` | [`WebhookNewMessageTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-new-message-is-added-to-a-chat-or-channel) | New chat/channel message (opt-in) |
| `OnWebhookAtMention` | [`WebhookAtMentionTrigger`](https://learn.microsoft.com/connectors/teams/#when-i'm-@mentioned) | @mention (opt-in) |
| `OnWebhookKeyword` | [`WebhookKeywordTrigger`](https://learn.microsoft.com/connectors/teams/#when-keywords-are-mentioned) | Keyword mention (opt-in) |
| `OnWebhookMessageReaction` | [`WebhookMessageReactionTrigger`](https://learn.microsoft.com/connectors/teams/#when-someone-reacted-to-a-message-in-chat) | Message reaction (opt-in) |
| `OnRecordingAvailable` | [`RecordingTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-recording-is-available) | Recording available (opt-in) |
| `OnTranscriptAvailable` | [`TranscriptTrigger`](https://learn.microsoft.com/connectors/teams/#when-a-transcript-is-available) | Transcript available (opt-in) |

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- PowerShell for the Windows hook (`postdeploy.ps1`), or Bash and `jq` for the macOS/Linux hook (`postdeploy.sh`)
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
cd teamsApp/webhook
az login
azd auth login
azd env new teams-webhook
azd env set TEAMS_GROUP_ID "<team / Microsoft 365 group object ID>"
azd env set TEAMS_CHANNEL_ID "<channel ID, e.g. 19:abcd...@thread.tacv2>"
azd up
```

Complete the OAuth sign-in when the hook opens your browser, then choose **Configure** or **Skip** for each of the seven opt-in triggers and answer their connector picker prompts. The hook creates up to eleven trigger configurations with callbacks to the deployed Function App. Use a different azd environment from polling.

### Azure role-assignment permissions

Choose **Yes** to continue if `azd up` warns **"Role assignment permissions at the target scopes were not verified"** and your deploying account has the permission described below. This warning means azd could not verify your access, not that access was denied.

Deployment grants the Function App's managed identity access to the storage account created for its code and runtime data. Your deploying account needs `Microsoft.Authorization/roleAssignments/write`, provided by Owner, User Access Administrator, or Role Based Access Control Administrator on that storage account or its parent resource group/subscription. Contributor alone is insufficient.

If deployment fails because role-assignment permission is denied, ask your Azure administrator to grant access or create the role assignments.

## Optional configuration

| Setting / option | Purpose |
| --- | --- |
| Omit `TEAMS_GROUP_ID` / `TEAMS_CHANNEL_ID` | Hook offers interactive Microsoft Graph team/channel pickers through your Azure CLI sign-in and saves the selection |
| `CONNECTOR_NAMESPACE_LOCATION` | Namespace region; defaults to `brazilsouth` |
| `azd hooks run postdeploy` | Rerun consent and trigger registration without redeploying |

Opt-in trigger inputs are collected on every hook run; only team/channel IDs are saved. Skipping a trigger omits its configuration for that run, but its handler still registers and existing configurations are not deleted. `OnWebhookChatMessage` monitors all chats of the connection user, and recording/transcript triggers need appropriate meeting licenses and policies.

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

Check the connection is **Connected** and triggers are **Enabled** in [Connector Namespaces](https://connectors.azure.com/). Post a new root channel message, not a reply, and look for `OnNewChannelMessage trigger received.` in logs. Opt-in triggers require their scoped source action and prerequisites. Allow upstream detection delays; delivery is at least once.

Run `azd down --purge` when finished to remove deployed resources.

## More

- [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md#microsoft-teams-connector)
- [Microsoft Teams connector reference](https://learn.microsoft.com/connectors/teams/)
