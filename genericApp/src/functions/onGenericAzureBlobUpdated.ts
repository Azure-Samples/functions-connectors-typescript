// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { AzureBlobMetadata, connectorTrigger } from '@azure/functions-extensions-connectors';

// NOTE(swapnilnagar): Uses the lower-level generic connectorTrigger<TItem> API instead of
// connectors.azureblob.onUpdatedFile. The function name still binds to the AzureBlob
// onUpdatedFile operation on the host side; the generic API just gives you raw control
// over the item type without depending on a first-class wrapper.
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
