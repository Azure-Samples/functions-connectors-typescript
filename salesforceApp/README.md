# Salesforce Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/) | Host receives events from the namespace | No public callback or tunnel |
| [Webhook](webhook/) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Samples for Salesforce record triggers using the [Salesforce connector](https://learn.microsoft.com/connectors/salesforce/). See the sample README for setup and supported triggers.
