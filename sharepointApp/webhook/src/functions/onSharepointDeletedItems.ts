// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, DeletedItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onDeletedItems('OnSharepointDeletedItems', {
    handler: async (context: DeletedItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSharepointDeletedItems trigger received.');

        for (const item of context.deletedItems) {
            invocationContext.log(`Id: '${item.ID}'.`);
            invocationContext.log(`Name: '${item.Name}'.`);
            invocationContext.log(`Deleted by: '${item.DeletedByUserName}'.`);
        }

        return context.rawPayload;
    },
});
