// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, SharePointOnlineItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onChangedItems('OnSharepointChangedItems', {
    handler: async (context: SharePointOnlineItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSharepointChangedItems trigger received.');

        for (const record of context.records) {
            invocationContext.log(`Record: '${JSON.stringify(record)}'.`);
        }

        return context.rawPayload;
    },
});
