# Microsoft Dataverse - Polling

Receive the [five Dataverse events](../README.md) without a public callback,
connector extension key, or local tunnel. The
[handlers](src/functions/dataverseTriggers.ts) use `DeliveryMode.Poll`,
`connection: 'ConnectorNamespace'`, and one
`%<FunctionName>TriggerConfigName%` setting per function. Each invocation receives
one raw Poll event; its contents remain opaque.

## Configure

1. Deploy this app using the [shared Dataverse instructions](../README.md#infrastructure-and-setup).
2. Follow the [manual connector setup](../../README.md#manual-connector-setup)
   to create a namespace and a `commondataservice` connection. Complete OAuth
   consent using an account with permission to register Dataverse events.
   Wait until the connection is `Connected`.
3. Configure connection access policies for the namespace's system identity
   and for the receiving Function App's system identity (Azure) or developer
   identity (local). Azure RBAC alone does not grant connection access.
4. Create an enabled **Poll** trigger configuration using the
   [service configuration guide](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/connector-trigger-configuration.md#poll-delivery).
   Do not include webhook `notificationDetails`. For the default combined event,
   prepare this ARM request body outside the repository:

   ```json
   {
     "properties": {
       "connectionDetails": {
         "connectorName": "commondataservice",
         "connectionName": "<connection>"
       },
       "deliveryMode": "Poll",
       "operationName": "SubscribeWebhookTrigger",
       "parameters": [
         { "name": "organization", "value": "https://contoso.crm.dynamics.com" },
         { "name": "entityname", "value": "account" },
         { "name": "message", "value": "7" },
         { "name": "scope", "value": "4" }
       ],
       "metadata": {
         "destinationType": "functionApp",
         "functionAppSubscriptionId": "<subscription-id>",
         "functionAppResourceGroup": "<resource-group>",
         "functionAppName": "<function-app>",
         "functionName": "OnDataverseRowChanged"
       },
       "state": "Enabled",
       "type": "NotSpecified"
     }
   }
   ```

   Replace all example values, then submit it with Azure CLI:

   ```powershell
   $namespaceId = "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Web/connectorGateways/<namespace>"
   az rest --method put --url "https://management.azure.com$namespaceId/triggerConfigs/dataverse-ondataverserowchanged?api-version=2026-05-01-preview" --body "@C:\private\poll-trigger.json"
   ```

   For optional functions, use their actual operation and parameter values
   from the [event table](../README.md), a distinct config name, and matching
   `metadata.functionName`. Create only the sources you intend to enable.
5. Copy [local.settings.example.json](local.settings.example.json) to
   `local.settings.json`. Replace the endpoint using the
   [shared endpoint guidance](../../README.md#polling-samples), and ensure each
   enabled function's setting matches its actual trigger-config name.
   Local development uses your `az login` identity; do not copy Azure managed
   identity settings into the local file.

For Azure, add the same endpoint, config-name settings, and selected opt-in flags
to the Function App, plus `ConnectorNamespace__credential=managedidentity`.
Restart after setting them. The Function App must have access to the connection.
No user-assigned identity client ID is needed.

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
