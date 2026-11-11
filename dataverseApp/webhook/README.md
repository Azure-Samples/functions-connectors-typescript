# Microsoft Dataverse - Webhook

Receive the [five Dataverse events](../README.md) with Webhook delivery.
The [handlers](src/functions/dataverseTriggers.ts) use the native
`app.connectorTrigger` API, `connection: 'ConnectorNamespace'`, and the default
Webhook delivery mode. They log only receipt and return the raw input unchanged.

## Configure

1. Deploy this app using the [shared Dataverse instructions](../README.md#infrastructure-and-setup),
   choosing a different azd environment from polling.
2. Follow the [manual connector setup](../../README.md#manual-connector-setup)
   using connector ID `commondataservice`. Complete OAuth consent and configure
   connection access policies. Use an account with permission to register
   organization-scoped Dataverse events.
3. Select the operation and parameter values from the
   [Dataverse event table](../README.md). For the default combined operation:

   ```json
   [
     { "name": "organization", "value": "https://contoso.crm.dynamics.com" },
     { "name": "entityname", "value": "account" },
     { "name": "message", "value": "7" },
     { "name": "scope", "value": "4" }
   ]
   ```

4. Create the subscription with operation `SubscribeWebhookTrigger` and a callback
   ending in `/runtime/webhooks/connector?functionName=OnDataverseRowChanged`.
   Keep the real `connector_extension` system key in
   `notificationDetails.authentication`, never in the callback URL or a committed
   file. Protect and remove the temporary JSON argument files described in the
   shared setup guide.
5. For optional functions, configure separate sources with their own operation,
   selectors, and callback function name, then enable the appropriate
   [Function App flag](../README.md#optional-events).

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
