// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { BlobMetadata as AzureBlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

// Azure Blob has no first-class wrapper in 0.1.0-preview. Configure its
// OnUpdatedFiles_V2 subscription to target this registered function name.
connectorTrigger<AzureBlobMetadata>('OnGenericAzureBlobUpdated', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnGenericAzureBlobUpdated (generic API) trigger received.');

        for (const file of context.items) {
            invocationContext.log(`Name: '${file.Name}'.`);
            invocationContext.log(`Path: '${file.Path}'.`);
            invocationContext.log(`LastModified: '${file.LastModified}'.`);
        }

        return context.rawPayload;
    },
});
