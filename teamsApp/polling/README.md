# Microsoft Teams Connector Sample - Polling

This is an independent Poll-only app; the [webhook app](../webhook/README.md) runs separately. No `EnablePollingSamples` flag is required. Function names and event processing are unchanged.

## Deploy and configure

Run these commands from this folder, using a unique azd environment:

```sh
npm ci
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-polling-environment>
azd up
```

Bicep provisions this app's Function App, host storage, monitoring, Connector Namespace, connection, and connection access policies. The postdeploy hook handles authorization and source selection, creates enabled **Poll** trigger configurations, derives the endpoint from the service, and applies all Function App settings with managed-identity authentication. No webhook callback, connector extension key, or tunnel is needed.

This project's `azd up` runs packaging, provisioning, and deployment sequentially so the deployment progress display stops before interactive setup begins. Packaging no longer overlaps with provisioning. Running `azd deploy` directly still runs the same automatic setup.

Complete OAuth consent and source-selection prompts when requested. A new `local.settings.json` is created with the real endpoint/config names and local developer authentication; an existing file is never overwritten. See the [shared Poll deployment guide](../../README.md#polling-samples) for local testing and endpoint details.

The hook saves source selections as `POLLING_TRIGGER_INPUTS` in this project's azd environment and reuses them on redeployment without replacing unchanged subscriptions. To change selections, run `azd env set POLLING_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Deselected owned optional sources are disabled without losing their selectors. Other apps' and webhook configurations are never overwritten.

[The polling examples](src/functions/onTeamsPoll.ts) cover all eleven operations in the [webhook event table](../webhook/README.md). Each adds `Poll` to its webhook function name, for example `OnNewChannelMessagePoll`, with a matching `OnNewChannelMessagePollTriggerConfigName` setting. An operation named `Webhook...` can still use service **Poll delivery**; that name describes the connector source, not how the Function App receives events.

After consent, the hook collects actual team/channel IDs and operation-specific inputs through authenticated connector pickers. The four typed listeners are enabled by default. The other seven events are opt-in; their chat, keyword, reaction, recording, transcript, and membership inputs come from live connector schemas rather than guessed tenant-specific values.

The hook enables each selected listener and keeps unselected optional listeners disabled. The first four examples use typed helpers and log receipt/count only; the other seven preserve raw envelopes without logging their contents.

Verify source registration, then post a test message, mention the connected user, change membership, or generate the selected optional event. These offline samples do not establish that every optional operation is available in your tenant.

## Validate

Run `npm test` for offline tests. Start Azurite if using development storage, then run `npm start`. Verify that the connection is Connected, Poll configs are Enabled, and source registration succeeded before generating events. Stop the Azure listener or use separate Poll configs when testing locally; listeners sharing a config compete for events.
