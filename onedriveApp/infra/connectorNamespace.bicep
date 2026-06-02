// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Connector Namespace + a single OneDrive for Business connection. Access
// policies grant the function-app managed identity (and, optionally, the
// deployer user) permission to call the connection at runtime so the
// connector trigger callback and SDK calls are authorized.
// ----------------------------------------------------------------------------

@minLength(1)
param name string

@minLength(1)
param location string

param tags object = {}

@description('Name of the OneDrive connection to create on the namespace.')
param onedriveConnectionName string

@description('Object id of the function app system-assigned managed identity.')
param functionAppPrincipalId string = ''

@description('Optional. AAD object id of a user (typically the deployer) to also grant access to the connection so the same code can be debugged locally with `az login` credentials.')
param userPrincipalId string = ''

param tenantId string = tenant().tenantId

resource connectorNamespace 'Microsoft.Web/connectorGateways@2026-05-01-preview' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
}

resource onedriveConnection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorNamespace
  name: onedriveConnectionName
  properties: {
    connectorName: 'onedrive'
  }
}

resource onedriveConnectionMsiAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(functionAppPrincipalId)) {
  parent: onedriveConnection
  name: 'functionapp-msi'
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: functionAppPrincipalId
        tenantId: tenantId
      }
    }
  }
}

resource onedriveConnectionUserAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(userPrincipalId)) {
  parent: onedriveConnection
  name: 'dev-user'
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: userPrincipalId
        tenantId: tenantId
      }
    }
  }
}

@description('The resource ID of the Connector Namespace.')
output resourceId string = connectorNamespace.id

@description('The name of the Connector Namespace.')
output name string = connectorNamespace.name

@description('The name of the OneDrive connection.')
output onedriveConnectionName string = onedriveConnection.name

@description('The connection runtime URL for the OneDrive connection.')
output onedriveConnectionRuntimeUrl string = onedriveConnection.properties.connectionRuntimeUrl
