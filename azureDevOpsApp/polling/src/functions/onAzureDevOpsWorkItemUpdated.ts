// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, WorkItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onWorkItemUpdated('OnAzureDevOpsWorkItemUpdated', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsWorkItemUpdatedTriggerConfigName%',
    handler: async (context: WorkItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsWorkItemUpdated trigger (${context.workItems.length} items).`);
        return context.rawPayload;
    },
});
