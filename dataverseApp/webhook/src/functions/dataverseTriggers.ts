// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';

const functionNames = ['OnDataverseRowChanged'];

if (process.env.EnableDataverseSeparateRowSamples === 'true') {
    functionNames.push('OnDataverseRowAdded', 'OnDataverseRowModified', 'OnDataverseRowDeleted');
}
if (process.env.EnableDataverseActionSample === 'true') {
    functionNames.push('OnDataverseActionPerformed');
}

for (const name of functionNames) {
    app.connectorTrigger(name, {
        connection: 'ConnectorNamespace',
        handler: async (payload: unknown, invocationContext: InvocationContext) => {
            invocationContext.log(`${name} trigger received.`);
            return payload;
        },
    });
}
