// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { GraphClientReceiveMessage } from '@azure/connectors/generated/Office365Extensions';
import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

app.connectorTrigger('OnGenericOffice365NewEmail', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        context.log('OnGenericOffice365NewEmail trigger received.');

        const [, emails] = unwrapTriggerPayload<GraphClientReceiveMessage>(triggerInput);

        for (const email of emails) {
            context.log(`Subject: '${email.subject}'.`);
            context.log(`From: '${email.from}'.`);
        }

        return triggerInput;
    },
});
