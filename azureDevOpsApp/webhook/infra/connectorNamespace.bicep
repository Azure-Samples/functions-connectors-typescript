// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

@minLength(1)
param name string

@minLength(1)
param location string

param tags object = {}

param azureDevOpsConnectionName string

param functionAppPrincipalId string

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

resource azureDevOpsConnection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorNamespace
  name: azureDevOpsConnectionName
  properties: {
    connectorName: 'visualstudioteamservices'
    parameterValueSet: {
      name: 'EntraOAuth'
      values: {}
    }
  }
}

resource azureDevOpsConnectionMsiAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = {
  parent: azureDevOpsConnection
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

resource azureDevOpsConnectionUserAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(userPrincipalId)) {
  parent: azureDevOpsConnection
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

output resourceId string = connectorNamespace.id
output name string = connectorNamespace.name
output azureDevOpsConnectionName string = azureDevOpsConnection.name
output azureDevOpsConnectionRuntimeUrl string = azureDevOpsConnection.properties.connectionRuntimeUrl
