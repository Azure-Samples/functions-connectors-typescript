// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, TfvcChangesetTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onTfvcCheckIn('OnAzureDevOpsTfvcCheckIn', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsTfvcCheckInTriggerConfigName%',
    handler: async (context: TfvcChangesetTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsTfvcCheckIn trigger (${context.changesets.length} items).`);
        return context.rawPayload;
    },
});
