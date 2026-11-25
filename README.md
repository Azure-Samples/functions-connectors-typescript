# Azure Functions Connector Samples (TypeScript)

[![CI](https://github.com/Azure-Samples/functions-connectors-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/Azure-Samples/functions-connectors-typescript/actions/workflows/ci.yml)

TypeScript samples for the [Azure Functions Connector Samples](https://github.com/Azure-Samples/functions-connectors/) repo, using [`@azure/functions-extensions-connectors`](https://www.npmjs.com/package/@azure/functions-extensions-connectors) to receive events from Microsoft 365, SharePoint, Teams, and other connectors.

## Samples

| Guide | Connector |
| --- | --- |
| [Office 365](office365App/README.md) | [Office 365 Outlook](https://learn.microsoft.com/connectors/office365/) |
| [SharePoint](sharepointApp/README.md) | [SharePoint Online](https://learn.microsoft.com/connectors/sharepointonline/) |
| [OneDrive](onedriveApp/README.md) | [OneDrive for Business](https://learn.microsoft.com/connectors/onedriveforbusiness/) |
| [Teams](teamsApp/README.md) | [Microsoft Teams](https://learn.microsoft.com/connectors/teams/) |
| [Dataverse](dataverseApp/README.md) | [Microsoft Dataverse (Common Data Service)](https://learn.microsoft.com/connectors/commondataservice/) |
| [Planner](plannerApp/README.md) | [Planner](https://learn.microsoft.com/connectors/planner/) |
| [Salesforce](salesforceApp/README.md) | [Salesforce](https://learn.microsoft.com/connectors/salesforce/) |
| [Azure DevOps](azureDevOpsApp/README.md) | [Azure DevOps (VSTS - Visual Studio Team Services)](https://learn.microsoft.com/connectors/visualstudioteamservices/) |
| [Dataflows](dataflowsApp/README.md) | [Dataflows](https://learn.microsoft.com/connectors/dataflows/) |
| [Azure Blob](azureblobApp/README.md) | [Azure Blob Storage](https://learn.microsoft.com/connectors/azureblob/) |
| [Generic](genericApp/README.md) | [Any connector](https://learn.microsoft.com/connectors/), using raw payloads |

Each `polling/` and `webhook/` folder is a self-contained Azure Functions app with its own dependencies, source code, and README. Each trigger is an individual function in its own file under `src/functions/`. Connector-specific apps also include `azure.yaml` and `infra/`; navigate into the selected folder and run `azd up`, using a separate azd environment for each app. Generic samples use existing Azure resources and publish with Functions Core Tools instead.

Microsoft Learn sample metadata is attached to the 19 connector-specific standalone polling/webhook READMEs, not the overview or generic guides. Dataflows has a webhook sample only. Metadata does not certify live connector behavior; follow each sample's verification steps.

## Contributing and checks

See [CONTRIBUTING.md](CONTRIBUTING.md) for scoped changes and local checks, and [CHANGELOG.md](CHANGELOG.md) for unreleased changes. Use the [issue forms](https://github.com/Azure-Samples/functions-connectors-typescript/issues/new/choose) to report sample problems or request improvements without sharing credentials or private data.

GitHub Actions builds/typechecks all 21 apps with Node.js 24 and their checked-in npm lockfiles, audits dependencies, and runs Gitleaks on a snapshot of the current tracked source (not Git history). CI does not sign in to Azure, deploy resources, run connector listeners, or use configured secrets.

## More triggers and operations

See the full [Connector trigger payloads for Azure Functions](https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md) for all supported connector triggers and their .NET, Python, and TypeScript signatures.

## Prerequisites

- [Node.js 24 or later](https://nodejs.org/)
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) 1.33.0 or later for polling samples
- [Azure CLI (`az`)](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.75.0 or later
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) for local development
- [`connector-namespace` Azure CLI extension](https://github.com/Azure/Connectors/tree/main/public-preview/connector-namespace-cli), installed with:

  ```bash
  # Bash
  curl -fsSL https://aka.ms/connector-namespace-cli-install | sh
  ```

  or

  ```pwsh
  # PowerShell
  irm https://aka.ms/connector-namespace-cli-install-ps | iex
  ```

## Related repos

- [Azure Functions Connector Extension](https://github.com/Azure/azure-functions-connector-extension): the trigger binding that connects Connector Namespace events to Azure Functions.
- [Azure Functions Node.js Extensions](https://github.com/Azure/azure-functions-nodejs-extensions) - Source for `@azure/functions-extensions-connectors`.
- [Azure Functions Connector Samples (.NET)](https://github.com/Azure-Samples/functions-connectors-net): .NET versions of these samples.
- [Azure Functions Connector Samples (Python)](https://github.com/Azure-Samples/functions-connectors-python): Python versions of these samples.
