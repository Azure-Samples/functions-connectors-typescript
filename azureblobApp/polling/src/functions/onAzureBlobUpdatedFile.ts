// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { BlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

connectorTrigger<BlobMetadata>('OnAzureBlobUpdatedFile', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureBlobUpdatedFileTriggerConfigName%',
    handler: async (context, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureBlobUpdatedFile trigger (${context.items.length} items).`);
        return context.rawPayload;
    },
});
