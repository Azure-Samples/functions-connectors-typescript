# Microsoft Dataverse connector samples (TypeScript)

Choose the [polling app](polling/README.md) or [webhook app](webhook/README.md).
These examples cover the same event types as the
[Python Dataverse sample](https://github.com/Azure-Samples/functions-connectors-python/tree/main/dataverseApp).

| Function | Connector operation | Parameters |
| --- | --- | --- |
| `OnDataverseRowChanged` | `SubscribeWebhookTrigger` | `organization`, logical `entityname`, `message=7`, `scope=4` |
| `OnDataverseActionPerformed` | `BusinessEventsTrigger` | `organization`, `catalog`, `category`, `entityname`, `sdkmessagename` |
| `OnDataverseRowAdded` | `SubscribeOnNewItems` | `dataset`, entity-set `table`, `scope` |
| `OnDataverseRowModified` | `SubscribeOnUpdatedItems` | `dataset`, entity-set `table`, `scope` |
| `OnDataverseRowDeleted` | `SubscribeOnDeletedItems` | `dataset`, entity-set `table`, `scope` |

Use the **`commondataservice`** connector. `organization` and `dataset` are the
organization's HTTPS URL, for example `https://contoso.crm.dynamics.com`.
The combined operation uses a **logical table name**, such as `account`; separate
row operations use the distinct **entity-set name**, such as `accounts`.
`message=7` selects added, modified, or deleted rows; `scope=4` selects the organization.
Polling setup places those numeric values in the combined subscription body.
The connection user must have permission to register those organization-scoped events.

The separate-row operation IDs match the portal's named events and prompt for
Environment, Table name, and Scope, using `GetDataSets_V2` for environments.
The connector metadata marks these three operations deprecated; the combined
row-change and action-performed operations are not deprecated. Both deployment
hooks use the portal's `2022-09-01-preview` managed API export.

The pinned TypeScript extension has no Dataverse helper or matching event models.
All five handlers therefore use the native `app.connectorTrigger` API with
`unknown` payloads. They log only receipt and return the input unchanged, without
parsing row/action data or assuming a schema. The deprecated List rows HTTP action
is intentionally not included.

## Infrastructure and setup

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js
24+, and use a test Dataverse environment. Each app has its own independent
`infra/` templates and `infra/scripts/local-settings.mjs` setup script; neither
imports infrastructure from another sample. Run `npm run setup:local` in the
chosen folder to create local settings without overwriting an existing file.

Both apps independently provision their namespace, connection, and access
policies, then handle OAuth consent, source selection, trigger creation,
and Function App settings in their postdeploy hooks. Polling creates Poll
sources; webhook creates authenticated per-function callbacks. Follow the
chosen delivery-mode guide.

Run from the chosen app folder:

```powershell
az login
azd auth login
azd env new my-dataverse-polling
azd up
```

Use a different azd environment name for webhook and separate namespaces, or
distinct trigger-config names, for each app. Never convert or overwrite a live
configuration belonging to the other mode. Complete the polling hook's consent
and source-selection prompts before testing events.

## Selecting events

Both apps register all five listeners without opt-in flags. Setup creates the
selected trigger configurations and sets `AzureWebJobs.<FunctionName>.Disabled`
to keep skipped listeners disabled. It prompts only for required inputs.
Empty pickers allow manual identifiers; blank manual input skips that trigger.
For manual or local setup, configure the corresponding sources and use the same
per-function disabled settings for listeners you do not want to run.

Separate row operations overlap the combined event; select both only when
intentionally testing duplicate delivery. Old registration flags left in existing
settings are ignored.

Action-performed requires **actual** event catalog, category, table, and SDK
message selectors accepted by the environment. Do not invent placeholder
selectors. Use the connector's dynamic-value pickers to discover valid values.
Event delivery still requires validation against a real Dataverse environment.

## Disabling and cleanup

The polling hook reuses saved inputs for selected sources on redeployment. Clear
`POLLING_TRIGGER_INPUTS` with `azd env set POLLING_TRIGGER_INPUTS=`, then rerun the hook to change the
source selectors. To stop a polling listener, disable its owned remote config and
set `AzureWebJobs.<FunctionName>.Disabled=true`; rerunning setup enables the saved
selection again and keeps skipped listeners disabled. Webhook setup similarly
reuses `DATAVERSE_WEBHOOK_TRIGGER_INPUTS`; clear it and rerun the hook to change
the selection. For manual webhook setup, disable the
owned remote config and set `AzureWebJobs.<FunctionName>.Disabled=true`. Preserve
the operation, selectors, delivery mode, and destination when changing state.

When upgrading from the old `GetOn*Items_V2` mappings, clear the chosen app's saved
inputs before running its postdeploy hook. Existing remote configs using the old
operations are deliberately not overwritten. If any were created successfully,
use a separate test environment or follow source cleanup before replacing them.

Disabling a trigger or deleting an Azure resource group does **not** prove that
Dataverse removed a source callback. Before replacing or removing an action
subscription, identify its exact owned `callbackregistration`, verify its
selectors and destination, remove only that registration, and confirm a GET
returns 404. Keep a private record of the exact registration and preserve
unowned registrations. Never bulk-delete callbacks by table, catalog, category,
or message. Complete source cleanup before `azd down --purge`.

Never commit tokens, system keys, private endpoints, or real local settings.
The polling postdeploy hook reapplies its app settings after provisioning.
Reapply manually configured webhook settings yourself.

See the [Dataverse connector reference](https://learn.microsoft.com/connectors/commondataservice/).
