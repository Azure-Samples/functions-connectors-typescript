// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// The postup hook configures the Azure Blob connection to use this
// namespace's system-assigned identity and creates connection access policies.
// ----------------------------------------------------------------------------

@minLength(1)
param name string

@minLength(1)
param location string

param tags object = {}

resource connectorNamespace 'Microsoft.Web/connectorGateways@2026-05-01-preview' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
}

@description('The resource ID of the Connector Namespace.')
output resourceId string = connectorNamespace.id

@description('The name of the Connector Namespace.')
output name string = connectorNamespace.name

output principalId string = connectorNamespace.identity.principalId
