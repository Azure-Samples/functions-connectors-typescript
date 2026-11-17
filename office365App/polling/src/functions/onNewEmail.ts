// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { Cardinality, DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, EmailTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onNewEmail('OnNewEmail', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnNewEmailTriggerConfigName%',
    cardinality: Cardinality.Many,
    maxBatchSize: 4,
    targetPendingEventThreshold: 16,
    handler: async (context: EmailTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnNewEmail trigger (${context.emails.length} items).`);
        return context.rawPayload;
    },
});
