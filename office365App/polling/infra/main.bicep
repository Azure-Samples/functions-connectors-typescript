// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Subscription-scoped entrypoint used by `azd up`.
// Creates the resource group, connector namespace, and source resources.
// ----------------------------------------------------------------------------

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Region with Connector Namespace preview support.')
param connectorNamespaceLocation string = 'brazilsouth'

@metadata({
  azd: {
    type: 'principalId'
  }
})
param userPrincipalId string = deployer().objectId

var tags = {
  'azd-env-name': environmentName
}
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var functionAppName = 'func-${environmentName}-${resourceToken}'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module connectorNamespace 'connectorNamespace.bicep' = {
  scope: resourceGroup
  name: 'connectorNamespace'
  params: {
    name: 'cn${uniqueString(resourceGroup.id)}'
    location: connectorNamespaceLocation
    tags: tags
    connectorName: loadJsonContent('scripts/polling-config.json').connectorName
    userPrincipalId: userPrincipalId
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output FUNCTION_APP_NAME string = functionAppName
output resourceGroupName string = resourceGroup.name
output functionAppName string = functionAppName
output connectorNamespaceName string = connectorNamespace.outputs.name
output connectorNamespaceResourceId string = connectorNamespace.outputs.resourceId
output connectorNamespaceConnectionName string = connectorNamespace.outputs.connectionName
output CONNECTOR_NAMESPACE_LOCATION string = connectorNamespaceLocation
