// @ts-nocheck

import { DetailedDataManager } from './detailedDataManager.js';
export class AdaptiveDataSerializer {
    DEFAULT_CONTEXT = {
        maxDepth: 3,
        maxArrayLength: 10,
        maxStringLength: 1000,
        maxObjectKeys: 20,
        threshold: 50 * 1024,
    };
    serialize(data, context = {}) {
        const ctx = { ...this.DEFAULT_CONTEXT, ...context };
        const type = this.detectType(data);
        switch (type) {
            case 'large-array':
                return this.serializeLargeArray(data, ctx);
            case 'deep-object':
                return this.serializeDeepObject(data, ctx);
            case 'code-string':
                return this.serializeCodeString(data, ctx);
            case 'network-requests':
                return this.serializeNetworkRequests(data, ctx);
            case 'dom-structure':
                return this.serializeDOMStructure(data, ctx);
            case 'function-tree':
                return this.serializeFunctionTree(data, ctx);
            case 'primitive':
                return JSON.stringify(data);
            default:
                return this.serializeDefault(data, ctx);
        }
    }
    detectType(data) {
        if (data === null || data === undefined) {
            return 'primitive';
        }
        const type = typeof data;
        if (type === 'string' || type === 'number' || type === 'boolean') {
            if (type === 'string' && this.isCodeString(data)) {
                return 'code-string';
            }
            return 'primitive';
        }
        if (Array.isArray(data)) {
            if (data.length > 0 && this.isNetworkRequest(data[0])) {
                return 'network-requests';
            }
            if (data.length > 100) {
                return 'large-array';
            }
        }
        if (type === 'object') {
            if (this.isDOMStructure(data)) {
                return 'dom-structure';
            }
            if (this.isFunctionTree(data)) {
                return 'function-tree';
            }
            if (this.getDepth(data) > 3) {
                return 'deep-object';
            }
        }
        return 'unknown';
    }
    serializeLargeArray(arr, ctx) {
        if (arr.length <= ctx.maxArrayLength) {
            return JSON.stringify(arr);
        }
        const sample = [
            ...arr.slice(0, 5),
            ...arr.slice(-5),
        ];
        const detailId = DetailedDataManager.getInstance().store(arr);
        return JSON.stringify({
            type: 'large-array',
            length: arr.length,
            sample,
            detailId,
            hint: `Use get_detailed_data("${detailId}") to get full array`,
        });
    }
    serializeDeepObject(obj, ctx) {
        const limited = this.limitDepth(obj, ctx.maxDepth);
        return JSON.stringify(limited);
    }
    serializeCodeString(code, _ctx) {
        const lines = code.split('\n');
        if (lines.length <= 100) {
            return JSON.stringify(code);
        }
        const preview = lines.slice(0, 50).join('\n');
        const detailId = DetailedDataManager.getInstance().store(code);
        return JSON.stringify({
            type: 'code-string',
            totalLines: lines.length,
            preview,
            detailId,
            hint: `Use get_detailed_data("${detailId}") to get full code`,
        });
    }
    serializeNetworkRequests(requests, ctx) {
        if (requests.length <= ctx.maxArrayLength) {
            return JSON.stringify(requests);
        }
        const summary = requests.map(req => ({
            requestId: req.requestId,
            url: req.url,
            method: req.method,
            type: req.type,
            timestamp: req.timestamp,
        }));
        const detailId = DetailedDataManager.getInstance().store(requests);
        return JSON.stringify({
            type: 'network-requests',
            count: requests.length,
            summary: summary.slice(0, ctx.maxArrayLength),
            detailId,
            hint: `Use get_detailed_data("${detailId}") to get full requests`,
        });
    }
    serializeDOMStructure(dom, ctx) {
        const limited = this.limitDepth(dom, ctx.maxDepth);
        return JSON.stringify(limited);
    }
    serializeFunctionTree(tree, ctx) {
        const simplified = this.simplifyFunctionTree(tree, ctx.maxDepth);
        return JSON.stringify(simplified);
    }
    serializeDefault(data, ctx) {
        const jsonStr = JSON.stringify(data);
        if (jsonStr.length <= ctx.threshold) {
            return jsonStr;
        }
        const detailId = DetailedDataManager.getInstance().store(data);
        return JSON.stringify({
            type: 'large-data',
            size: jsonStr.length,
            sizeKB: (jsonStr.length / 1024).toFixed(1),
            preview: jsonStr.substring(0, 500),
            detailId,
            hint: `Use get_detailed_data("${detailId}") to get full data`,
        });
    }
    isCodeString(str) {
        if (str.length < 100)
            return false;
        const codePatterns = [
            /function\s+\w+\s*\(/,
            /const\s+\w+\s*=/,
            /let\s+\w+\s*=/,
            /var\s+\w+\s*=/,
            /class\s+\w+/,
            /import\s+.*from/,
            /export\s+(default|const|function)/,
        ];
        return codePatterns.some(pattern => pattern.test(str));
    }
    isNetworkRequest(obj) {
        return obj && typeof obj === 'object' &&
            ('requestId' in obj || 'url' in obj) &&
            ('method' in obj || 'type' in obj);
    }
    isDOMStructure(obj) {
        return obj && typeof obj === 'object' &&
            ('tag' in obj || 'tagName' in obj) &&
            ('children' in obj || 'childNodes' in obj);
    }
    isFunctionTree(obj) {
        return obj && typeof obj === 'object' &&
            ('functionName' in obj || 'name' in obj) &&
            ('dependencies' in obj || 'calls' in obj || 'callGraph' in obj);
    }
    getDepth(obj, currentDepth = 0) {
        if (obj === null || typeof obj !== 'object') {
            return currentDepth;
        }
        if (currentDepth > 10)
            return currentDepth;
        let maxDepth = currentDepth;
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const depth = this.getDepth(obj[key], currentDepth + 1);
                maxDepth = Math.max(maxDepth, depth);
            }
        }
        return maxDepth;
    }
    limitDepth(obj, maxDepth, currentDepth = 0) {
        if (currentDepth >= maxDepth) {
            return '[Max depth reached]';
        }
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.limitDepth(item, maxDepth, currentDepth + 1));
        }
        const result = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                result[key] = this.limitDepth(obj[key], maxDepth, currentDepth + 1);
            }
        }
        return result;
    }
    simplifyFunctionTree(tree, maxDepth, currentDepth = 0) {
        if (currentDepth >= maxDepth) {
            return { name: tree.functionName || tree.name, truncated: true };
        }
        return {
            name: tree.functionName || tree.name,
            dependencies: (tree.dependencies || []).map((dep) => this.simplifyFunctionTree(dep, maxDepth, currentDepth + 1)),
        };
    }
}
//# sourceMappingURL=AdaptiveDataSerializer.js.map