# Azure Blob Storage Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/README.md) | Functions polls the Connector Namespace | Outbound only; no tunnel |
| [Webhook](webhook/README.md) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Samples for the [Azure Blob Storage](https://learn.microsoft.com/connectors/azureblob/) blob added or modified trigger. Each folder is an independent app; deploy each with a different azd environment.
