// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

// ----------------------------------------------------------------------------
// Subscription-scoped entrypoint used by `azd up`.
// Creates the resource group and delegates to resources.bicep.
// ----------------------------------------------------------------------------

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Optional. Region for the Connector Namespace. Defaults to brazilsouth (currently the only region with the required preview features).')
param connectorNamespaceLocation string = 'brazilsouth'

@description('Optional. AAD object id of a user (typically the deployer) to grant access to the connector connection so the same code can be debugged locally with `az login` credentials.')
@metadata({
  azd: {
    type: 'principalId'
  }
})
param userPrincipalId string = deployer().objectId

@description('Whether to create the storage role assignments needed for managed-identity-based AzureWebJobsStorage / Flex Consumption package deployment. Set to false when the deployer lacks Microsoft.Authorization/roleAssignments/write.')
param assignStorageRoles bool = true

@description('When true, the function app uses managed identity for AzureWebJobsStorage and the Flex Consumption package container. When false, falls back to a storage account key connection string (works without RBAC permissions).')
param useStorageManagedIdentity bool = true

@minLength(1)
@description('SharePoint site URL to monitor, e.g. https://contoso.sharepoint.com/sites/MySite.')
param sharepointSiteUrl string

@minLength(1)
@description('Document library name or GUID accepted by the connector.')
param sharepointLibraryName string = 'Documents'

@description('List name or GUID. Empty uses the document library for item and form triggers.')
param sharepointListName string = ''

@description('Optional folder path for file and digest triggers. Empty monitors the whole library.')
param sharepointFolderPath string = ''

@description('Enable deletion triggers only when the connection user is a site collection administrator.')
param sharepointEnableDeletionTriggers bool = false

@description('Enable classification only after applying a licensed Microsoft Syntex model to the library.')
param sharepointEnableSyntexTrigger bool = false

@description('Existing form identifier. Empty disables the form-submitted trigger.')
param sharepointFormId string = ''

@description('Digest schedule: * for daily, or 0 through 6 for a day of the week. Empty disables the digest.')
@allowed(['', '*', '0', '1', '2', '3', '4', '5', '6'])
param sharepointDigestSchedule string = ''

var optionalFunctions = {
  OnSharepointDeletedItems: sharepointEnableDeletionTriggers
  OnSharepointDeletedFileItems: sharepointEnableDeletionTriggers
  OnSharepointUpdatedFileClassifiedTimes: sharepointEnableSyntexTrigger
  OnSharepointNewItemsFromForm: !empty(sharepointFormId)
  OnSharepointRecurrenceDigest: !empty(sharepointDigestSchedule)
}

var tags = {
  'azd-env-name': environmentName
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  scope: resourceGroup
  name: 'resources'
  params: {
    location: location
    environmentName: environmentName
    tags: tags
    connectorNamespaceLocation: connectorNamespaceLocation
    userPrincipalId: userPrincipalId
    assignStorageRoles: assignStorageRoles
    useStorageManagedIdentity: useStorageManagedIdentity
    functionSettings: toObject(items(optionalFunctions), item => 'AzureWebJobs.${item.key}.Disabled', item => string(!item.value))
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output resourceGroupName string = resourceGroup.name
output FUNCTION_APP_NAME string = resources.outputs.functionAppName
output FUNCTION_APP_HOSTNAME string = resources.outputs.functionAppHostname
output functionAppName string = resources.outputs.functionAppName
output connectorNamespaceName string = resources.outputs.connectorNamespaceName
output sharepointConnectionName string = resources.outputs.sharepointConnectionName
output sharepointConnectionRuntimeUrl string = resources.outputs.sharepointConnectionRuntimeUrl
output sharepointSiteUrl string = sharepointSiteUrl
output sharepointLibraryName string = sharepointLibraryName
output sharepointListName string = empty(sharepointListName) ? sharepointLibraryName : sharepointListName
output sharepointFolderPath string = sharepointFolderPath
output sharepointEnableDeletionTriggers bool = sharepointEnableDeletionTriggers
output sharepointEnableSyntexTrigger bool = sharepointEnableSyntexTrigger
output sharepointFormId string = sharepointFormId
output sharepointDigestSchedule string = sharepointDigestSchedule
