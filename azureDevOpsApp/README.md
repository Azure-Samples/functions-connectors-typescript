# Azure DevOps Connector Samples (TypeScript)

Choose how the Connector Namespace delivers events to Azure Functions:

| Sample | Delivery | Local development |
| --- | --- | --- |
| [Polling](polling/) | Host receives events from the namespace | No public callback or tunnel |
| [Webhook](webhook/) | Namespace calls the HTTPS callback | Public HTTPS tunnel |

Samples for Azure DevOps (formerly Visual Studio Team Services) build, Git, TFVC, and work item triggers using the [Azure DevOps connector](https://learn.microsoft.com/connectors/visualstudioteamservices/). See the sample README for setup and supported triggers.
