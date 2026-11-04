// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<Record<string, unknown>>('OnWebhookChatMessage', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnWebhookChatMessage trigger received.');
        for (const event of context.items) {
            invocationContext.log(`Record: '${JSON.stringify(event)}'.`);
        }
        return context.rawPayload;
    },
});
