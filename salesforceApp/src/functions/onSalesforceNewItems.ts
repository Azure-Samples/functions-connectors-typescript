// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, SalesforceRecordTriggerContext } from '@azure/functions-extensions-connectors';

connectors.salesforce.onNewItems('OnSalesforceNewItems', {
    handler: async (context: SalesforceRecordTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnSalesforceNewItems trigger received.');

        for (const record of context.records) {
            invocationContext.log(`Record: '${JSON.stringify(record)}'.`);
        }

        return context.rawPayload;
    },
});
