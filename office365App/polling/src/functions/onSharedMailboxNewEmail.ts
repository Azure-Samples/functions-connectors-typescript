// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, EmailTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onSharedMailboxNewEmail('OnSharedMailboxNewEmail', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnSharedMailboxNewEmailTriggerConfigName%',
    handler: async (context: EmailTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnSharedMailboxNewEmail trigger (${context.emails.length} items).`);
        return context.rawPayload;
    },
});
