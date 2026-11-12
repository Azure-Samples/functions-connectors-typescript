# Microsoft Dataverse - Polling

Receive the [five Dataverse events](../README.md) without a public callback,
connector extension key, or local tunnel. The
[handlers](src/functions/dataverseTriggers.ts) use `DeliveryMode.Poll`,
`connection: 'ConnectorNamespace'`, and one
`%<FunctionName>TriggerConfigName%` setting per function. Each invocation receives
one raw Poll event; its contents remain opaque.

## Configure

Run from this folder, using a distinct environment for polling:

```sh
npm ci
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-dataverse-polling-environment>
azd up
```

Bicep provisions the Function App, storage, monitoring, Connector Namespace,
`commondataservice` connection, and connection access policies for the namespace,
Function App, and deployer identities. Packaging, provisioning, and deployment run
sequentially so the deployment progress display finishes before interactive setup.
The postdeploy hook uses `az connector-namespace connection authenticate` when the
connection is not already `Connected`. In your normal browser, click **Continue**
on the local sign-in page and complete consent; CLI instructions and errors remain
visible in the terminal. The CLI handles callback capture and consent-code
confirmation without replacing the provisioned access policies. This requires a
`connector-namespace` extension version with `connection authenticate` support.
The hook then verifies `Connected` and collects actual environment/table selectors
through connector metadata and authenticated pickers.

During consent, the terminal checks Azure connection status every 10 seconds.
A popup that stays open is not proof of failure: wait for **authentication
confirmed: Azure connection is Connected**, then close the sign-in windows and
continue in the terminal. Setup does not wait for a missing browser redirect once
Azure confirms the connection.

If an earlier deployment stopped during consent or obscured a source-selection
prompt, rerun `azd hooks run postdeploy` from this folder without redeploying.
An already-connected connection is reused without another browser sign-in.

Setup covers all five events by default: row added, row modified,
row deleted, combined row changes, and action performed. The combined subscription
uses `message=7` and `scope=4` in its body. Setup collects the actual environment,
table, and action selectors needed for each event, then creates selected **Poll**
trigger configurations, derives their endpoint from the service, and applies
all config-name settings and managed-identity authentication settings to the
Function App. No Dataverse opt-in flags are required. It never uses webhook
`notificationDetails` or requests a Function system key.

Only required fields and their selector dependencies are prompted, for example
Environment, Table name, Scope for separate-row events, and Action name.
The separate-row events use the portal's `SubscribeOn*Items` operations and
`GetDataSets_V2` environment picker, not the admin-only `GetOn*Items_V2` operations.
The connector metadata still marks the portal's separate-row operations deprecated.
Optional filters use connector defaults
or remain unset; previously saved explicit values are preserved. If a picker has
no usable choices, enter the actual connector identifier manually (not a display
name), or leave it blank to skip that trigger and continue with the others.
Skipped listeners are disabled. If every trigger is skipped, setup stops without
changing trigger configurations, app settings, or saved selections.

A fresh `local.settings.json` is created with the endpoint and config names,
without Azure managed-identity settings; an existing file is preserved.
The [safe template](local.settings.example.json) remains available for local-only
setup.

Selections are saved as `POLLING_TRIGGER_INPUTS` in this project's azd
environment. Unchanged reruns reuse existing subscriptions. To change source
selectors, run `azd env set POLLING_TRIGGER_INPUTS=`, then
`azd hooks run postdeploy`. When upgrading from combined-only setup, clear
`POLLING_TRIGGER_INPUTS` and run `azd up` to deploy all five listeners and configure
their sources. Saved subsets are reused, including intentionally skipped events;
webhook and other apps' configs are never overwritten.

Separate row events overlap the combined event, so the same row change can invoke
both samples. Action-performed requires a real catalog, category, table, and
action available to the signed-in user; do not guess missing identifiers.
Picker entries without identifiers are ignored, and missing display labels use
the identifier instead. A failed lookup or malformed list still stops setup
before source changes; it is not treated as an empty list.

## Run and verify

Start Azurite separately when using development storage, then:

```powershell
npm ci
az login
npm start
```

Stop the deployed listener or use separate configs when testing locally;
listeners sharing one Poll config compete for events. The app does not require
`EnablePollingSamples` because this entire app uses Poll delivery.

Verify Connected consent, Enabled configs, and successful **source registration**
in [Connector Namespaces](https://connectors.azure.com/). An Enabled resource by
itself does not prove source registration or delivery succeeded. Create, modify,
and delete a test row and check for `OnDataverseRowChanged trigger received.`
Run `npm test` for offline registration and opaque-payload tests.

Follow the [source cleanup instructions](../README.md#disabling-and-cleanup)
before replacing subscriptions or deleting resources.
