// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { app, DeliveryMode, InvocationContext } from '@azure/functions';
import { connectors, ConnectorTriggerContext } from '@azure/functions-extensions-connectors';

if (process.env.EnablePollingSamples === 'true') {
    for (const [name, register] of [
        ['OnNewChannelMessagePoll', connectors.teams.onNewChannelMessage],
        ['OnNewChannelMessageMentioningMePoll', connectors.teams.onNewChannelMessageMentioningMe],
        ['OnGroupMembershipAddPoll', connectors.teams.onTeamMemberAdded],
        ['OnGroupMembershipRemovalPoll', connectors.teams.onTeamMemberRemoved],
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

    // These operations have event-specific envelopes rather than typed item collections.
    for (const name of [
        'OnWebhookAtMentionPoll',
        'OnWebhookMessageReactionPoll',
        'OnTranscriptAvailablePoll',
        'OnRecordingAvailablePoll',
        'OnWebhookChatMessagePoll',
        'OnWebhookKeywordPoll',
        'OnWebhookNewMessagePoll',
    ]) {
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
}
