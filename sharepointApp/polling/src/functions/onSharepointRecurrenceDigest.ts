// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

connectors.sharepoint.onRecurrenceDigest('OnSharepointRecurrenceDigest', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnSharepointRecurrenceDigestTriggerConfigName%',
    handler: async (context: ConnectorTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnSharepointRecurrenceDigest trigger (${context.items.length} items).`);
        return context.rawPayload;
    },
});
