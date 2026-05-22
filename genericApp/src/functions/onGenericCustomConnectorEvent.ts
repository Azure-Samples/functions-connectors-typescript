// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, InvocationContext } from '@azure/functions';
import { unwrapTriggerPayload } from '../unwrapTriggerPayload.js';

// NOTE(swapnilnagar): Demonstrates the generic trigger for a connector that does not
// have a generated SDK type in @azure/connectors. Declare an inline shape that matches
// the payload returned by the connector trigger operation.
interface CustomConnectorItem {
    id: string;
    name?: string;
    [key: string]: unknown;
}

app.connectorTrigger('OnGenericCustomConnectorEvent', {
    handler: async (triggerInput: unknown, context: InvocationContext): Promise<unknown> => {
        context.log('OnGenericCustomConnectorEvent trigger received.');

        const [, items] = unwrapTriggerPayload<CustomConnectorItem>(triggerInput);
        context.log(`Received '${items.length}' item(s).`);

        for (const item of items) {
            context.log(`Id: '${item.id}', Name: '${item.name ?? '<unset>'}'.`);
        }

        return triggerInput;
    },
});
