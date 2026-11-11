// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, WorkItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onWorkItemUpdated('OnVstsWorkItemUpdated', {
    handler: async (context: WorkItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsWorkItemUpdated trigger received.');

        for (const workItem of context.workItems) {
            invocationContext.log(`Id: '${workItem.id}', Revision: '${workItem.rev}'.`);
            invocationContext.log(`Fields: '${JSON.stringify(workItem.fields)}'.`);
        }

        return context.rawPayload;
    },
});
