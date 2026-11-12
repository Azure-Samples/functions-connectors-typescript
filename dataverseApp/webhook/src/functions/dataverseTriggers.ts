// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';

const functionNames = [
    'OnDataverseRowChanged', 'OnDataverseActionPerformed',
    'OnDataverseRowAdded', 'OnDataverseRowModified', 'OnDataverseRowDeleted',
];

for (const name of functionNames) {
    app.connectorTrigger(name, {
        connection: 'ConnectorNamespace',
        handler: async (payload: unknown, invocationContext: InvocationContext) => {
            invocationContext.log(`${name} trigger received.`);
            return payload;
        },
    });
}
