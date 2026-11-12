// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, PlannerTaskTriggerContext } from '@azure/functions-extensions-connectors';

connectors.planner.onTaskAssignedToMe('OnPlannerTaskAssignedToMe', {
    handler: async (context: PlannerTaskTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnPlannerTaskAssignedToMe trigger received.');

        for (const task of context.tasks) {
            invocationContext.log(`Id: '${task.id}', Title: '${task.title}'.`);
            invocationContext.log(`Assignments: '${JSON.stringify(task._assignments)}'.`);
        }

        return context.rawPayload;
    },
});
