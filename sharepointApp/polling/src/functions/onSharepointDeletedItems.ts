// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onDeletedItems('OnSharepointDeletedItems', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnSharepointDeletedItemsTriggerConfigName%',
    handler: async (context: ConnectorTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnSharepointDeletedItems trigger (${context.items.length} items).`);
        return context.rawPayload;
    },
});
