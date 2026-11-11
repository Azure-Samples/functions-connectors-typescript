// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

if (process.env.EnablePollingSamples === 'true') {
    for (const [name, register] of [
        ['OnSharepointChangedItemsPoll', connectors.sharepoint.onChangedItems],
        ['OnSharepointDeletedFileItemsPoll', connectors.sharepoint.onDeletedFileItems],
        ['OnSharepointDeletedItemsPoll', connectors.sharepoint.onDeletedItems],
        ['OnSharepointNewFileItemsPoll', connectors.sharepoint.onNewFileItems],
        ['OnSharepointNewItemsPoll', connectors.sharepoint.onNewItems],
        ['OnSharepointNewItemsFromFormPoll', connectors.sharepoint.onNewItemsFromForm],
        ['OnSharepointRecurrenceDigestPoll', connectors.sharepoint.onRecurrenceDigest],
        ['OnSharepointUpdatedFileClassifiedTimesPoll', connectors.sharepoint.onUpdatedFileClassifiedTimes],
        ['OnSharepointUpdatedFileItemsPoll', connectors.sharepoint.onUpdatedFileItems],
        ['OnSharepointUpdatedItemsPoll', connectors.sharepoint.onUpdatedItems],
    ] as const) {
        register(name, {
            deliveryMode: DeliveryMode.Poll,
            connection: 'ConnectorNamespace',
            triggerConfigName: `%${name}TriggerConfigName%`,
            handler: async (context: ConnectorTriggerContext, invocationContext: InvocationContext) => {
                invocationContext.log(`${name} trigger received.`);
                invocationContext.log(`Received '${context.items.length}' item(s) in the polling event.`);
                return context.rawPayload;
            },
        });
    }
}
