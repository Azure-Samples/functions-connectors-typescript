// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { ChatMessage, connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<ChatMessage>('OnGenericTeamsChannelMessage', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnGenericTeamsChannelMessage (generic API) trigger received.');

        for (const message of context.items) {
            invocationContext.log(`MessageId: '${message.id}'.`);
        }

        return context.rawPayload;
    },
});
