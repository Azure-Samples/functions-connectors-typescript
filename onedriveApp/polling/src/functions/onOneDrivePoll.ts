// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

for (const [name, register] of [
    ['OnOneDriveNewFilePoll', connectors.onedriveforbusiness.onNewFiles],
    ['OnOneDriveUpdatedFilePoll', connectors.onedriveforbusiness.onUpdatedFiles],
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

// File-content operations must bypass metadata normalization.
for (const name of ['OnOneDriveNewFileContentPoll', 'OnOneDriveUpdatedFileContentPoll']) {
    app.connectorTrigger(name, {
        deliveryMode: DeliveryMode.Poll,
        connection: 'ConnectorNamespace',
        triggerConfigName: `%${name}TriggerConfigName%`,
        handler: async (payload: unknown, invocationContext: InvocationContext) => {
            invocationContext.log(`${name} trigger received.`);
            return payload;
        },
    });
}
