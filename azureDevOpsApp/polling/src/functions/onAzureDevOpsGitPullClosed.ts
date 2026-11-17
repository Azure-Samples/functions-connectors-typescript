// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, GitPullRequestTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPullClosed('OnAzureDevOpsGitPullClosed', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsGitPullClosedTriggerConfigName%',
    handler: async (context: GitPullRequestTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsGitPullClosed trigger (${context.pullRequests.length} items).`);
        return context.rawPayload;
    },
});
