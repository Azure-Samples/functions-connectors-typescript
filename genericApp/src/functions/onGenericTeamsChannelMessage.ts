// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { ChatMessage } from '@azure/connectors/generated/TeamsExtensions';
import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

app.connectorTrigger('OnGenericTeamsChannelMessage', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        context.log('OnGenericTeamsChannelMessage trigger received.');

        const [, messages] = unwrapTriggerPayload<ChatMessage>(triggerInput);

        for (const message of messages) {
            context.log(`MessageId: '${message.id}'.`);
        }

        return triggerInput;
    },
});
