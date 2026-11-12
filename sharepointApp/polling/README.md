# SharePoint Online Connector Sample - Polling

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

The hook saves source selections as `POLLING_TRIGGER_INPUTS` in this project's azd environment and reuses them on redeployment without replacing unchanged subscriptions. To change selections, run `azd env set POLLING_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Deselected or skipped owned sources are disabled without losing their selectors. Other apps' and webhook configurations are never overwritten.

[The polling examples](src/functions/onSharepointPoll.ts) cover all ten non-deprecated operations listed in the [SharePoint sample overview](../README.md). Each Poll function adds `Poll` to its webhook function name, for example `OnSharepointNewItemsPoll`; its setting is `OnSharepointNewItemsPollTriggerConfigName`. The operation ID and source parameters are unchanged.

After consent, the hook collects the actual `sharepointonline` site, list/library, and operation-specific selectors through connector metadata and authenticated pickers. Five create/update operations are enabled by default. Deletion, form submission, Syntex classification, and recurring digest sources are opt-in and require the corresponding account permissions.

For example, setup asks for **Site Address**, then **List Name** or **Library Name**. Form-submission triggers also ask for **Form Name**, while recurring digests ask whether to include edits/new items and **When to run**. Optional prompts include **Folder** and **Limit Columns by View**.

If a list-only picker returns no choices, the hook asks you to enter the SharePoint list name manually. Leave it blank to skip that trigger. If any other required picker returns no choices (including Site Address, Library Name, Form Name, or When to run), the hook prints a notice, skips that trigger, and continues configuring the others. It never guesses identifiers or substitutes a library for a list. A form trigger needs an available form for the selected list/library; selecting Documents alone does not guarantee one exists.

Optional inputs can be skipped to use connector defaults. If an optional picker returns no choices, the hook prints a notice and leaves that filter unset: no view means all columns, and no folder filter means the whole selected list/library. Failed lookups and malformed responses still stop setup before any trigger configurations or listener settings are changed. At least one trigger must be configured; if all are skipped, setup fails without saving selections or changing existing sources.

Optional Folder inputs browse the site's libraries and nested folders. Choose `Use <folder path>` to select the current folder, `Parent folder` to go back, or `No folder filter (whole library)` to omit the filter.

The hook manages listener settings through `AzureWebJobs.<FunctionName>.Disabled`, retaining config-name settings even for disabled listeners. Existing `SHAREPOINT_*` webhook options do not control this independent app. Handlers log only receipt and item count. Verify source registration, then generate an event in the selected list/library.

## Validate

Run `npm test` for offline tests. Start Azurite if using development storage, then run `npm start`. Verify that the connection is Connected, Poll configs are Enabled, and source registration succeeded before generating events. Stop the Azure listener or use separate Poll configs when testing locally; listeners sharing a config compete for events.
