// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

connectors.teams.onTeamMemberAdded('OnGroupMembershipAdd', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnGroupMembershipAddTriggerConfigName%',
    handler: async (context: ConnectorTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnGroupMembershipAdd trigger (${context.items.length} items).`);
        return context.rawPayload;
    },
});
