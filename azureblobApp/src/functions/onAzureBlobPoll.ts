// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { BlobMetadata } from '@azure/connectors/generated/AzureblobExtensions';
import { connectorTrigger } from '@azure/functions-extensions-connectors';

if (process.env.EnablePollingSamples === 'true') {
    connectorTrigger<BlobMetadata>('OnAzureBlobUpdatedFilePoll', {
        deliveryMode: DeliveryMode.Poll,
        connection: 'ConnectorNamespace',
        triggerConfigName: '%OnAzureBlobUpdatedFilePollTriggerConfigName%',
        handler: async (context, invocationContext: InvocationContext) => {
            invocationContext.log('OnAzureBlobUpdatedFilePoll trigger received.');
            invocationContext.log(`Received '${context.items.length}' item(s) in the polling event.`);
            return context.rawPayload;
        },
    });
}
