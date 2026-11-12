// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, PlannerTaskTriggerContext } from '@azure/functions-extensions-connectors';

connectors.planner.onCompleteTask('OnPlannerCompleteTask', {
    handler: async (context: PlannerTaskTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnPlannerCompleteTask trigger received.');

        for (const task of context.tasks) {
            invocationContext.log(`Id: '${task.id}', Title: '${task.title}'.`);
            invocationContext.log(`Completed: '${task.percentComplete}%', At: '${task.completedDateTime}'.`);
        }

        return context.rawPayload;
    },
});
