// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

targetScope = 'resourceGroup'

@minLength(1)
param namespaceName string

@minLength(1)
param connectionName string

@minLength(1)
param functionAppName string

@minLength(1)
param triggerPlan string

var plan = json(base64ToString(triggerPlan))
var connectorName = loadJsonContent('scripts/polling-config.json').connectorName
var endpointConfigName = plan.?endpointConfigName ?? ''

resource connectorNamespace 'Microsoft.Web/connectorGateways@2026-05-01-preview' existing = {
  name: namespaceName
}

resource triggerConfigs 'Microsoft.Web/connectorGateways/triggerConfigs@2026-05-01-preview' = [
  for trigger in plan.selected: {
    parent: connectorNamespace
    name: trigger.name
    properties: {
      connectionDetails: {
        connectorName: connectorName
        connectionName: connectionName
      }
      deliveryMode: 'Poll'
      operationName: trigger.operationName
      parameters: trigger.parameters
      metadata: {
        destinationType: 'functionApp'
        functionAppSubscriptionId: subscription().subscriptionId
        functionAppResourceGroup: resourceGroup().name
        functionAppName: functionAppName
        functionName: trigger.functionName
      }
      state: 'Enabled'
      type: 'NotSpecified'
      description: '${trigger.name} with Poll delivery.'
    }
  }
]

resource endpointConfig 'Microsoft.Web/connectorGateways/triggerConfigs@2026-05-01-preview' existing = if (!empty(endpointConfigName)) {
  parent: connectorNamespace
  name: endpointConfigName
}

var receiveUri = empty(endpointConfigName) ? '' : string(endpointConfig.properties.pollingEndpoints.receiveUri)
var receivePathIndex = indexOf(toLower(receiveUri), '/triggerconfigs/')
var endpointPrefix = receivePathIndex < 0 ? '' : substring(receiveUri, 0, receivePathIndex)

output pollingEndpoint string = endsWith(toLower(endpointPrefix), '/api')
  ? substring(endpointPrefix, 0, length(endpointPrefix) - 4)
  : endpointPrefix
