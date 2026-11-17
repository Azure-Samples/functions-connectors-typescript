// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, PlannerTaskTriggerContext } from '@azure/functions-extensions-connectors';

connectors.planner.onNewTask('OnPlannerNewTask', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnPlannerNewTaskTriggerConfigName%',
    handler: async (context: PlannerTaskTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnPlannerNewTask trigger (${context.tasks.length} items).`);
        return context.rawPayload;
    },
});
