// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectorTrigger, GraphClientReceiveMessage } from '@azure/functions-extensions-connectors';

connectorTrigger<GraphClientReceiveMessage>('OnGenericOffice365NewEmail', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnGenericOffice365NewEmail (generic API) trigger received.');

        for (const email of context.items) {
            invocationContext.log(`Subject: '${email.subject}'.`);
            invocationContext.log(`From: '${email.from}'.`);
        }

        return context.rawPayload;
    },
});
