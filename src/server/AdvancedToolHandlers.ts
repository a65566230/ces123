// @ts-nocheck

import { PerformanceMonitor } from '../modules/monitor/PerformanceMonitor.js';
import { summarizeExceptionEntry } from '../utils/consolePayloads.js';
import { DetailedDataManager } from '../utils/detailedDataManager.js';
import { logger } from '../utils/logger.js';
export class AdvancedToolHandlers {
    collector;
    consoleMonitor;
    performanceMonitor = null;
    detailedDataManager;
    constructor(collector, consoleMonitor) {
        this.collector = collector;
        this.consoleMonitor = consoleMonitor;
        this.detailedDataManager = DetailedDataManager.getInstance();
    }
    getPerformanceMonitor() {
        if (!this.performanceMonitor) {
            this.performanceMonitor = new PerformanceMonitor(this.collector);
        }
        return this.performanceMonitor;
    }
    async handleNetworkEnable(args) {
        const enableExceptions = args.enableExceptions !== false;
        await this.consoleMonitor.enable({
            enableNetwork: true,
            enableExceptions,
        });
        const status = this.consoleMonitor.getNetworkStatus();
        const result = {
            success: true,
            message: '✅ Network monitoring enabled successfully',
            enabled: status.enabled,
            cdpSessionActive: status.cdpSessionActive,
            listenerCount: status.listenerCount,
            usage: {
                step1: 'Network monitoring is now active',
                step2: 'Navigate to a page using page_navigate tool',
                step3: 'Use network_get_requests to retrieve captured requests',
                step4: 'Use network_get_response_body to get response content',
            },
            important: '⚠️ Network monitoring must be enabled BEFORE navigating to capture requests',
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handleNetworkDisable(_args) {
        await this.consoleMonitor.disable();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Network monitoring disabled',
                    }, null, 2),
                }],
        };
    }
    async handleNetworkGetStatus(_args) {
        const status = this.consoleMonitor.getNetworkStatus();
        let result;
        if (!status.enabled) {
            result = {
                success: false,
                enabled: false,
                message: '❌ Network monitoring is NOT enabled',
                requestCount: 0,
                responseCount: 0,
                nextSteps: {
                    step1: 'Call network_enable tool to start monitoring',
                    step2: 'Then navigate to a page using page_navigate',
                    step3: 'Finally use network_get_requests to see captured requests',
                },
                example: 'network_enable → page_navigate → network_get_requests',
            };
        }
        else {
            result = {
                success: true,
                enabled: true,
                message: `✅ Network monitoring is active. Captured ${status.requestCount} requests and ${status.responseCount} responses.`,
                requestCount: status.requestCount,
                responseCount: status.responseCount,
                listenerCount: status.listenerCount,
                cdpSessionActive: status.cdpSessionActive,
                nextSteps: status.requestCount === 0
                    ? {
                        hint: 'No requests captured yet',
                        action: 'Navigate to a page using page_navigate to capture network traffic',
                    }
                    : {
                        hint: `${status.requestCount} requests captured`,
                        action: 'Use network_get_requests to retrieve them',
                    },
            };
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handleNetworkGetRequests(args) {
        let result;
        if (!this.consoleMonitor.isNetworkEnabled()) {
            result = {
                success: false,
                message: '❌ Network monitoring is not enabled',
                requests: [],
                total: 0,
                error: 'NETWORK_NOT_ENABLED',
                solution: {
                    step1: 'Enable network monitoring: network_enable',
                    step2: 'Navigate to target page: page_navigate(url)',
                    step3: 'Get requests: network_get_requests',
                },
                example: `
// Correct usage:
1. network_enable()
2. page_navigate("https://example.com")
3. network_get_requests()

// ❌ Wrong: Navigating before enabling network monitoring
1. page_navigate("https://example.com")  // Requests won't be captured!
2. network_enable()
3. network_get_requests()  // Returns empty []
        `.trim(),
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        const url = args.url;
        const method = args.method;
        const limit = Math.min(args.limit || 100, 1000);
        let requests = this.consoleMonitor.getNetworkRequests();
        if (requests.length === 0) {
            result = {
                success: true,
                message: '⚠️ No network requests captured yet',
                requests: [],
                total: 0,
                hint: 'Network monitoring is enabled, but no requests have been captured',
                possibleReasons: [
                    '1. You haven\'t navigated to any page yet (use page_navigate)',
                    '2. The page has already loaded before network monitoring was enabled',
                    '3. The page doesn\'t make any network requests',
                ],
                nextAction: 'Navigate to a page using page_navigate tool to capture requests',
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        const originalCount = requests.length;
        if (url) {
            requests = requests.filter(req => req.url.includes(url));
        }
        if (method) {
            requests = requests.filter(req => req.method.toUpperCase() === method.toUpperCase());
        }
        const beforeLimit = requests.length;
        requests = requests.slice(-limit);
        result = {
            success: true,
            message: `✅ Retrieved ${requests.length} network request(s)`,
            requests,
            total: requests.length,
            stats: {
                totalCaptured: originalCount,
                afterFilter: beforeLimit,
                returned: requests.length,
                truncated: beforeLimit > limit,
            },
            filtered: !!(url || method),
            filters: { url, method, limit },
            tip: requests.length > 0
                ? 'Use network_get_response_body(requestId) to get response content'
                : undefined,
        };
        const processedResult = this.detailedDataManager.smartHandle(result, 51200);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(processedResult, null, 2),
                },
            ],
        };
    }
    async handleNetworkGetResponseBody(args) {
        const requestId = args.requestId;
        const maxSize = args.maxSize ?? 100000;
        const returnSummary = args.returnSummary ?? false;
        let result;
        if (!requestId) {
            result = {
                success: false,
                message: 'requestId parameter is required',
                hint: 'Get requestId from network_get_requests tool'
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        if (!this.consoleMonitor.isNetworkEnabled()) {
            result = {
                success: false,
                message: 'Network monitoring is not enabled',
                hint: 'Use network_enable tool first'
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        const body = await this.consoleMonitor.getResponseBody(requestId);
        if (!body) {
            result = {
                success: false,
                message: `No response body found for requestId: ${requestId}`,
                hint: 'The request may not have completed yet, or the requestId is invalid'
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        const originalSize = body.body.length;
        const isTooLarge = originalSize > maxSize;
        if (returnSummary || isTooLarge) {
            const preview = body.body.substring(0, 500);
            result = {
                success: true,
                requestId,
                summary: {
                    size: originalSize,
                    sizeKB: (originalSize / 1024).toFixed(2),
                    base64Encoded: body.base64Encoded,
                    preview: preview + (originalSize > 500 ? '...' : ''),
                    truncated: isTooLarge,
                    reason: isTooLarge
                        ? `Response too large (${(originalSize / 1024).toFixed(2)} KB > ${(maxSize / 1024).toFixed(2)} KB)`
                        : 'Summary mode enabled',
                },
                tip: isTooLarge
                    ? 'Use collect_code tool to collect and compress this script, or increase maxSize parameter'
                    : 'Set returnSummary=false to get full body',
            };
        }
        else {
            result = {
                success: true,
                requestId,
                body: body.body,
                base64Encoded: body.base64Encoded,
                size: originalSize,
                sizeKB: (originalSize / 1024).toFixed(2),
            };
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handleNetworkGetStats(_args) {
        if (!this.consoleMonitor.isNetworkEnabled()) {
            const result = {
                success: false,
                message: 'Network monitoring is not enabled',
                hint: 'Use network_enable tool first'
            };
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
            };
        }
        const requests = this.consoleMonitor.getNetworkRequests();
        const responses = this.consoleMonitor.getNetworkResponses();
        const byMethod = {};
        requests.forEach(req => {
            byMethod[req.method] = (byMethod[req.method] || 0) + 1;
        });
        const byStatus = {};
        responses.forEach(res => {
            byStatus[res.status] = (byStatus[res.status] || 0) + 1;
        });
        const byType = {};
        requests.forEach(req => {
            const type = req.type || 'unknown';
            byType[type] = (byType[type] || 0) + 1;
        });
        const timestamps = requests.map(r => r.timestamp).filter(t => t);
        const timeStats = timestamps.length > 0 ? {
            earliest: Math.min(...timestamps),
            latest: Math.max(...timestamps),
            duration: Math.max(...timestamps) - Math.min(...timestamps)
        } : null;
        const result = {
            success: true,
            stats: {
                totalRequests: requests.length,
                totalResponses: responses.length,
                byMethod,
                byStatus,
                byType,
                timeStats,
                monitoringEnabled: true
            },
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handlePerformanceGetMetrics(args) {
        const includeTimeline = args.includeTimeline === true;
        const monitor = this.getPerformanceMonitor();
        const metrics = await monitor.getPerformanceMetrics();
        const result = {
            success: true,
            metrics,
        };
        if (includeTimeline) {
            result.timeline = await monitor.getPerformanceTimeline();
        }
        return result;
    }
    async handlePerformanceStartCoverage(_args) {
        const monitor = this.getPerformanceMonitor();
        await monitor.startCoverage();
        return {
            success: true,
            message: 'Code coverage collection started',
        };
    }
    async handlePerformanceStopCoverage(_args) {
        const monitor = this.getPerformanceMonitor();
        const coverage = await monitor.stopCoverage();
        return {
            success: true,
            coverage,
            totalScripts: coverage.length,
            avgCoverage: coverage.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverage.length,
        };
    }
    async handlePerformanceTakeHeapSnapshot(_args) {
        const monitor = this.getPerformanceMonitor();
        const snapshot = await monitor.takeHeapSnapshot();
        return {
            success: true,
            snapshotSize: snapshot.length,
            message: 'Heap snapshot taken (data too large to return, saved internally)',
        };
    }
    async handleConsoleGetExceptions(args) {
        const url = args.url;
        const limit = args.limit || 50;
        let exceptions = this.consoleMonitor.getExceptions();
        if (url) {
            exceptions = exceptions.filter(ex => ex.url?.includes(url));
        }
        exceptions = exceptions.slice(0, limit);
        exceptions = exceptions.map((entry) => summarizeExceptionEntry(entry));
        return {
            success: true,
            exceptions,
            total: exceptions.length,
        };
    }
    async handleConsoleInjectScriptMonitor(_args) {
        await this.consoleMonitor.enableDynamicScriptMonitoring();
        return {
            success: true,
            message: 'Dynamic script monitoring enabled',
        };
    }
    async handleConsoleInjectXhrInterceptor(_args) {
        await this.consoleMonitor.injectXHRInterceptor();
        return {
            success: true,
            message: 'XHR interceptor injected',
        };
    }
    async handleConsoleInjectFetchInterceptor(_args) {
        await this.consoleMonitor.injectFetchInterceptor();
        return {
            success: true,
            message: 'Fetch interceptor injected',
        };
    }
    async handleConsoleInjectFunctionTracer(args) {
        const functionName = args.functionName;
        if (!functionName) {
            throw new Error('functionName is required');
        }
        await this.consoleMonitor.injectFunctionTracer(functionName);
        return {
            success: true,
            message: `Function tracer injected for: ${functionName}`,
        };
    }
    async cleanup() {
        if (this.performanceMonitor) {
            await this.performanceMonitor.close();
            this.performanceMonitor = null;
        }
        logger.info('AdvancedToolHandlers cleaned up');
    }
}
//# sourceMappingURL=AdvancedToolHandlers.js.map
