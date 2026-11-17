// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, WorkItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onWorkItemClosed('OnAzureDevOpsWorkItemClosed', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsWorkItemClosedTriggerConfigName%',
    handler: async (context: WorkItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsWorkItemClosed trigger (${context.workItems.length} items).`);
        return context.rawPayload;
    },
});
