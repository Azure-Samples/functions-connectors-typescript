# Microsoft Dataverse Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/) | Functions polls the Connector Namespace | Outbound only; no tunnel |
| [Webhook](webhook/) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Both samples log [Microsoft Dataverse](https://learn.microsoft.com/connectors/commondataservice/) row-change and action-performed events; see each sample's README for setup, supported triggers, and optional configuration.
