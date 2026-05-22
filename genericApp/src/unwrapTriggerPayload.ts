// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { TriggerCallbackPayload } from '@azure/connectors';

/**
 * Normalises the raw `triggerInput` delivered by `app.connectorTrigger` into a typed
 * `TriggerCallbackPayload<TItem>` and returns the unwrapped item array.
 *
 * The host may deliver the trigger payload either as a JSON string or an already-parsed
 * object — this helper handles both.
 *
 * @param triggerInput The raw input passed to the trigger handler.
 * @returns A tuple of `[payload, items]` where `items` is `payload.body.value ?? []`.
 */
export function unwrapTriggerPayload<TItem>(
    triggerInput: unknown,
): [TriggerCallbackPayload<TItem>, TItem[]] {
    const payload: TriggerCallbackPayload<TItem> =
        typeof triggerInput === 'string'
            ? (JSON.parse(triggerInput) as TriggerCallbackPayload<TItem>)
            : (triggerInput as TriggerCallbackPayload<TItem>);

    const items = payload.body?.value ?? [];

    return [payload, items];
}
