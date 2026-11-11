// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Subscription-scoped entrypoint used by `azd up`.
// Creates the resource group and delegates to resources.bicep.
// ----------------------------------------------------------------------------

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Region for the Connector Namespace preview.')
param connectorNamespaceLocation string = 'brazilsouth'

@description('AAD object id of the deployer, granted connection access for local development.')
@metadata({
  azd: {
    type: 'principalId'
  }
})
param userPrincipalId string = deployer().objectId

@description('Create storage role assignments for the Function App managed identity.')
param assignStorageRoles bool = true

@description('Use managed identity for host and deployment storage. Disable only when storage RBAC is unavailable.')
param useStorageManagedIdentity bool = true

var tags = {
  'azd-env-name': environmentName
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  scope: resourceGroup
  name: 'resources'
  params: {
    location: location
    environmentName: environmentName
    tags: tags
    connectorNamespaceLocation: connectorNamespaceLocation
    userPrincipalId: userPrincipalId
    assignStorageRoles: assignStorageRoles
    useStorageManagedIdentity: useStorageManagedIdentity
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output FUNCTION_APP_NAME string = resources.outputs.functionAppName
output FUNCTION_APP_HOSTNAME string = resources.outputs.functionAppHostname
output resourceGroupName string = resourceGroup.name
output functionAppName string = resources.outputs.functionAppName
output connectorNamespaceName string = resources.outputs.connectorNamespaceName
output connectorNamespaceResourceId string = resources.outputs.connectorNamespaceResourceId
output connectorNamespaceConnectionName string = resources.outputs.vstsConnectionName
output vstsConnectionRuntimeUrl string = resources.outputs.vstsConnectionRuntimeUrl
output CONNECTOR_NAMESPACE_LOCATION string = connectorNamespaceLocation
