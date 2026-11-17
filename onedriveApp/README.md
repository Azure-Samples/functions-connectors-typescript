# OneDrive for Business Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/README.md) | Functions polls the Connector Namespace | Outbound only; no tunnel |
| [Webhook](webhook/README.md) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Samples for [OneDrive for Business](https://learn.microsoft.com/connectors/onedriveforbusiness/) file creation and modification triggers. Each folder is an independent app; deploy each with a different azd environment.
