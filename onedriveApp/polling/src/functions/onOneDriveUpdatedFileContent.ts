// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';

// File-content operations must bypass metadata normalization.
app.connectorTrigger('OnOneDriveUpdatedFileContent', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnOneDriveUpdatedFileContentTriggerConfigName%',
    handler: async (payload: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('Received OnOneDriveUpdatedFileContent trigger.');
        return payload;
    },
});
