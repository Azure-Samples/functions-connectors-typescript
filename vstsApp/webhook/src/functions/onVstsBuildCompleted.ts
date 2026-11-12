// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { BuildCompletedTriggerContext, connectors } from '@azure/functions-extensions-connectors';

connectors.vsts.onBuildCompleted('OnVstsBuildCompleted', {
    handler: async (context: BuildCompletedTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsBuildCompleted trigger received.');

        for (const build of context.builds) {
            invocationContext.log(`Id: '${build.id}', Build: '${build.buildNumber}'.`);
            invocationContext.log(`Status: '${build.status}', Result: '${build.result}'.`);
        }

        return context.rawPayload;
    },
});
