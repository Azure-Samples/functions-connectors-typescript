// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, CalendarEventTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onUpcomingEvents('OnUpcomingEvent', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnUpcomingEventTriggerConfigName%',
    handler: async (context: CalendarEventTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnUpcomingEvent trigger (${context.calendarEvents.length} items).`);
        return context.rawPayload;
    },
});
