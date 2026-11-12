// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, SalesforceRecordTriggerContext } from '@azure/functions-extensions-connectors';

connectors.salesforce.onUpdatedItems('OnSalesforceUpdatedItems', {
    handler: async (context: SalesforceRecordTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSalesforceUpdatedItems trigger received.');

        for (const record of context.records) {
            invocationContext.log(`Record: '${JSON.stringify(record)}'.`);
        }

        return context.rawPayload;
    },
});
