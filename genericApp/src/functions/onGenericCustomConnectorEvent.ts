// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { InvocationContext } from '@azure/functions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

// NOTE(swapnilnagar): Demonstrates using connectorTrigger with an inline custom item type for a
// connector that does not have a first-class wrapper in @azure/functions-extensions-connectors.
// Define a shape that matches the payload returned by the connector trigger operation.
interface CustomConnectorItem {
    id: string;
    name?: string;
    [key: string]: unknown;
}

connectorTrigger<CustomConnectorItem>('OnGenericCustomConnectorEvent', {
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log('OnGenericCustomConnectorEvent (generic API) trigger received.');
        invocationContext.log(`Received '${context.items.length}' item(s).`);

        for (const item of context.items) {
            invocationContext.log(`Id: '${item.id}', Name: '${item.name ?? '<unset>'}'.`);
        }

        return context.rawPayload;
    },
});
