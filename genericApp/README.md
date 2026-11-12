# Generic Connector Trigger Sample

Choose an independent Azure Functions app:

- [Webhook](webhook/README.md)
- [Polling](polling/README.md)

Each app has one connector-neutral `OnGenericConnectorEvent` function without connector-specific models or payload inspection. Webhook uses the generic `connectorTrigger` helper with its default `unknown` item type; polling uses the raw `app.connectorTrigger` binding. Choose the delivery mode for your supported connector. There is no Office 365 example.

Run `npm ci` and `npm test` from the chosen subfolder. These apps use existing Azure resources and have no `azd` provisioning or postdeploy hooks. Follow the selected app's README to configure delivery and publish with Functions Core Tools.
