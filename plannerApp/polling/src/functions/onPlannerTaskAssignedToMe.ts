// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, PlannerTaskTriggerContext } from '@azure/functions-extensions-connectors';

connectors.planner.onTaskAssignedToMe('OnPlannerTaskAssignedToMe', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnPlannerTaskAssignedToMeTriggerConfigName%',
    handler: async (context: PlannerTaskTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnPlannerTaskAssignedToMe trigger (${context.tasks.length} items).`);
        return context.rawPayload;
    },
});
