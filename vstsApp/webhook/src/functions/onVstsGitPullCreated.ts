// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, GitPullRequestTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPullCreated('OnVstsGitPullCreated', {
    handler: async (context: GitPullRequestTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsGitPullCreated trigger received.');

        for (const pullRequest of context.pullRequests) {
            invocationContext.log(`Id: '${pullRequest.pullRequestId}', Title: '${pullRequest.title}'.`);
            invocationContext.log(`Source: '${pullRequest.sourceRefName}', Target: '${pullRequest.targetRefName}'.`);
        }

        return context.rawPayload;
    },
});
