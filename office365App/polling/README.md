# Office 365 Outlook Connector Sample - Polling

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

Complete OAuth consent and source-selection prompts when requested. A new `local.settings.json` is created with the real endpoint/config names and local developer authentication; an existing file is never overwritten. See the [shared Poll deployment guide](../../README.md#polling-samples) for local testing and endpoint details.

The hook saves source selections as `POLLING_TRIGGER_INPUTS` in this project's azd environment and reuses them on redeployment without replacing unchanged subscriptions. To change selections, run `azd env set POLLING_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Deselected owned optional sources are disabled without losing their selectors. Other apps' and webhook configurations are never overwritten.

[onNewEmailPoll.ts](src/functions/onNewEmailPoll.ts) is a dedicated batched polling example, separate from the webhook app. It uses `deliveryMode: DeliveryMode.Poll`, `cardinality: Cardinality.Many`, and a maximum of four Poll events per invocation. These enums are exported by `@azure/functions` starting in `4.17.1`; batching must remain explicit because cardinality defaults to `Cardinality.One`.

The hook authorizes the Outlook connection and configures `OnNewEmailV3` for `Inbox`. `context.emails` combines emails from all events in order, while `context.rawPayload` preserves the full envelope array.

## Validate

Run `npm test` for offline tests. Start Azurite if using development storage, then run `npm start`. Verify that the connection is Connected, Poll configs are Enabled, and source registration succeeded before generating events. Stop the Azure listener or use separate Poll configs when testing locally; listeners sharing a config compete for events.
