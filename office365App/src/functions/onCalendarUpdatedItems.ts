// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { CalendarEventTriggerContext, connectors } from '@azure/functions-extensions-connectors';

connectors.office365.onCalendarUpdatedItems('OnCalendarUpdatedItems', {
    handler: async (context: CalendarEventTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log('OnCalendarUpdatedItems trigger received.');

        for (const event of context.calendarEvents) {
            invocationContext.log(`Subject: '${event.subject}'.`);
            invocationContext.log(`Start: '${event.start}'.`);
            invocationContext.log(`End: '${event.end}'.`);
        }

        return context.rawPayload;
    },
});
