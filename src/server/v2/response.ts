// @ts-nocheck

const INLINE_BYTES_LIMIT = 24 * 1024;
function safeStringify(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return JSON.stringify({ fallback: String(value) }, null, 2);
    }
}
export function toToolResponse(envelope) {
    return {
        content: [
            {
                type: 'text',
                text: safeStringify(envelope),
            },
        ],
        isError: !envelope.ok,
    };
}
export function successResponse(summary, data, options) {
    return toToolResponse({
        ok: true,
        summary,
        data,
        ...options,
    });
}
export function errorResponse(summary, error, options) {
    const message = error instanceof Error ? error.message : String(error);
    return toToolResponse({
        ok: false,
        summary,
        error: message,
        diagnostics: options?.diagnostics,
        nextActions: options?.nextActions,
        evidenceIds: options?.evidenceIds,
        sessionId: options?.sessionId,
        artifactId: options?.artifactId,
        detailId: options?.detailId,
        data: options?.data,
    });
}
export function maybeExternalize(store, kind, summary, data, sessionId) {
    const serialized = safeStringify(data);
    if (serialized.length <= INLINE_BYTES_LIMIT) {
        return { data };
    }
    const artifact = store.create(kind, summary, data, sessionId);
    return {
        artifactId: artifact.id,
        detailId: artifact.id,
        data: {
            sizeBytes: serialized.length,
            preview: summary,
        },
    };
}
//# sourceMappingURL=response.js.map