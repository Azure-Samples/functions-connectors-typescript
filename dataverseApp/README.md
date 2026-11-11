# Microsoft Dataverse connector samples (TypeScript)

Choose the [polling app](polling/README.md) or [webhook app](webhook/README.md).
These examples mirror the events and safe defaults in the
[Python Dataverse sample](https://github.com/Azure-Samples/functions-connectors-python/tree/main/dataverseApp).

| Function | Connector operation | Parameters | Default |
| --- | --- | --- | --- |
| `OnDataverseRowChanged` | `SubscribeWebhookTrigger` | `organization`, logical `entityname`, `message="7"`, `scope="4"` | Enabled: added, modified, or deleted rows |
| `OnDataverseActionPerformed` | `BusinessEventsTrigger` | `organization`, `catalog`, `category`, `entityname`, `sdkmessagename` | Opt-in |
| `OnDataverseRowAdded` | `GetOnNewItems_V2` | `dataset`, entity-set `table` | Opt-in |
| `OnDataverseRowModified` | `GetOnUpdatedItems_V2` | `dataset`, entity-set `table` | Opt-in |
| `OnDataverseRowDeleted` | `GetOnDeletedItems_V2` | `dataset`, entity-set `table` | Opt-in |

Use the **`commondataservice`** connector. `organization` and `dataset` are the
organization's HTTPS URL, for example `https://contoso.crm.dynamics.com`.
The combined operation uses a **logical table name**, such as `account`; separate
row operations use the distinct **entity-set name**, such as `accounts`.
`message="7"` selects added, modified, or deleted rows; `scope="4"` selects the organization.
The connection user must have permission to register those organization-scoped events.

The pinned TypeScript extension has no Dataverse helper or matching event models.
All five handlers therefore use the native `app.connectorTrigger` API with
`unknown` payloads. They log only receipt and return the input unchanged, without
parsing row/action data or assuming a schema. The deprecated List rows HTTP action
is intentionally not included.

## Infrastructure and setup

Follow the [shared prerequisites](../README.md#prerequisites), including Node.js
24+, and use a test Dataverse environment. Both apps use the
[shared infrastructure](../genericApp/infra/main.bicep); keep the full repository
checkout when deploying.

As with the newer TypeScript samples, deployment provisions only the Function
App, storage, and monitoring. It does **not** create a Connector Namespace,
connection, OAuth consent, or trigger configurations. Configure those manually
using the chosen delivery-mode guide. Unlike the Python sample, these apps have
no automated connection/trigger setup or cleanup hooks.

Run from the chosen app folder:

```powershell
az login
azd auth login
azd env new my-dataverse-polling
azd up
```

Use a different azd environment name for webhook and separate namespaces, or
distinct trigger-config names, for each app. Never convert or overwrite a live
configuration belonging to the other mode. Deployment alone does not make an
unconfigured Poll listener ready.

## Optional events

Set these **Function App settings**, or local settings under `Values`, to exactly
`"true"` only after configuring the corresponding sources:

| Setting | Registers |
| --- | --- |
| `EnableDataverseActionSample` | `OnDataverseActionPerformed` |
| `EnableDataverseSeparateRowSamples` | `OnDataverseRowAdded`, `OnDataverseRowModified`, `OnDataverseRowDeleted` |

Both default to false. The combined row-change function always registers.
Separate row operations overlap its events; enable them only when intentionally
testing both. Restart the host after changing settings. These flags control
function registration, not the state or lifecycle of remote subscriptions.

Action-performed requires **actual** event catalog, category, table, and SDK
message selectors accepted by the environment. Do not invent placeholder
selectors. Use the connector's dynamic-value pickers to discover valid values.
This optional scenario still requires validation against a real Dataverse environment.

## Disabling and cleanup

When deselecting an optional event, disable its owned remote trigger configuration
as well as clearing the host flag. Preserve the existing operation, selectors,
delivery mode, and destination when changing its state. This manual sample does
not reconcile remote resources on redeployment.

Disabling a trigger or deleting an Azure resource group does **not** prove that
Dataverse removed a source callback. Before replacing or removing an action
subscription, identify its exact owned `callbackregistration`, verify its
selectors and destination, remove only that registration, and confirm a GET
returns 404. Keep a private record of the exact registration and preserve
unowned registrations. Never bulk-delete callbacks by table, catalog, category,
or message. Complete source cleanup before `azd down --purge`.

Never commit tokens, system keys, private endpoints, or real local settings.
Reapply manually configured Function App settings after reprovisioning, because
the shared template writes its own app-settings collection.

See the [Dataverse connector reference](https://learn.microsoft.com/connectors/commondataservice/).
