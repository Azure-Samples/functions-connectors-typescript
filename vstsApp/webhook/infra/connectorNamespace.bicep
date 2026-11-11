// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

@minLength(1)
param name string

@minLength(1)
param location string

param tags object = {}

param vstsConnectionName string

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

resource vstsConnection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorNamespace
  name: vstsConnectionName
  properties: {
    connectorName: 'visualstudioteamservices'
    parameterValueSet: {
      name: 'EntraOAuth'
      values: {}
    }
  }
}

resource vstsConnectionMsiAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = {
  parent: vstsConnection
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

resource vstsConnectionUserAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(userPrincipalId)) {
  parent: vstsConnection
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
output vstsConnectionName string = vstsConnection.name
output vstsConnectionRuntimeUrl string = vstsConnection.properties.connectionRuntimeUrl
