// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

targetScope = 'resourceGroup'

@minLength(1)
param environmentName string

@minLength(1)
param location string

@minLength(1)
param namespaceName string

@minLength(1)
param connectionName string

@minLength(1)
param pollingEndpoint string

@minLength(1)
param triggerSettings string

@allowed([
  'true'
  'false'
])
param functionAppExists string = 'false'

@metadata({
  azd: {
    type: 'principalId'
  }
})
param userPrincipalId string = deployer().objectId

param connectorRuntimeUrl string = ''

@secure()
param connectorToken string = ''

var tags = {
  'azd-env-name': environmentName
}
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var functionAppName = 'func-${environmentName}-${resourceToken}'
var functionAppId = resourceId('Microsoft.Web/sites', functionAppName)
var currentSettings = functionAppExists == 'true'
  ? list('${functionAppId}/config/appsettings', '2024-04-01').properties
  : {}

module resources 'resources.bicep' = {
  name: 'resources'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    userPrincipalId: userPrincipalId
    connectorRuntimeUrl: connectorRuntimeUrl
    connectorToken: connectorToken
    pollingEndpoint: pollingEndpoint
    triggerSettings: json(base64ToString(triggerSettings))
    existingAppSettings: currentSettings
  }
}

resource connectorNamespace 'Microsoft.Web/connectorGateways@2026-05-01-preview' existing = {
  name: namespaceName
}

resource connection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' existing = {
  parent: connectorNamespace
  name: connectionName
}

resource functionAppAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = {
  parent: connection
  name: 'functionapp-msi'
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: resources.outputs.functionAppPrincipalId
        tenantId: tenant().tenantId
      }
    }
  }
}

output FUNCTION_APP_NAME string = resources.outputs.functionAppName
output FUNCTION_APP_HOSTNAME string = resources.outputs.functionAppHostname
output functionAppName string = resources.outputs.functionAppName
output ConnectorNamespace__pollingEndpoint string = pollingEndpoint
