// @ts-nocheck

const INLINE_BYTES_LIMIT = 24 * 1024;
const INLINE_ARRAY_PREVIEW_LIMIT = 12;
const COMPACT_COLLECTION_FIELDS = [
    'items',
    'matches',
    'requests',
    'records',
    'candidateScripts',
    'candidateFunctions',
    'payloadAssemblyHints',
    'finalWriteHints',
];
function safeStringify(value) {
    try {
        const serialized = JSON.stringify(value, null, 2);
        return typeof serialized === 'string' ? serialized : 'null';
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
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && Array.isArray(value) === false;
}
function isCompactableObjectArray(items) {
    return Array.isArray(items)
        && items.length > 0
        && items.every((item) => isPlainObject(item));
}
export function compactCollection(items) {
    if (!isCompactableObjectArray(items)) {
        return items;
    }
    const columns = Array.from(new Set(items.flatMap((item) => Object.keys(item)))).sort();
    return {
        format: 'table',
        columns,
        rows: items.map((item) => columns.map((column) => item[column])),
        rowCount: items.length,
    };
}
export function compactPayload(data) {
    if (isCompactableObjectArray(data)) {
        return compactCollection(data);
    }
    if (!isPlainObject(data)) {
        return data;
    }
    const compacted = { ...data };
    for (const field of COMPACT_COLLECTION_FIELDS) {
        if (isCompactableObjectArray(compacted[field])) {
            compacted[field] = compactCollection(compacted[field]);
        }
    }
    return compacted;
}
export function maybeExternalize(store, kind, summary, data, sessionId) {
    const serialized = safeStringify(data);
    if (serialized.length <= INLINE_BYTES_LIMIT) {
        return { data };
    }
    const artifact = store.create(kind, summary, data, sessionId);
    if (Array.isArray(data)) {
        return {
            artifactId: artifact.id,
            detailId: artifact.id,
            data: data.slice(0, INLINE_ARRAY_PREVIEW_LIMIT),
        };
    }
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
