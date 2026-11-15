// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, EmailTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onNewEmailMentioningMe('OnNewMentionMeEmail', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnNewMentionMeEmailTriggerConfigName%',
    handler: async (context: EmailTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnNewMentionMeEmail trigger (${context.emails.length} items).`);
        return context.rawPayload;
    },
});
