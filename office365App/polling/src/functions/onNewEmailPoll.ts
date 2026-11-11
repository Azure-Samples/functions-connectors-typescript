// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { Cardinality, DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, EmailTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onNewEmail('OnNewEmailPoll', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnNewEmailPollTriggerConfigName%',
    cardinality: Cardinality.Many,
    maxBatchSize: 4,
    targetPendingEventThreshold: 16,
    handler: async (context: EmailTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnNewEmailPoll trigger received.');
        invocationContext.log(`Received '${context.emails.length}' email(s) across the polling batch.`);

        for (const email of context.emails) {
            invocationContext.log(`Subject: '${email.subject}', From: '${email.from}'.`);
        }

        return context.rawPayload;
    },
});
