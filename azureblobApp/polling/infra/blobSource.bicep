param location string
param environmentName string
param namespacePrincipalId string
param userPrincipalId string
param tags object = {}

var readerRole = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
var contributorRole = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stmon${uniqueString(resourceGroup().id, environmentName)}'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: tags
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'testcontainer'
}

resource namespaceReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: container
  name: guid(container.id, namespacePrincipalId, readerRole)
  properties: {
    principalId: namespacePrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRole)
    principalType: 'ServicePrincipal'
  }
}

resource deployerContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  scope: container
  name: guid(container.id, userPrincipalId, contributorRole)
  properties: {
    principalId: userPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRole)
    principalType: 'User'
  }
}

output accountName string = storage.name
output containerName string = container.name
