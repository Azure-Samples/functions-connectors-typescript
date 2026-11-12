// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, SharepointItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onUpdatedFileItems('OnSharepointUpdatedFileItems', {
    handler: async (context: SharepointItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSharepointUpdatedFileItems trigger received.');

        for (const record of context.records) {
            invocationContext.log(`Record: '${JSON.stringify(record)}'.`);
        }

        return context.rawPayload;
    },
});
