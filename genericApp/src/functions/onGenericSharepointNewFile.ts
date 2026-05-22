// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { BlobMetadata, connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<BlobMetadata>('OnGenericSharepointNewFile', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnGenericSharepointNewFile (generic API) trigger received.');

        for (const file of context.items) {
            invocationContext.log(`Name: '${file.Name}'.`);
            invocationContext.log(`Path: '${file.Path}'.`);
        }

        return context.rawPayload;
    },
});
