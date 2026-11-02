// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, GitPushTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onGitPush('OnVstsGitPush', {
    handler: async (context: GitPushTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsGitPush trigger received.');

        for (const push of context.pushes) {
            invocationContext.log(`Push: '${push.pushId}', Repository: '${push.repository?.name}'.`);
            invocationContext.log(`Refs: '${JSON.stringify(push.refUpdates)}'.`);
        }

        return context.rawPayload;
    },
});
