// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectors, TeamMemberTriggerContext } from '@azure/functions-extensions-connectors';

connectors.teams.onTeamMemberAdded('OnGroupMembershipAdd', {
    handler: async (context: TeamMemberTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnGroupMembershipAdd trigger received.');

        // NOTE(swapnilnagar): context.members items are typed as Record<string, unknown>.
        for (const member of context.members) {
            invocationContext.log(`Member: '${JSON.stringify(member)}'.`);
        }

        return context.rawPayload;
    },
});
