// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onNewFileItems('OnSharepointNewFileItems', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnSharepointNewFileItemsTriggerConfigName%',
    handler: async (context: ConnectorTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnSharepointNewFileItems trigger (${context.items.length} items).`);
        return context.rawPayload;
    },
});
