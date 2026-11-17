# Generic Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/) | Functions polls the Connector Namespace | Outbound only; no tunnel |
| [Webhook](webhook/) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Connector-neutral samples for existing Connector Namespace trigger configurations (no `azd` provisioning) on any [supported connector](https://learn.microsoft.com/connectors/connector-reference/); see each sample's README for setup.
