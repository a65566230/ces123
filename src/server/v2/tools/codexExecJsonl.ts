// @ts-nocheck

export function parseCodexExecJsonl(raw) {
    const result = {
        threadId: undefined,
        finalText: '',
        usage: undefined,
        events: [],
    };
    for (const line of String(raw || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const event = JSON.parse(trimmed);
            result.events.push(event);
            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
                result.threadId = event.thread_id;
            }
            if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
                result.finalText = event.item.text;
            }
            if (event.type === 'turn.completed' && event.usage) {
                result.usage = event.usage;
            }
        }
        catch {
            // Ignore non-JSON lines in mixed stdout.
        }
    }
    return result;
}
