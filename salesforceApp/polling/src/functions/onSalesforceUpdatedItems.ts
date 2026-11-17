// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, SalesforceRecordTriggerContext } from '@azure/functions-extensions-connectors';

connectors.salesforce.onUpdatedItems('OnSalesforceUpdatedItems', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnSalesforceUpdatedItemsTriggerConfigName%',
    handler: async (context: SalesforceRecordTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnSalesforceUpdatedItems trigger (${context.records.length} items).`);
        return context.rawPayload;
    },
});
