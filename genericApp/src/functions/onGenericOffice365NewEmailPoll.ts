// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectorTrigger, GraphClientReceiveMessage } from '@azure/functions-extensions-connectors';

if (process.env.EnablePollingSamples === 'true') {
    connectorTrigger<GraphClientReceiveMessage>('OnGenericOffice365NewEmailPoll', {
        deliveryMode: DeliveryMode.Poll,
        connection: 'ConnectorNamespace',
        triggerConfigName: '%OnNewEmailPollTriggerConfigName%',
        maxBatchSize: 1,
        maxConcurrentCalls: 4,
        targetPendingEventThreshold: 16,
        handler: async (context, invocationContext: InvocationContext) => {
            invocationContext.log('OnGenericOffice365NewEmailPoll (generic API) trigger received.');
            invocationContext.log(`Received '${context.items.length}' email(s) in the polling event.`);

            for (const email of context.items) {
                invocationContext.log(`Subject: '${email.subject}', From: '${email.from}'.`);
            }

            return context.rawPayload;
        },
    });
}
