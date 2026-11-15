// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, CalendarEventTriggerContext } from '@azure/functions-extensions-connectors';

connectors.office365.onCalendarNewItems('OnCalendarNewItems', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnCalendarNewItemsTriggerConfigName%',
    handler: async (context: CalendarEventTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnCalendarNewItems trigger (${context.calendarEvents.length} items).`);
        return context.rawPayload;
    },
});
