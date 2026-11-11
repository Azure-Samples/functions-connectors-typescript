// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param environmentName string

@minLength(1)
param location string

module app '../../genericApp/infra/main.bicep' = {
  name: take('planner-${environmentName}', 64)
  params: {
    environmentName: environmentName
    location: location
  }
}

output AZURE_LOCATION string = app.outputs.AZURE_LOCATION
output AZURE_RESOURCE_GROUP string = app.outputs.AZURE_RESOURCE_GROUP
output FUNCTION_APP_NAME string = app.outputs.FUNCTION_APP_NAME
output FUNCTION_APP_HOSTNAME string = app.outputs.FUNCTION_APP_HOSTNAME
