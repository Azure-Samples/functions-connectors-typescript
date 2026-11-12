// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

param name string
param location string
param tags object = {}
param connectorName string
param connectionName string
param functionAppPrincipalId string
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
  name: connectionName
  location: location
  properties: {
    connectorName: connectorName
    parameterValueSet: {
      name: 'BasicAuthentication'
      values: {}
    }
  }
}

var principalNames = concat(['namespace-msi', 'functionapp-msi'], empty(userPrincipalId) ? [] : ['dev-user'])
var principals = {
  'namespace-msi': connectorNamespace.identity.principalId
  'functionapp-msi': functionAppPrincipalId
  'dev-user': userPrincipalId
}

resource accessPolicies 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = [
  for principalName in principalNames: {
    parent: connection
    name: principalName
    properties: {
      principal: {
        type: 'ActiveDirectory'
        identity: {
          objectId: principals[principalName]
          tenantId: tenant().tenantId
        }
      }
    }
  }
]

output name string = connectorNamespace.name
output resourceId string = connectorNamespace.id
output connectionName string = connection.name
output principalId string = connectorNamespace.identity.principalId

output connectionRuntimeUrl string = connection.properties.connectionRuntimeUrl
