// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';

app.connectorTrigger('OnDataverseRowModified', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnDataverseRowModifiedTriggerConfigName%',
    handler: async (payload: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('Received OnDataverseRowModified trigger.');
        return payload;
    },
});
