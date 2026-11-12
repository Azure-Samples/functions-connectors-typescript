// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { BlobMetadata as AzureBlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<AzureBlobMetadata>('OnAzureBlobUpdatedFile', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnAzureBlobUpdatedFile trigger received.');

        for (const file of context.items) {
            invocationContext.log(`Name: '${file.Name}'.`);
            invocationContext.log(`Path: '${file.Path}'.`);
            invocationContext.log(`Size: '${file.Size}'.`);
            invocationContext.log(`LastModified: '${file.LastModified}'.`);
        }

        invocationContext.log(`Batch contains '${context.items.length}' blob(s).`);
        return context.rawPayload;
    },
});
