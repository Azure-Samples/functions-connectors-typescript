// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { CalendarChangedEventTriggerContext, connectors } from '@azure/functions-extensions-connectors';

connectors.office365.onCalendarChangedItems('OnCalendarChangedItems', {
    handler: async (context: CalendarChangedEventTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnCalendarChangedItems trigger received.');

        for (const event of context.calendarEvents) {
            invocationContext.log(`Subject: '${event.subject}'.`);
            invocationContext.log(`Action: '${event.ActionType}'.`);
            invocationContext.log(`Start: '${event.start}'.`);
        }

        return context.rawPayload;
    },
});
