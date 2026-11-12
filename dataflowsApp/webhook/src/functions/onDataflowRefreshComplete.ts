// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, DataflowRefreshTriggerContext } from '@azure/functions-extensions-connectors';

connectors.dataflows.onRefreshComplete('OnDataflowRefreshComplete', {
    handler: async (context: DataflowRefreshTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnDataflowRefreshComplete trigger received.');

        for (const refresh of context.refreshes) {
            invocationContext.log(`Dataflow: '${refresh.dataflowName}' (${refresh.dataflowId}).`);
            invocationContext.log(`Status: '${refresh.status}'.`);
            invocationContext.log(`Start: '${refresh.startTime}', End: '${refresh.endTime}'.`);
        }

        return context.rawPayload;
    },
});
