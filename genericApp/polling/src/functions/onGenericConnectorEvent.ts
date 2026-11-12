// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode } from '@azure/functions';

app.connectorTrigger('OnGenericConnectorEvent', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%GenericTriggerConfigName%',
    handler: async (_payload: unknown, invocationContext) => {
        invocationContext.log('OnGenericConnectorEvent (generic API) trigger received.');
    },
});
