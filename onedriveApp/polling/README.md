# OneDrive for Business Connector Sample - Polling

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

[The polling examples](src/functions/onOneDrivePoll.ts) cover all four operations without a public Function callback, connector extension key, or tunnel:

| Poll function | Connector operation |
| --- | --- |
| `OnOneDriveNewFilePoll` | `OnNewFilesV2` |
| `OnOneDriveUpdatedFilePoll` | `OnUpdatedFilesV2` |
| `OnOneDriveNewFileContentPoll` | `OnNewFileV2` |
| `OnOneDriveUpdatedFileContentPoll` | `OnUpdatedFileV2` |

After consent, the hook browses folders through the authorized `onedriveforbusiness` connection. Select an actual folder, then choose the **Use** entry for that folder. Files are excluded; the navigation placeholder `root` is never used as a trigger ID. The selected folder is applied to all four polling sources.

The metadata functions use typed helpers and log only receipt and count. The two content functions use the raw host API, preserve every envelope unchanged, and never parse or log file contents. All use single-event Poll delivery; the metadata body can itself contain multiple files. After deployment, verify source registration and create or update a small test file.

## Validate

Run `npm test` for offline tests. Start Azurite if using development storage, then run `npm start`. Verify that the connection is Connected, Poll configs are Enabled, and source registration succeeded before generating events. Stop the Azure listener or use separate Poll configs when testing locally; listeners sharing a config compete for events.
