// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';

// This operation has an event-specific envelope, so it uses the raw generic API.
app.connectorTrigger('OnWebhookAtMention', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnWebhookAtMentionTriggerConfigName%',
    handler: async (payload: unknown, invocationContext: InvocationContext) => {
        invocationContext.log('Received OnWebhookAtMention trigger.');
        return payload;
    },
});
