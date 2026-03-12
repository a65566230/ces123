// @ts-nocheck

function truncateText(value, maxLength) {
    const text = String(value ?? '');
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}
function summarizeValue(value, depth = 0) {
    if (typeof value === 'string') {
        return truncateText(value, 512);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
        return value;
    }
    if (depth >= 2) {
        return Array.isArray(value) ? '[Array]' : '[Object]';
    }
    if (Array.isArray(value)) {
        return value.slice(0, 5).map((item) => summarizeValue(item, depth + 1));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .slice(0, 10)
            .map(([key, nestedValue]) => [key, summarizeValue(nestedValue, depth + 1)]));
    }
    return truncateText(value, 256);
}
function summarizeStackTrace(stackTrace, maxFrames) {
    return (Array.isArray(stackTrace) ? stackTrace : [])
        .slice(0, maxFrames)
        .map((frame) => ({
        functionName: truncateText(frame?.functionName || '(anonymous)', 120),
        url: truncateText(frame?.url || '', 512),
        lineNumber: frame?.lineNumber,
        columnNumber: frame?.columnNumber,
    }));
}
export function summarizeConsoleLogEntry(entry) {
    return {
        type: entry?.type,
        text: truncateText(entry?.text, 2048),
        args: Array.isArray(entry?.args) ? entry.args.slice(0, 5).map((item) => summarizeValue(item, 0)) : [],
        timestamp: entry?.timestamp,
        url: truncateText(entry?.url || '', 512),
        lineNumber: entry?.lineNumber,
        columnNumber: entry?.columnNumber,
        stackTrace: summarizeStackTrace(entry?.stackTrace, 8),
    };
}
export function summarizeExceptionEntry(entry) {
    return {
        text: truncateText(entry?.text, 4096),
        exceptionId: entry?.exceptionId,
        timestamp: entry?.timestamp,
        url: truncateText(entry?.url || '', 512),
        lineNumber: entry?.lineNumber,
        columnNumber: entry?.columnNumber,
        scriptId: entry?.scriptId,
        stackTrace: summarizeStackTrace(entry?.stackTrace, 12),
    };
}
