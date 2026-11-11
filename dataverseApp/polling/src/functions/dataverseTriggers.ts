// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';

const functionNames = ['OnDataverseRowChanged'];

if (process.env.EnableDataverseSeparateRowSamples === 'true') {
    functionNames.push('OnDataverseRowAdded', 'OnDataverseRowModified', 'OnDataverseRowDeleted');
}
if (process.env.EnableDataverseActionSample === 'true') {
    functionNames.push('OnDataverseActionPerformed');
}

for (const name of functionNames) {
    app.connectorTrigger(name, {
        deliveryMode: DeliveryMode.Poll,
        connection: 'ConnectorNamespace',
        triggerConfigName: `%${name}TriggerConfigName%`,
        handler: async (payload: unknown, invocationContext: InvocationContext) => {
            invocationContext.log(`${name} trigger received.`);
            return payload;
        },
    });
}
