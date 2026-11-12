// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger('OnGenericConnectorEvent', {
    handler: async (_context, invocationContext) => {
        invocationContext.log('OnGenericConnectorEvent trigger received.');
    },
});
