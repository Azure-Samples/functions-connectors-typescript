// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Connector Namespace shell only. The Azure Blob connection itself, its
// access policies, and any keyBasedAuth parameter values are created by
// the postdeploy script (infra/scripts/postdeploy.ps1 / .sh) AFTER the
// user has supplied a storage account / access key — so the connection
// never appears in the portal in an `Error` state.
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
