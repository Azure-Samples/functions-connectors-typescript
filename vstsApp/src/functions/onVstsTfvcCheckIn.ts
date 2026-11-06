// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, TfvcChangesetTriggerContext } from '@azure/functions-extensions-connectors';

connectors.vsts.onTfvcCheckIn('OnVstsTfvcCheckIn', {
    handler: async (context: TfvcChangesetTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnVstsTfvcCheckIn trigger received.');

        for (const changeset of context.changesets) {
            invocationContext.log(`Changeset: '${changeset.changesetId}', Comment: '${changeset.comment}'.`);
            invocationContext.log(`Author: '${changeset.author?.displayName}'.`);
        }

        return context.rawPayload;
    },
});
