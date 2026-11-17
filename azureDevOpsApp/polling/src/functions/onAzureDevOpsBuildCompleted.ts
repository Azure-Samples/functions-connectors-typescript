// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { DeliveryMode, InvocationContext } from '@azure/functions';
import { BuildCompletedTriggerContext, connectors } from '@azure/functions-extensions-connectors';

connectors.vsts.onBuildCompleted('OnAzureDevOpsBuildCompleted', {
    deliveryMode: DeliveryMode.Poll,
    connection: 'ConnectorNamespace',
    triggerConfigName: '%OnAzureDevOpsBuildCompletedTriggerConfigName%',
    handler: async (context: BuildCompletedTriggerContext, invocationContext: InvocationContext) => {
        invocationContext.log(`Received OnAzureDevOpsBuildCompleted trigger (${context.builds.length} items).`);
        return context.rawPayload;
    },
});
