// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { TranscriptWebhookResponseSchema } from '@azure/connectors/generated/TeamsExtensions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<TranscriptWebhookResponseSchema>('OnTranscriptAvailable', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnTranscriptAvailable trigger received.');
        for (const event of context.items) {
            invocationContext.log(`Record: '${JSON.stringify(event)}'.`);
        }
        return context.rawPayload;
    },
});
