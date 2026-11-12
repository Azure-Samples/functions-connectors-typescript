// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, DeletedItemTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onDeletedFileItems('OnSharepointDeletedFileItems', {
    handler: async (context: DeletedItemTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSharepointDeletedFileItems trigger received.');

        for (const item of context.deletedItems) {
            invocationContext.log(`Id: '${item.ID}'.`);
            invocationContext.log(`Name: '${item.Name}'.`);
            invocationContext.log(`Deleted at: '${item.TimeDeleted}'.`);
        }

        return context.rawPayload;
    },
});
