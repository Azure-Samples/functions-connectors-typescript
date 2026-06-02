// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Connector Namespace + a single Azure Blob connection. Access policies grant
// the function-app managed identity (and, optionally, the deployer user)
// permission to call the connection at runtime so the connector trigger
// callback and SDK calls are authorized. The connection's actual parameter
// values (storage account name / blob endpoint, access key, container) are
// supplied at runtime by the postdeploy script — Bicep only creates the
// shell so subsequent runs can patch it.
// ----------------------------------------------------------------------------

@minLength(1)
param name string

@minLength(1)
param location string

param tags object = {}

@description('Name of the Azure Blob connection to create on the namespace.')
param azureblobConnectionName string

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

resource azureblobConnection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorNamespace
  name: azureblobConnectionName
  properties: {
    connectorName: 'azureblob'
  }
}

resource azureblobConnectionMsiAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(functionAppPrincipalId)) {
  parent: azureblobConnection
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

resource azureblobConnectionUserAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = if (!empty(userPrincipalId)) {
  parent: azureblobConnection
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

@description('The name of the Azure Blob connection.')
output azureblobConnectionName string = azureblobConnection.name

@description('The connection runtime URL for the Azure Blob connection.')
output azureblobConnectionRuntimeUrl string = azureblobConnection.properties.connectionRuntimeUrl
