// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';

// This operation has an event-specific envelope, so it uses the raw generic API.
app.connectorTrigger('OnRecordingAvailable', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnRecordingAvailableTriggerConfigName%',
    handler: async (payload: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('Received OnRecordingAvailable trigger.');
        return payload;
    },
});
