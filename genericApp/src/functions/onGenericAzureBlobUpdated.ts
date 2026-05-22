// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { BlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

// NOTE(swapnilnagar): Uses app.connectorTrigger from @azure/functions directly — no
// dependency on @azure/functions-extensions-connectors. Item type comes from the
// Azure Blob connector's generated SDK in @azure/connectors.
app.connectorTrigger('OnGenericAzureBlobUpdated', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        context.log('OnGenericAzureBlobUpdated trigger received.');

        const [, files] = unwrapTriggerPayload<BlobMetadata>(triggerInput);

        for (const file of files) {
            context.log(`Name: '${file.Name}'.`);
            context.log(`Path: '${file.Path}'.`);
            context.log(`LastModified: '${file.LastModified}'.`);
        }

        return triggerInput;
    },
});
