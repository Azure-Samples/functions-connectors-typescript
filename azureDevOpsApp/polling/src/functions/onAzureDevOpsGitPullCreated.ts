// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, GitPullRequestTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPullCreated('OnAzureDevOpsGitPullCreated', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsGitPullCreatedTriggerConfigName%',
    handler: async (context: GitPullRequestTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsGitPullCreated trigger (${context.pullRequests.length} items).`);
        return context.rawPayload;
    },
});
