// @ts-nocheck

export function measureSerializedBytes(value) {
    return JSON.stringify(value).length;
}
export function compareSerializedPayloads(fullPayload, compactPayload) {
    const fullBytes = measureSerializedBytes(fullPayload);
    const compactBytes = measureSerializedBytes(compactPayload);
    const savedBytes = fullBytes - compactBytes;
    return {
        fullBytes,
        compactBytes,
        savedBytes,
        savedPercent: fullBytes > 0 ? Number(((savedBytes / fullBytes) * 100).toFixed(1)) : 0,
    };
}
export function recommendPayloadMode(comparison) {
    return comparison.compactBytes < comparison.fullBytes ? 'compact' : 'full';
}
