// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';

// Keep content opaque; the extension's OneDrive helpers normalize metadata batches.
app.connectorTrigger('OnOneDriveNewFileContent', {
    handler: async (fileContent: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('OnOneDriveNewFileContent content trigger received.');
        return fileContent;
    },
});
