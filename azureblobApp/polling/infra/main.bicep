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

@description('Region with Connector Namespace preview support.')
param connectorNamespaceLocation string = 'brazilsouth'

@metadata({
  azd: {
    type: 'principalId'
  }
})
param userPrincipalId string = deployer().objectId

@description('Connector runtime URL (e.g. https://<connection-name>-<gateway>.azureconnectors.com). Optional at provisioning time; configure later as app setting.')
param connectorRuntimeUrl string = ''

@description('Connector OAuth access token. Optional at provisioning time; configure later as app setting or rotate via Key Vault.')
@secure()
param connectorToken string = ''

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
    connectorRuntimeUrl: connectorRuntimeUrl
    connectorToken: connectorToken
    userPrincipalId: userPrincipalId
  }
}

module connectorNamespace 'connectorNamespace.bicep' = {
  scope: resourceGroup
  name: 'connectorNamespace'
  params: {
    name: 'cn${uniqueString(resourceGroup.id)}'
    location: connectorNamespaceLocation
    tags: tags
    connectorName: loadJsonContent('scripts/polling-config.json').connectorName
    functionAppPrincipalId: resources.outputs.functionAppPrincipalId
    userPrincipalId: userPrincipalId
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output FUNCTION_APP_NAME string = resources.outputs.functionAppName
output FUNCTION_APP_HOSTNAME string = resources.outputs.functionAppHostname
output resourceGroupName string = resourceGroup.name
output functionAppName string = resources.outputs.functionAppName
output connectorNamespaceName string = connectorNamespace.outputs.name
output connectorNamespaceResourceId string = connectorNamespace.outputs.resourceId
output connectorNamespaceConnectionName string = connectorNamespace.outputs.connectionName
output CONNECTOR_NAMESPACE_LOCATION string = connectorNamespaceLocation

module blobSource 'blobSource.bicep' = {
  scope: resourceGroup
  name: 'blobSource'
  params: {
    location: location
    environmentName: environmentName
    namespacePrincipalId: connectorNamespace.outputs.principalId
    userPrincipalId: userPrincipalId
    tags: tags
  }
}

output monitoredStorageAccountName string = blobSource.outputs.accountName
output monitoredContainerName string = blobSource.outputs.containerName
