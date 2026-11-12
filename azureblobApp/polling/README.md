# Azure Blob Storage Connector Sample - Polling

This is an independent Poll-only app; the [webhook app](../webhook/README.md) runs separately. No `EnablePollingSamples` flag is required. Function names and event processing are unchanged.

## Deploy and configure

Run these commands from this folder, using a unique azd environment:

```sh
npm ci
az login
azd auth login
azd env new <unique-polling-environment>
azd up
```

Bicep provisions this app's Function App, host storage, monitoring, Connector Namespace, managed-identity connection, connection access policies, and monitored storage account/container. The postdeploy hook creates the enabled **Poll** trigger configuration, derives the endpoint from the service, and applies all Function App settings with managed-identity authentication. No OAuth consent, source-selection prompts, webhook callback, connector extension key, or tunnel is needed.

A new `local.settings.json` is created with the real endpoint/config names and local developer authentication; an existing file is never overwritten. See the [shared Poll deployment guide](../../README.md#polling-samples) for endpoint details and the local-testing instructions below.

The hook saves the provisioned source parameters as `POLLING_TRIGGER_INPUTS` in this project's azd environment and reuses them on redeployment without replacing unchanged subscriptions. To regenerate them from the infrastructure outputs, run `azd env set POLLING_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Other apps' and webhook configurations are never overwritten.

[OnAzureBlobUpdatedFilePoll](src/functions/onAzureBlobPoll.ts) receives the same `OnUpdatedFiles_V2` operation using `DeliveryMode.Poll`. Unlike the default Webhook delivery, it needs no public Function callback, connector extension key, or tunnel. It uses the SDK's `BlobMetadata` with the generic helper, logs only receipt and item count, and preserves `context.rawPayload`.

Bicep configures the `azureblob` connection with the namespace's managed identity and provisions a separate monitored storage account and `testcontainer`. It grants container-reader access to the namespace identity and upload access to the deployer. The hook supplies the account `dataset` and encoded container `folderId` automatically.

After deployment, verify source registration, upload a small test blob, and check for `OnAzureBlobUpdatedFilePoll trigger received.` Allow for the connector's polling interval and RBAC propagation.

## Validate

Run `npm test` for offline tests. Start Azurite if using development storage, then run `npm start`. Verify that the connection is Ready or Connected, Poll configs are Enabled, and source registration succeeded before generating events. Stop the Azure listener or use separate Poll configs when testing locally; listeners sharing a config compete for events.
