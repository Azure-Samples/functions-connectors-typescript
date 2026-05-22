// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { BlobMetadata } from '@azure/connectors/generated/SharepointonlineExtensions';
import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

app.connectorTrigger('OnGenericSharepointNewFile', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        context.log('OnGenericSharepointNewFile trigger received.');

        const [, files] = unwrapTriggerPayload<BlobMetadata>(triggerInput);

        for (const file of files) {
            context.log(`Name: '${file.Name}'.`);
            context.log(`Path: '${file.Path}'.`);
        }

        return triggerInput;
    },
});
