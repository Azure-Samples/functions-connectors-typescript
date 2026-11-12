# Microsoft Dataverse - Webhook

Receive the [five Dataverse events](../README.md) with Webhook delivery.
The [handlers](src/functions/dataverseTriggers.ts) use the native
`app.connectorTrigger` API, `connection: 'ConnectorNamespace'`, and the default
Webhook delivery mode. They log only receipt and return the raw input unchanged.

## Configure

Run from this folder using a different azd environment from polling:

```sh
npm ci
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-dataverse-webhook-environment>
azd up
```

Independent Bicep provisions the Function App, storage, monitoring, Connector
Namespace, `commondataservice` connection, and namespace/Function App/deployer
access policies. Packaging, provisioning, and deployment run sequentially before
the interactive postdeploy hook. If needed, the hook runs
`az connector-namespace connection authenticate`; complete browser consent and
keep the terminal open. The CLI extension must support that command.
Use an account permitted to register organization-scoped Dataverse events.

During consent, the terminal checks Azure connection status every 10 seconds.
A popup that stays open is not proof of failure: wait for **authentication
confirmed: Azure connection is Connected**, then close the sign-in windows and
continue in the terminal. Setup does not wait for a missing browser redirect once
Azure confirms the connection. Retry interrupted setup with
`azd hooks run postdeploy`, without redeploying.

After verifying `Connected`, setup lets you configure or skip each of the five
events. It prompts only for required selectors, for example Environment,
Table name, and Action name; optional filters use defaults or remain unset.
The separate-row events use the portal's `SubscribeOn*Items` operations and
prompt for Environment, Table name, and Scope. Their environment picker uses
`GetDataSets_V2`; these operations remain marked deprecated in connector metadata.
The combined subscription uses numeric body values `message=7` and `scope=4`.
If a picker has no usable choices, enter the actual connector identifier manually,
or leave blank to skip the trigger. Failed or malformed lookups still stop setup.

The hook retrieves the `connector_extension` system key securely and creates
selected webhook sources with per-function callbacks. The key stays in
`notificationDetails.authentication`, not in the callback URL or saved inputs.
All five functions register without opt-in flags. The hook sets
`AzureWebJobs.<FunctionName>.Disabled` to match the selection, keeping skipped
listeners disabled.

Selections are saved in `DATAVERSE_WEBHOOK_TRIGGER_INPUTS`. Unchanged reruns reuse
subscriptions. To select again, run `azd env set DATAVERSE_WEBHOOK_TRIGGER_INPUTS=`,
then `azd hooks run postdeploy`. Skipped owned sources and listeners are disabled
without deleting subscriptions or changing selectors. Skipping all events stops
before changes. Poll and other apps' configurations are never overwritten.
A fresh `local.settings.json` is created; existing local settings are preserved.

Keep the combined operation's logical table name, such as `account`, distinct
from the separate row operations' entity-set name, such as `accounts`.

## Run and verify

Copy [local.settings.example.json](local.settings.example.json) to
`local.settings.json`, start Azurite separately, and run:

```powershell
npm ci
npm start
```

Local delivery also requires a reachable HTTPS callback and a separate
subscription targeting the local function. `npm start` does not create one.

Verify Connected consent, Enabled configs, and successful source registration in
[Connector Namespaces](https://connectors.azure.com/). Create, modify, and delete a
test row, then check for `OnDataverseRowChanged trigger received.`
Run `npm test` for offline registration and opaque-payload tests; those do not
validate live OAuth consent or callback delivery.

Follow the [source cleanup instructions](../README.md#disabling-and-cleanup)
before replacing subscriptions or deleting resources.
