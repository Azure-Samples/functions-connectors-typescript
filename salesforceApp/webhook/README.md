# Salesforce Connector Sample

Azure Functions app covering both `connectors.salesforce` helpers.

| Function | Helper | Connector operation | Required parameters |
| -------- | ------ | ------------------- | ------------------- |
| [OnSalesforceNewItems](src/functions/onSalesforceNewItems.ts) | `onNewItems` | `GetOnNewItems` | `table` |
| [OnSalesforceUpdatedItems](src/functions/onSalesforceUpdatedItems.ts) | `onUpdatedItems` | `GetOnUpdatedItems` | `table` |

Handlers use `SalesforceRecordTriggerContext.records`, typed as SDK `SalesforceItem[]`. They log whole records as JSON, preserving `dynamicProperties` and any raw callback fields without fabricating a fixed Salesforce object schema. The original payload is returned unchanged. Use a sandbox or test records because dynamic fields may contain sensitive information.

## Prerequisites and local development

Follow the [shared prerequisites](../../README.md#prerequisites), including Node.js 24+. Live events require a Salesforce account and connector permissions for the selected object.

From this folder:

```sh
npm ci
npm test
npm start
```

Run `npm run setup:local`, then configure `local.settings.json` without committing credentials, and run Azurite for development storage. Local callbacks require reachable HTTPS and separate subscriptions; starting the host does not create them.

## Deploy and configure

The self-contained [infra/main.bicep](infra/main.bicep) template provisions a Node.js 24 Flex Consumption Function App, host storage, monitoring, a Connector Namespace, a `salesforce` connection, and access policies for the namespace, Function App, and deployer.

```sh
az login
az extension add --name connector-namespace
azd auth login
azd env new <unique-salesforce-webhook-environment>
azd up
```

Packaging, provisioning, and deployment run sequentially before the interactive postdeploy hook. The connection uses the connector's **Login with Salesforce Account** OAuth mode (`BasicAuthentication` is its metadata name, not a username/password flow). The login URI defaults to Salesforce Production. If needed, the hook runs `az connector-namespace connection authenticate`; complete browser consent and keep the terminal open. The CLI extension must support that command.

After verifying `Connected`, setup lets you configure or skip each trigger and asks only for required selectors, such as Salesforce Object Type. Optional filters use defaults or remain unset. An empty usable picker allows manual API-name entry; leave blank to skip the trigger. Choose an object that supports the trigger, as described below.

During consent, the terminal checks Azure connection status every 10 seconds. A browser popup that stays open is not proof of failure: wait for **authentication confirmed: Azure connection is Connected**, then close the sign-in windows and continue in the terminal. Setup does not wait for a missing browser redirect once Azure confirms the connection. If setup failed or was interrupted, run `azd hooks run postdeploy` to retry without redeploying.

The hook retrieves the extension key securely, creates selected webhook subscriptions, and sets `SalesforceConnection` and listener-enabled settings. It saves selections in `SALESFORCE_WEBHOOK_TRIGGER_INPUTS` and reuses unchanged subscriptions. To select again, run `azd env set SALESFORCE_WEBHOOK_TRIGGER_INPUTS=`, then `azd hooks run postdeploy`. Skipped owned subscriptions are disabled without deleting them or changing selectors; all-skipped setup stops before changes. Poll and other apps' subscriptions are protected.

A fresh `local.settings.json` receives the runtime URL; existing local settings are preserved. Local callbacks still need a separate subscription and reachable HTTPS.

## Verify

Confirm the connection is `Connected` and the desired subscriptions are `Enabled` in [Connector Namespaces](https://connectors.azure.com/). Create or modify a sandbox record in the selected object, then inspect Function App logs. Offline tests exercise typed dynamic records, not live delivery or Salesforce permissions.

## Troubleshooting

### Deployment upload fails with storage 403

If provisioning succeeds but publishing fails with `BlobUploadFailedException`
and storage returns `403 (This request is not authorized to perform this operation using this permission.)`,
wait a few minutes and retry deployment from this folder using the same azd environment:

```sh
azd deploy
```

A deployment-only retry resolved this error during sample testing without
source or permission changes. Newly assigned storage permissions can take time
to propagate, but the error alone does not confirm that cause. You do not need
to recreate the resources or configure Salesforce OAuth again for this upload
failure. If it persists, check the deployment storage permissions and network
restrictions rather than repeatedly retrying or enabling storage account keys.

### Trigger fails because the selected object is missing a required field

The Salesforce object picker can list objects with similar display names but
different API names and fields. Appearing in the picker does not guarantee that
an object supports the selected trigger. For example, **When a record is
created** queries `CreatedDate`; selecting an object without that field causes
the trigger to fail before events reach your Function App, even when the
connection is `Connected`.

Accounts are one example of this issue; other objects may have similarly
confusing labels. During testing, the picker returned:

| Picker label | Object API name | Object type |
| --- | --- | --- |
| Accounts | `Account` | Standard CRM object |
| Account | `ssot__Account__dlm` | Data Cloud object |

Selecting **Account** caused the trigger to fail with
`No such column 'CreatedDate' on entity 'ssot__Account__dlm'`. For standard CRM
accounts, select **Accounts** instead. Labels may differ in your Salesforce
environment.

If you encounter a missing-field error, check the trigger's failure details and
confirm that the selected object contains the required field and is the object
where you create your test records. After correcting the selection, verify that
the trigger is healthy, then create a new test record.
