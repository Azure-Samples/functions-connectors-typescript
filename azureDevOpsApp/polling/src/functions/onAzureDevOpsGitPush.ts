// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, GitPushTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPush('OnAzureDevOpsGitPush', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsGitPushTriggerConfigName%',
    handler: async (context: GitPushTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsGitPush trigger (${context.pushes.length} items).`);
        return context.rawPayload;
    },
});
