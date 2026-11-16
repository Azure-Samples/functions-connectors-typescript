// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

param name string
param location string
param tags object = {}
param connectorName string
param userPrincipalId string = ''

resource connectorNamespace 'Microsoft.Web/connectorGateways@2026-05-01-preview' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
}

resource connection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorNamespace
  name: '${connectorName}-${uniqueString(connectorNamespace.id)}'
  location: location
  properties: union({
    connectorName: connectorName
  }, connectorName == 'azureblob' ? {
    parameterValueSet: {
      name: 'managedIdentityAuth'
      values: {}
    }
    connectionProperties: {
      authentication: {
        type: 'ManagedServiceIdentity'
      }
    }
  } : {})
}

resource userAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(userPrincipalId)) {
  parent: connection
  name: 'dev-user'
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: userPrincipalId
        tenantId: tenant().tenantId
      }
    }
  }
}

output name string = connectorNamespace.name
output resourceId string = connectorNamespace.id
output connectionName string = connection.name
output principalId string = connectorNamespace.identity.principalId
