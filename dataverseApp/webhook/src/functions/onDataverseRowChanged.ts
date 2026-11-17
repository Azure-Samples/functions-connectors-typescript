// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';

app.connectorTrigger('OnDataverseRowChanged', {
    connection: 'ConnectorNamespace',
    handler: async (payload: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('Received OnDataverseRowChanged trigger.');
        return payload;
    },
});
