// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, GitPullRequestTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPullClosed('OnVstsGitPullClosed', {
    handler: async (context: GitPullRequestTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsGitPullClosed trigger received.');

        for (const pullRequest of context.pullRequests) {
            invocationContext.log(`Id: '${pullRequest.pullRequestId}', Title: '${pullRequest.title}'.`);
            invocationContext.log(`Closed at: '${pullRequest.closedDate}'.`);
        }

        return context.rawPayload;
    },
});
