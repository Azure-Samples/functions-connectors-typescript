// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';

// Keep content opaque; the extension's OneDrive helpers normalize metadata batches.
app.connectorTrigger('OnOneDriveUpdatedFileContent', {
    handler: async (fileContent: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('OnOneDriveUpdatedFileContent content trigger received.');
        return fileContent;
    },
});
