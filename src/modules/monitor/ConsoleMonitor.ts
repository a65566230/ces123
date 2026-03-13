// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class ConsoleMonitor {
    collector;
    storage;
    sessionId;
    cdpSession = null;
    messages = [];
    MAX_MESSAGES = 1000;
    exceptions = [];
    MAX_EXCEPTIONS = 500;
    networkEnabled = false;
    requests = new Map();
    responses = new Map();
    MAX_NETWORK_RECORDS = 500;
    expectedMissingBodyWarnings = new Map();
    MAX_EXPECTED_MISSING_BODY_WARNINGS = 2;
    networkListeners = {};
    exceptionListener = null;
    objectCache = new Map();
    exceptionsEnabled = false;
    constructor(collector, storage, sessionId) {
        this.collector = collector;
        this.storage = storage;
        this.sessionId = sessionId;
    }
    isClosedTargetError(error) {
        return String(error?.message || error || '').includes('Target page, context or browser has been closed')
            || String(error?.message || error || '').includes('Session closed');
    }
    attachExceptionListener() {
        if (!this.cdpSession || this.exceptionListener) {
            return;
        }
        this.exceptionListener = (params) => {
            const exception = params.exceptionDetails;
            const stackTrace = exception.stackTrace?.callFrames?.map((frame) => ({
                functionName: frame.functionName || '(anonymous)',
                url: frame.url,
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
            })) || [];
            const exceptionInfo = {
                text: exception.exception?.description || exception.text,
                exceptionId: exception.exceptionId,
                timestamp: Date.now(),
                stackTrace,
                url: exception.url,
                lineNumber: exception.lineNumber,
                columnNumber: exception.columnNumber,
                scriptId: exception.scriptId,
            };
            this.exceptions.push(exceptionInfo);
            if (this.exceptions.length > this.MAX_EXCEPTIONS) {
                this.exceptions = this.exceptions.slice(-Math.floor(this.MAX_EXCEPTIONS / 2));
            }
            logger.error(`Exception thrown: ${exceptionInfo.text}`, {
                url: exceptionInfo.url,
                line: exceptionInfo.lineNumber,
            });
        };
        this.cdpSession.on('Runtime.exceptionThrown', this.exceptionListener);
    }
    async enable(options) {
        if (this.cdpSession) {
            logger.warn('ConsoleMonitor already enabled');
            if (options?.enableNetwork === false && this.networkEnabled) {
                if (this.networkListeners.requestWillBeSent) {
                    this.cdpSession.off('Network.requestWillBeSent', this.networkListeners.requestWillBeSent);
                }
                if (this.networkListeners.responseReceived) {
                    this.cdpSession.off('Network.responseReceived', this.networkListeners.responseReceived);
                }
                if (this.networkListeners.loadingFinished) {
                    this.cdpSession.off('Network.loadingFinished', this.networkListeners.loadingFinished);
                }
                await this.cdpSession.send('Network.disable').catch(() => undefined);
                this.networkListeners = {};
                this.networkEnabled = false;
            }
            if (options?.enableNetwork && !this.networkEnabled) {
                await this.enableNetworkMonitoring();
            }
            if (options?.enableExceptions === false && this.exceptionsEnabled) {
                this.cdpSession.off?.('Runtime.exceptionThrown', this.exceptionListener);
                this.exceptionListener = null;
                this.exceptionsEnabled = false;
            }
            if (options?.enableExceptions === true && !this.exceptionsEnabled) {
                this.exceptionsEnabled = true;
                this.attachExceptionListener();
            }
            return;
        }
        const page = await this.collector.getActivePage();
        if (typeof page.createCDPSession === 'function') {
            this.cdpSession = await page.createCDPSession();
        }
        else if (typeof page.context === 'function' && typeof page.context()?.newCDPSession === 'function') {
            this.cdpSession = await page.context().newCDPSession(page);
        }
        else {
            throw new Error('Unable to create a CDP session for the active page');
        }
        await this.cdpSession.send('Runtime.enable');
        await this.cdpSession.send('Console.enable');
        this.cdpSession.on('Runtime.consoleAPICalled', (params) => {
            const stackTrace = params.stackTrace?.callFrames?.map((frame) => ({
                functionName: frame.functionName || '(anonymous)',
                url: frame.url,
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
            })) || [];
            const consoleArgs = Array.isArray(params.args) ? params.args : [];
            const message = {
                type: params.type,
                text: consoleArgs.map((arg) => this.formatRemoteObject(arg)).join(' '),
                args: consoleArgs.map((arg) => this.extractValue(arg)),
                timestamp: params.timestamp,
                stackTrace,
                url: stackTrace[0]?.url,
                lineNumber: stackTrace[0]?.lineNumber,
                columnNumber: stackTrace[0]?.columnNumber,
            };
            this.messages.push(message);
            if (this.messages.length > this.MAX_MESSAGES) {
                this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
            }
            logger.debug(`Console ${params.type}: ${message.text}`);
        });
        this.cdpSession.on('Console.messageAdded', (params) => {
            const msg = params.message;
            const message = {
                type: msg.level,
                text: msg.text,
                timestamp: Date.now(),
                url: msg.url,
                lineNumber: msg.line,
                columnNumber: msg.column,
            };
            this.messages.push(message);
            if (this.messages.length > this.MAX_MESSAGES) {
                this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
            }
        });
        this.exceptionsEnabled = options?.enableExceptions !== false;
        if (this.exceptionsEnabled) {
            this.attachExceptionListener();
        }
        if (options?.enableNetwork) {
            await this.enableNetworkMonitoring();
        }
        logger.info('ConsoleMonitor enabled', {
            network: options?.enableNetwork || false,
            exceptions: this.exceptionsEnabled,
        });
    }
    async disable() {
        if (this.cdpSession) {
            if (this.exceptionListener) {
                this.cdpSession.off?.('Runtime.exceptionThrown', this.exceptionListener);
                this.exceptionListener = null;
            }
            if (this.networkEnabled) {
                if (this.networkListeners.requestWillBeSent) {
                    this.cdpSession.off('Network.requestWillBeSent', this.networkListeners.requestWillBeSent);
                }
                if (this.networkListeners.responseReceived) {
                    this.cdpSession.off('Network.responseReceived', this.networkListeners.responseReceived);
                }
                if (this.networkListeners.loadingFinished) {
                    this.cdpSession.off('Network.loadingFinished', this.networkListeners.loadingFinished);
                }
                try {
                    await this.cdpSession.send('Network.disable');
                }
                catch (error) {
                    if (!this.isClosedTargetError(error)) {
                        logger.warn('Failed to disable Network domain:', error);
                    }
                }
                this.networkListeners = {};
                this.networkEnabled = false;
                logger.info('Network monitoring disabled');
            }
            try {
                await this.cdpSession.send('Console.disable');
            }
            catch (error) {
                if (!this.isClosedTargetError(error)) {
                    logger.warn('Failed to disable Console domain:', error);
                }
            }
            try {
                await this.cdpSession.send('Runtime.disable');
            }
            catch (error) {
                if (!this.isClosedTargetError(error)) {
                    logger.warn('Failed to disable Runtime domain:', error);
                }
            }
            try {
                await this.cdpSession.detach();
            }
            catch (error) {
                if (!this.isClosedTargetError(error)) {
                    logger.warn('Failed to detach ConsoleMonitor session:', error);
                }
            }
            this.cdpSession = null;
            this.exceptionsEnabled = false;
            logger.info('ConsoleMonitor disabled');
        }
    }
    getLogs(filter) {
        let logs = this.messages;
        if (filter?.type) {
            logs = logs.filter(msg => msg.type === filter.type);
        }
        if (filter?.since !== undefined) {
            logs = logs.filter(msg => msg.timestamp >= filter.since);
        }
        if (filter?.limit) {
            logs = logs.slice(-filter.limit);
        }
        logger.info(`getLogs: ${logs.length} messages`);
        return logs;
    }
    async execute(expression) {
        if (!this.cdpSession) {
            await this.enable();
        }
        try {
            const result = await this.cdpSession.send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true,
            });
            if (result.exceptionDetails) {
                logger.error('Console execute error:', result.exceptionDetails);
                throw new Error(result.exceptionDetails.text);
            }
            logger.info(`Console executed: ${expression.substring(0, 50)}...`);
            return result.result.value;
        }
        catch (error) {
            logger.error('Console execute failed:', error);
            throw error;
        }
    }
    async evaluateRuntime(expression, options = {}) {
        if (!this.cdpSession) {
            await this.enable();
        }
        try {
            const result = await this.cdpSession.send('Runtime.evaluate', {
                expression,
                returnByValue: options.returnByValue !== false,
                awaitPromise: options.awaitPromise !== false,
            });
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
            }
            return result.result?.value;
        }
        catch (error) {
            logger.error('Console runtime evaluation failed:', error);
            throw error;
        }
    }
    buildRuntimeMonitorBootstrap() {
        return `
      const root = globalThis.__jshookMonitorV2 = globalThis.__jshookMonitorV2 || {};
      root.version = root.version || 2;
      root.functionTraces = root.functionTraces || {};
      root.interceptors = root.interceptors || {};
      root.interceptors.xhr = root.interceptors.xhr || {
        installed: false,
        records: [],
        urlPattern: null,
        originalXMLHttpRequest: null,
      };
      root.interceptors.fetch = root.interceptors.fetch || {
        installed: false,
        records: [],
        urlPattern: null,
        originalFetch: null,
      };
      root.utils = root.utils || {};
      root.utils.resolvePath = root.utils.resolvePath || function(path) {
        const segments = String(path || '')
          .split('.')
          .map((segment) => segment.trim())
          .filter(Boolean);
        if (segments[0] === 'window' || segments[0] === 'globalThis') {
          segments.shift();
        }
        if (segments.length === 0) {
          return null;
        }
        let parent = globalThis;
        for (let index = 0; index < segments.length - 1; index += 1) {
          if (parent == null) {
            return null;
          }
          parent = parent[segments[index]];
        }
        const key = segments[segments.length - 1];
        if (parent == null || !key) {
          return null;
        }
        return {
          parent,
          key,
          value: parent[key],
        };
      };
      root.utils.serializeValue = root.utils.serializeValue || function(value, depth, seen) {
        const currentDepth = typeof depth === 'number' ? depth : 0;
        const currentSeen = Array.isArray(seen) ? seen : [];
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'undefined') {
          return null;
        }
        if (typeof value === 'function') {
          return '[Function ' + (value.name || 'anonymous') + ']';
        }
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        if (currentDepth >= 3) {
          return Object.prototype.toString.call(value);
        }
        if (currentSeen.indexOf(value) >= 0) {
          return '[Circular]';
        }
        const nextSeen = currentSeen.concat([value]);
        if (Array.isArray(value)) {
          return value.slice(0, 20).map((item) => root.utils.serializeValue(item, currentDepth + 1, nextSeen));
        }
        if (typeof value === 'object') {
          const out = {};
          for (const key of Object.keys(value).slice(0, 20)) {
            out[key] = root.utils.serializeValue(value[key], currentDepth + 1, nextSeen);
          }
          return out;
        }
        try {
          return String(value);
        } catch (_error) {
          return '[Unserializable]';
        }
      };
      root.utils.normalizeHeaders = root.utils.normalizeHeaders || function(headers) {
        const output = {};
        if (!headers) {
          return output;
        }
        if (typeof headers.forEach === 'function') {
          headers.forEach((value, key) => {
            output[key] = value;
          });
          return output;
        }
        if (Array.isArray(headers)) {
          for (const entry of headers) {
            if (Array.isArray(entry) && entry.length >= 2) {
              output[String(entry[0])] = entry[1];
            }
          }
          return output;
        }
        if (typeof headers === 'object') {
          for (const key of Object.keys(headers)) {
            output[key] = headers[key];
          }
        }
        return output;
      };
      root.utils.matchesPattern = root.utils.matchesPattern || function(pattern, candidate) {
        const normalizedPattern = typeof pattern === 'string' ? pattern.trim() : '';
        if (!normalizedPattern) {
          return true;
        }
        const value = String(candidate || '');
        if (normalizedPattern.includes('*')) {
          const escaped = normalizedPattern
            .replace(/[.+?^$(){}|[\\]\\\\]/g, '\\\\$&')
            .replace(/\\*/g, '.*');
          return new RegExp(escaped).test(value);
        }
        return value.includes(normalizedPattern);
      };
    `;
    }
    clearLogs() {
        this.messages = [];
        logger.info('Console logs cleared');
    }
    getStats() {
        const byType = {};
        for (const msg of this.messages) {
            byType[msg.type] = (byType[msg.type] || 0) + 1;
        }
        return {
            totalMessages: this.messages.length,
            byType,
        };
    }
    async close() {
        await this.disable();
    }
    async enableNetworkMonitoring() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        if (this.networkEnabled) {
            logger.warn('Network monitoring already enabled');
            return;
        }
        try {
            await this.cdpSession.send('Network.enable', {
                maxTotalBufferSize: 10000000,
                maxResourceBufferSize: 5000000,
                maxPostDataSize: 65536,
            });
            logger.info('Network domain enabled');
            this.networkListeners.requestWillBeSent = (params) => {
                const request = {
                    requestId: params.requestId,
                    url: params.request.url,
                    method: params.request.method,
                    headers: params.request.headers,
                    postData: params.request.postData,
                    timestamp: params.timestamp,
                    type: params.type,
                    initiator: params.initiator,
                };
                this.requests.set(params.requestId, request);
                if (this.requests.size > this.MAX_NETWORK_RECORDS) {
                    const firstKey = this.requests.keys().next().value;
                    if (firstKey) {
                        this.requests.delete(firstKey);
                    }
                }
                logger.debug(`Network request captured: ${params.request.method} ${params.request.url}`);
            };
            this.networkListeners.responseReceived = (params) => {
                const response = {
                    requestId: params.requestId,
                    url: params.response.url,
                    status: params.response.status,
                    statusText: params.response.statusText,
                    headers: params.response.headers,
                    mimeType: params.response.mimeType,
                    timestamp: params.timestamp,
                    fromCache: params.response.fromDiskCache || params.response.fromServiceWorker,
                    timing: params.response.timing,
                };
                this.responses.set(params.requestId, response);
                if (this.responses.size > this.MAX_NETWORK_RECORDS) {
                    const firstKey = this.responses.keys().next().value;
                    if (firstKey) {
                        this.responses.delete(firstKey);
                    }
                }
                logger.debug(`Network response captured: ${params.response.status} ${params.response.url}`);
            };
            this.networkListeners.loadingFinished = (params) => {
                logger.debug(`Network loading finished: ${params.requestId}`);
                if (this.storage && this.sessionId) {
                    void this.persistNetworkRecord(params.requestId);
                }
            };
            this.cdpSession.on('Network.requestWillBeSent', this.networkListeners.requestWillBeSent);
            this.cdpSession.on('Network.responseReceived', this.networkListeners.responseReceived);
            this.cdpSession.on('Network.loadingFinished', this.networkListeners.loadingFinished);
            this.networkEnabled = true;
            logger.info('✅ Network monitoring enabled successfully', {
                requestListeners: !!this.networkListeners.requestWillBeSent,
                responseListeners: !!this.networkListeners.responseReceived,
                loadingListeners: !!this.networkListeners.loadingFinished,
            });
        }
        catch (error) {
            logger.error('❌ Failed to enable network monitoring:', error);
            this.networkEnabled = false;
            throw error;
        }
    }
    isNetworkEnabled() {
        return this.networkEnabled;
    }
    isEnabled() {
        return this.cdpSession !== null;
    }
    getMonitorState() {
        return {
            enabled: this.isEnabled(),
            networkEnabled: this.networkEnabled,
            exceptionsEnabled: this.exceptionsEnabled,
        };
    }
    getNetworkStatus() {
        return {
            enabled: this.networkEnabled,
            requestCount: this.requests.size,
            responseCount: this.responses.size,
            listenerCount: Object.keys(this.networkListeners).filter(key => this.networkListeners[key] !== undefined).length,
            cdpSessionActive: this.cdpSession !== null,
        };
    }
    getNetworkRequests(filter) {
        let requests = Array.from(this.requests.values());
        if (filter?.requestId) {
            requests = requests.filter(req => req.requestId === filter.requestId);
        }
        if (filter?.url) {
            requests = requests.filter(req => req.url.includes(filter.url));
        }
        if (filter?.method) {
            requests = requests.filter(req => req.method === filter.method);
        }
        if (filter?.limit) {
            requests = requests.slice(-filter.limit);
        }
        return requests;
    }
    getNetworkResponses(filter) {
        let responses = Array.from(this.responses.values());
        if (filter?.requestId) {
            responses = responses.filter(res => res.requestId === filter.requestId);
        }
        if (filter?.url) {
            responses = responses.filter(res => res.url.includes(filter.url));
        }
        if (filter?.status) {
            responses = responses.filter(res => res.status === filter.status);
        }
        if (filter?.limit) {
            responses = responses.slice(-filter.limit);
        }
        return responses;
    }
    getNetworkActivity(requestId) {
        return {
            request: this.requests.get(requestId),
            response: this.responses.get(requestId),
        };
    }
    isExpectedMissingResponseBodyError(error) {
        const message = String(error?.message || error || '');
        return message.includes('No resource with given identifier found')
            || message.includes('Request content was evicted from inspector cache');
    }
    isInspectorCacheEviction(error) {
        const message = String(error?.message || error || '');
        return message.includes('Request content was evicted from inspector cache');
    }
    responseLikelyHasNoBody(request, response) {
        const method = String(request?.method || '').toUpperCase();
        const status = Number(response?.status);
        return method === 'OPTIONS'
            || status === 101
            || status === 103
            || status === 204
            || status === 205
            || status === 304;
    }
    buildExpectedMissingBodyKey(request, response, error) {
        return [
            String(request?.method || '').toUpperCase(),
            Number(response?.status || 0),
            String(response?.mimeType || ''),
            String(response?.url || ''),
            this.isExpectedMissingResponseBodyError(error) ? 'expected-missing-body' : 'unexpected',
        ].join('|');
    }
    async getResponseBody(requestId) {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        if (!this.networkEnabled) {
            logger.error('Network monitoring is not enabled. Call enable() with enableNetwork: true first.');
            return null;
        }
        const request = this.requests.get(requestId);
        const response = this.responses.get(requestId);
        if (!request) {
            logger.error(`Request not found: ${requestId}. Make sure network monitoring was enabled before the request.`);
            return null;
        }
        if (!response) {
            logger.warn(`Response not yet received for request: ${requestId}. The request may still be pending.`);
            return null;
        }
        if (this.responseLikelyHasNoBody(request, response)) {
            return null;
        }
        try {
            const result = await this.cdpSession.send('Network.getResponseBody', {
                requestId,
            });
            logger.info(`Response body retrieved for request: ${requestId}`, {
                url: response.url,
                status: response.status,
                size: result.body.length,
                base64: result.base64Encoded,
            });
            return {
                body: result.body,
                base64Encoded: result.base64Encoded,
            };
        }
        catch (error) {
            const isExpectedMissingBody = this.isExpectedMissingResponseBodyError(error);
            const key = this.buildExpectedMissingBodyKey(request, response, error);
            const seenCount = Number(this.expectedMissingBodyWarnings.get(key) || 0);
            const log = this.isInspectorCacheEviction(error)
                ? logger.debug
                : isExpectedMissingBody
                ? seenCount < this.MAX_EXPECTED_MISSING_BODY_WARNINGS
                    ? logger.warn
                    : logger.debug
                : logger.error;
            this.expectedMissingBodyWarnings.set(key, seenCount + 1);
            log.call(logger, `Failed to get response body for ${requestId}:`, {
                url: response.url,
                status: response.status,
                error: error.message,
                hint: 'The response body may not be available for this request type (e.g., cached, redirected, or failed requests)',
            });
            return null;
        }
    }
    async getAllJavaScriptResponses() {
        const jsResponses = [];
        for (const [requestId, response] of this.responses.entries()) {
            if (response.mimeType.includes('javascript') ||
                response.url.endsWith('.js') ||
                response.url.includes('.js?')) {
                const bodyResult = await this.getResponseBody(requestId);
                if (bodyResult) {
                    const content = bodyResult.base64Encoded
                        ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
                        : bodyResult.body;
                    jsResponses.push({
                        url: response.url,
                        content,
                        size: content.length,
                        requestId,
                    });
                }
            }
        }
        logger.info(`Collected ${jsResponses.length} JavaScript responses`);
        return jsResponses;
    }
    clearNetworkRecords() {
        this.requests.clear();
        this.responses.clear();
        logger.info('Network records cleared');
    }
    shouldPersistResponseBody(request, response) {
        const requestType = String(request?.type || '').toLowerCase();
        const mimeType = String(response?.mimeType || '').toLowerCase();
        const url = String(response?.url || request?.url || '');
        const method = String(request?.method || '').toUpperCase();
        if (['image', 'stylesheet', 'font', 'media'].includes(requestType)) {
            return false;
        }
        if (method === 'GET' || method === 'HEAD') {
            return false;
        }
        if (/https:\/\/(mcs|mon|security)\.zijieapi\.com\//i.test(url)) {
            return false;
        }
        if (mimeType.includes('javascript') ||
            mimeType.includes('ecmascript') ||
            mimeType.includes('wasm') ||
            mimeType.includes('font') ||
            mimeType.includes('image') ||
            mimeType.includes('css')) {
            return false;
        }
        return requestType === 'fetch'
            || requestType === 'xhr'
            || requestType === 'document'
            || mimeType.includes('json')
            || mimeType.includes('xml')
            || mimeType.startsWith('text/');
    }
    async persistNetworkRecord(requestId) {
        if (!this.storage || !this.sessionId) {
            return;
        }
        const request = this.requests.get(requestId);
        const response = this.responses.get(requestId);
        if (!request) {
            return;
        }
        let responseBody;
        if (response && this.shouldPersistResponseBody(request, response)) {
            const body = await this.getResponseBody(requestId).catch(() => null);
            if (body) {
                responseBody = body.base64Encoded
                    ? {
                        base64: body.body,
                        encoding: 'base64',
                    }
                    : {
                        text: body.body,
                        encoding: 'utf8',
                    };
            }
        }
        await this.storage.writeRequestBatch(this.sessionId, [
            {
                requestId: request.requestId,
                url: request.url,
                method: request.method,
                headers: request.headers,
                type: request.type,
                timestamp: typeof request.timestamp === 'number' ? request.timestamp : Date.now(),
                initiator: request.initiator,
                body: request.postData
                    ? {
                        text: typeof request.postData === 'string' ? request.postData : JSON.stringify(request.postData),
                        encoding: 'utf8',
                    }
                    : undefined,
                response: response
                    ? {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                        mimeType: response.mimeType,
                        timestamp: typeof response.timestamp === 'number' ? response.timestamp : Date.now(),
                        fromCache: Boolean(response.fromCache),
                    }
                    : undefined,
                responseBody,
            },
        ]);
    }
    async flushNetworkToStorage() {
        if (!this.storage || !this.sessionId) {
            return;
        }
        for (const requestId of this.requests.keys()) {
            await this.persistNetworkRecord(requestId);
        }
    }
    getNetworkStats() {
        const byMethod = {};
        const byStatus = {};
        const byType = {};
        for (const request of this.requests.values()) {
            byMethod[request.method] = (byMethod[request.method] || 0) + 1;
            if (request.type) {
                byType[request.type] = (byType[request.type] || 0) + 1;
            }
        }
        for (const response of this.responses.values()) {
            byStatus[response.status] = (byStatus[response.status] || 0) + 1;
        }
        return {
            totalRequests: this.requests.size,
            totalResponses: this.responses.size,
            byMethod,
            byStatus,
            byType,
        };
    }
    getExceptions(filter) {
        let exceptions = this.exceptions;
        if (filter?.url) {
            exceptions = exceptions.filter(ex => ex.url?.includes(filter.url));
        }
        if (filter?.since !== undefined) {
            exceptions = exceptions.filter(ex => ex.timestamp >= filter.since);
        }
        if (filter?.limit) {
            exceptions = exceptions.slice(-filter.limit);
        }
        return exceptions;
    }
    clearExceptions() {
        this.exceptions = [];
        logger.info('Exceptions cleared');
    }
    async inspectObject(objectId) {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        if (this.objectCache.has(objectId)) {
            return this.objectCache.get(objectId);
        }
        try {
            const result = await this.cdpSession.send('Runtime.getProperties', {
                objectId,
                ownProperties: true,
                accessorPropertiesOnly: false,
                generatePreview: true,
            });
            const properties = {};
            for (const prop of result.result) {
                if (!prop.value)
                    continue;
                properties[prop.name] = {
                    value: this.extractValue(prop.value),
                    type: prop.value.type,
                    objectId: prop.value.objectId,
                    description: prop.value.description,
                };
            }
            this.objectCache.set(objectId, properties);
            logger.info(`Object inspected: ${objectId}`, {
                propertyCount: Object.keys(properties).length,
            });
            return properties;
        }
        catch (error) {
            logger.error('Failed to inspect object:', error);
            throw error;
        }
    }
    clearObjectCache() {
        this.objectCache.clear();
        logger.info('Object cache cleared');
    }
    async enableDynamicScriptMonitoring() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        const monitorCode = `
      (function() {
        // 防止重复注入
        if (window.__dynamicScriptMonitorInstalled) {
          console.log('[ScriptMonitor] Already installed');
          return;
        }
        window.__dynamicScriptMonitorInstalled = true;

        // 记录所有动态添加的脚本
        const dynamicScripts = [];

        // 1. 监听DOM变化（MutationObserver）
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeName === 'SCRIPT') {
                const script = node;
                const info = {
                  type: 'dynamic',
                  src: script.src || '(inline)',
                  content: script.src ? null : script.textContent,
                  timestamp: Date.now(),
                  async: script.async,
                  defer: script.defer,
                };

                dynamicScripts.push(info);
                console.log('[ScriptMonitor] Dynamic script added:', info);
              }
            });
          });
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });

        // 2. Hook document.createElement('script')
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName) {
          const element = originalCreateElement.call(document, tagName);

          if (tagName.toLowerCase() === 'script') {
            console.log('[ScriptMonitor] Script element created via createElement');

            // 监听src属性变化
            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
              if (name === 'src') {
                console.log('[ScriptMonitor] Script src set to:', value);
              }
              return originalSetAttribute.call(element, name, value);
            };
          }

          return element;
        };

        // 3. Hook eval (危险但有用)
        const originalEval = window.eval;
        window.eval = function(code) {
          console.log('[ScriptMonitor] eval() called with code:',
            typeof code === 'string' ? code.substring(0, 100) + '...' : code);
          return originalEval.call(window, code);
        };

        // 4. Hook Function constructor
        const originalFunction = window.Function;
        window.Function = function(...args) {
          console.log('[ScriptMonitor] Function() constructor called with args:', args);
          return originalFunction.apply(this, args);
        };

        // 5. 暴露API供外部查询
        window.__getDynamicScripts = function() {
          return dynamicScripts;
        };

        console.log('[ScriptMonitor] Dynamic script monitoring enabled');
      })();
    `;
        await this.cdpSession.send('Runtime.evaluate', {
            expression: monitorCode,
        });
        logger.info('Dynamic script monitoring enabled');
    }
    async getDynamicScripts() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        try {
            const result = await this.cdpSession.send('Runtime.evaluate', {
                expression: 'window.__getDynamicScripts ? window.__getDynamicScripts() : []',
                returnByValue: true,
            });
            return result.result.value || [];
        }
        catch (error) {
            logger.error('Failed to get dynamic scripts:', error);
            return [];
        }
    }
    async injectFunctionTracer(functionName, options = {}) {
        const tracerCode = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const functionPath = ${JSON.stringify(String(functionName || ''))};
        const settings = {
          captureArgs: ${options.captureArgs !== false},
          captureReturn: ${options.captureReturn !== false},
          captureStack: ${options.captureStack === true},
        };
        const targetRef = root.utils.resolvePath(functionPath);
        if (!targetRef || typeof targetRef.value !== 'function') {
          return {
            ok: false,
            error: functionPath + ' is not a function',
          };
        }
        let traceState = root.functionTraces[functionPath];
        if (traceState && traceState.active === true) {
          traceState.settings = settings;
          return {
            ok: true,
            functionName: functionPath,
            active: true,
            alreadyActive: true,
            totalRecords: Array.isArray(traceState.records) ? traceState.records.length : 0,
          };
        }
        traceState = traceState || {};
        traceState.original = traceState.original || targetRef.value;
        traceState.records = Array.isArray(traceState.records) ? traceState.records : [];
        traceState.settings = settings;
        traceState.active = true;
        targetRef.parent[targetRef.key] = function(...args) {
          const record = {
            timestamp: Date.now(),
            status: 'pending',
          };
          if (settings.captureArgs) {
            record.args = root.utils.serializeValue(args);
          }
          if (settings.captureStack) {
            record.stack = String(new Error().stack || '');
          }
          traceState.records.push(record);
          try {
            const result = traceState.original.apply(this, args);
            if (result && typeof result.then === 'function') {
              return result.then((value) => {
                record.status = 'resolved';
                record.durationMs = Date.now() - record.timestamp;
                if (settings.captureReturn) {
                  record.returnValue = root.utils.serializeValue(value);
                }
                return value;
              }).catch((error) => {
                record.status = 'rejected';
                record.durationMs = Date.now() - record.timestamp;
                record.error = root.utils.serializeValue(error);
                throw error;
              });
            }
            record.status = 'returned';
            record.durationMs = Date.now() - record.timestamp;
            if (settings.captureReturn) {
              record.returnValue = root.utils.serializeValue(result);
            }
            return result;
          } catch (error) {
            record.status = 'threw';
            record.durationMs = Date.now() - record.timestamp;
            record.error = root.utils.serializeValue(error);
            throw error;
          }
        };
        root.functionTraces[functionPath] = traceState;
        return {
          ok: true,
          functionName: functionPath,
          active: true,
          alreadyActive: false,
          totalRecords: traceState.records.length,
          settings,
        };
      })();
    `;
        const result = await this.evaluateRuntime(tracerCode);
        if (result?.ok === false) {
            throw new Error(result.error || `Function tracer injection failed for ${functionName}`);
        }
        logger.info(`Function tracer injected for: ${functionName}`);
        return result;
    }
    async readFunctionTrace(functionName) {
        const expression = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const functionPath = ${JSON.stringify(String(functionName || ''))};
        const traceState = root.functionTraces[functionPath];
        if (!traceState) {
          return {
            functionName: functionPath,
            active: false,
            totalRecords: 0,
            records: [],
          };
        }
        return {
          functionName: functionPath,
          active: traceState.active === true,
          settings: traceState.settings || {},
          totalRecords: Array.isArray(traceState.records) ? traceState.records.length : 0,
          records: Array.isArray(traceState.records) ? traceState.records : [],
        };
      })();
    `;
        return this.evaluateRuntime(expression);
    }
    async clearFunctionTrace(functionName) {
        const expression = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const functionPath = ${JSON.stringify(String(functionName || ''))};
        const traceState = root.functionTraces[functionPath];
        if (!traceState) {
          return {
            functionName: functionPath,
            cleared: 0,
            active: false,
          };
        }
        const cleared = Array.isArray(traceState.records) ? traceState.records.length : 0;
        traceState.records = [];
        return {
          functionName: functionPath,
          cleared,
          active: traceState.active === true,
        };
      })();
    `;
        return this.evaluateRuntime(expression);
    }
    async stopFunctionTrace(functionName) {
        const expression = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const functionPath = ${JSON.stringify(String(functionName || ''))};
        const traceState = root.functionTraces[functionPath];
        if (!traceState) {
          return {
            functionName: functionPath,
            restored: false,
            totalRecords: 0,
          };
        }
        const targetRef = root.utils.resolvePath(functionPath);
        const restored = Boolean(targetRef && traceState.original);
        if (restored) {
          targetRef.parent[targetRef.key] = traceState.original;
        }
        traceState.active = false;
        return {
          functionName: functionPath,
          restored,
          totalRecords: Array.isArray(traceState.records) ? traceState.records.length : 0,
        };
      })();
    `;
        return this.evaluateRuntime(expression);
    }
    async injectXHRInterceptor(options = {}) {
        const interceptorCode = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const state = root.interceptors.xhr;
        state.records = Array.isArray(state.records) ? state.records : [];
        state.urlPattern = ${JSON.stringify(typeof options.urlPattern === 'string' ? options.urlPattern : '')} || state.urlPattern || '';
        if (state.installed === true) {
          return {
            ok: true,
            type: 'xhr',
            alreadyActive: true,
            urlPattern: state.urlPattern || null,
            totalRecords: state.records.length,
          };
        }
        if (typeof globalThis.XMLHttpRequest !== 'function') {
          return {
            ok: false,
            error: 'XMLHttpRequest is not available in the active page',
          };
        }
        state.originalXMLHttpRequest = state.originalXMLHttpRequest || globalThis.XMLHttpRequest;
        const OriginalXHR = state.originalXMLHttpRequest;
        function InterceptedXMLHttpRequest() {
          const xhr = new OriginalXHR();
          const requestInfo = {
            source: 'xhr',
            method: '',
            url: '',
            requestHeaders: {},
            responseHeaders: '',
            status: 0,
            response: null,
            timestamp: Date.now(),
          };
          const originalOpen = xhr.open;
          xhr.open = function(method, url, ...args) {
            requestInfo.method = method;
            requestInfo.url = typeof url === 'string' ? url : String(url || '');
            return originalOpen.call(xhr, method, url, ...args);
          };
          const originalSetRequestHeader = xhr.setRequestHeader;
          xhr.setRequestHeader = function(header, value) {
            requestInfo.requestHeaders[header] = value;
            return originalSetRequestHeader.call(xhr, header, value);
          };
          const originalSend = xhr.send;
          xhr.send = function(body) {
            requestInfo.body = root.utils.serializeValue(body);
            xhr.addEventListener('loadend', function() {
              requestInfo.status = xhr.status;
              requestInfo.responseHeaders = xhr.getAllResponseHeaders();
              requestInfo.response = root.utils.serializeValue(xhr.response);
              if (root.utils.matchesPattern(state.urlPattern, requestInfo.url)) {
                state.records.push({
                  ...requestInfo,
                  responseHeaders: requestInfo.responseHeaders,
                });
              }
            });
            return originalSend.call(xhr, body);
          };
          return xhr;
        }
        InterceptedXMLHttpRequest.prototype = OriginalXHR.prototype;
        Object.setPrototypeOf(InterceptedXMLHttpRequest, OriginalXHR);
        globalThis.XMLHttpRequest = InterceptedXMLHttpRequest;
        globalThis.__getXHRRequests = function() {
          return state.records;
        };
        state.installed = true;
        return {
          ok: true,
          type: 'xhr',
          alreadyActive: false,
          urlPattern: state.urlPattern || null,
          totalRecords: state.records.length,
        };
      })();
    `;
        const result = await this.evaluateRuntime(interceptorCode);
        if (result?.ok === false) {
            throw new Error(result.error || 'XHR interceptor injection failed');
        }
        logger.info('XHR interceptor injected');
        return result;
    }
    async injectFetchInterceptor(options = {}) {
        const interceptorCode = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const state = root.interceptors.fetch;
        state.records = Array.isArray(state.records) ? state.records : [];
        state.urlPattern = ${JSON.stringify(typeof options.urlPattern === 'string' ? options.urlPattern : '')} || state.urlPattern || '';
        if (state.installed === true) {
          return {
            ok: true,
            type: 'fetch',
            alreadyActive: true,
            urlPattern: state.urlPattern || null,
            totalRecords: state.records.length,
          };
        }
        if (typeof globalThis.fetch !== 'function') {
          return {
            ok: false,
            error: 'fetch is not available in the active page',
          };
        }
        state.originalFetch = state.originalFetch || globalThis.fetch;
        const originalFetch = state.originalFetch;
        globalThis.fetch = function(input, init = {}) {
          const url = typeof input === 'string'
            ? input
            : (input && typeof input.url === 'string' ? input.url : String(input || ''));
          const requestInfo = {
            source: 'fetch',
            url,
            method: init.method || (input && input.method) || 'GET',
            headers: root.utils.normalizeHeaders(init.headers || (input && input.headers)),
            body: root.utils.serializeValue(init.body),
            timestamp: Date.now(),
            status: 0,
            response: null,
          };
          return originalFetch.call(this, input, init).then(async (response) => {
            requestInfo.status = response.status;
            try {
              requestInfo.response = await response.clone().text();
            } catch (_error) {
              requestInfo.response = '[Unable to read response]';
            }
            if (root.utils.matchesPattern(state.urlPattern, requestInfo.url)) {
              state.records.push(requestInfo);
            }
            return response;
          }).catch((error) => {
            requestInfo.error = root.utils.serializeValue(error);
            if (root.utils.matchesPattern(state.urlPattern, requestInfo.url)) {
              state.records.push(requestInfo);
            }
            throw error;
          });
        };
        globalThis.__getFetchRequests = function() {
          return state.records;
        };
        state.installed = true;
        return {
          ok: true,
          type: 'fetch',
          alreadyActive: false,
          urlPattern: state.urlPattern || null,
          totalRecords: state.records.length,
        };
      })();
    `;
        const result = await this.evaluateRuntime(interceptorCode);
        if (result?.ok === false) {
            throw new Error(result.error || 'Fetch interceptor injection failed');
        }
        logger.info('Fetch interceptor injected');
        return result;
    }
    async getXHRRequests() {
        try {
            return await this.evaluateRuntime(`
        (() => {
          ${this.buildRuntimeMonitorBootstrap()}
          return Array.isArray(root.interceptors.xhr.records) ? root.interceptors.xhr.records : [];
        })();
      `);
        }
        catch (error) {
            logger.error('Failed to get XHR requests:', error);
            return [];
        }
    }
    async getFetchRequests() {
        try {
            return await this.evaluateRuntime(`
        (() => {
          ${this.buildRuntimeMonitorBootstrap()}
          return Array.isArray(root.interceptors.fetch.records) ? root.interceptors.fetch.records : [];
        })();
      `);
        }
        catch (error) {
            logger.error('Failed to get Fetch requests:', error);
            return [];
        }
    }
    async readInterceptorRecords(type = 'both', urlPattern) {
        const expression = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const requestedType = ${JSON.stringify(String(type || 'both'))};
        const pattern = ${JSON.stringify(typeof urlPattern === 'string' ? urlPattern : '')};
        let records = [];
        if (requestedType === 'xhr' || requestedType === 'both') {
          records = records.concat(Array.isArray(root.interceptors.xhr.records) ? root.interceptors.xhr.records : []);
        }
        if (requestedType === 'fetch' || requestedType === 'both') {
          records = records.concat(Array.isArray(root.interceptors.fetch.records) ? root.interceptors.fetch.records : []);
        }
        const filtered = records
          .filter((record) => root.utils.matchesPattern(pattern, record && record.url))
          .sort((left, right) => Number(left && left.timestamp || 0) - Number(right && right.timestamp || 0));
        return {
          type: requestedType,
          urlPattern: pattern || null,
          totalRecords: filtered.length,
          records: filtered,
          active: {
            xhr: root.interceptors.xhr.installed === true,
            fetch: root.interceptors.fetch.installed === true,
          },
        };
      })();
    `;
        return this.evaluateRuntime(expression);
    }
    async clearInterceptorRecords(type = 'both') {
        const expression = `
      (() => {
        ${this.buildRuntimeMonitorBootstrap()}
        const requestedType = ${JSON.stringify(String(type || 'both'))};
        let cleared = 0;
        if (requestedType === 'xhr' || requestedType === 'both') {
          cleared += Array.isArray(root.interceptors.xhr.records) ? root.interceptors.xhr.records.length : 0;
          root.interceptors.xhr.records = [];
        }
        if (requestedType === 'fetch' || requestedType === 'both') {
          cleared += Array.isArray(root.interceptors.fetch.records) ? root.interceptors.fetch.records.length : 0;
          root.interceptors.fetch.records = [];
        }
        return {
          type: requestedType,
          cleared,
          active: {
            xhr: root.interceptors.xhr.installed === true,
            fetch: root.interceptors.fetch.installed === true,
          },
        };
      })();
    `;
        return this.evaluateRuntime(expression);
    }
    async injectPropertyWatcher(objectPath, propertyName) {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        const watcherCode = `
      (function() {
        const obj = ${objectPath};
        if (!obj) {
          console.error('[Watcher] Object not found: ${objectPath}');
          return;
        }

        let value = obj.${propertyName};

        Object.defineProperty(obj, '${propertyName}', {
          get: function() {
            console.log('[Watcher] ${objectPath}.${propertyName} accessed, value:', value);
            return value;
          },
          set: function(newValue) {
            console.log('[Watcher] ${objectPath}.${propertyName} changed from', value, 'to', newValue);
            value = newValue;
          },
          enumerable: true,
          configurable: true
        });

        console.log('[Watcher] Property watcher installed for ${objectPath}.${propertyName}');
      })();
    `;
        await this.cdpSession.send('Runtime.evaluate', {
            expression: watcherCode,
        });
        logger.info(`Property watcher injected for: ${objectPath}.${propertyName}`);
    }
    formatRemoteObject(obj) {
        if (obj.value !== undefined) {
            return String(obj.value);
        }
        if (obj.description) {
            return obj.description;
        }
        if (obj.type === 'undefined') {
            return 'undefined';
        }
        if (obj.type === 'object' && obj.subtype === 'null') {
            return 'null';
        }
        return `[${obj.type}]`;
    }
    extractValue(obj) {
        if (obj.value !== undefined) {
            return obj.value;
        }
        if (obj.type === 'undefined') {
            return undefined;
        }
        if (obj.type === 'object' && obj.subtype === 'null') {
            return null;
        }
        if (obj.objectId) {
            return {
                __objectId: obj.objectId,
                __type: obj.type,
                __description: obj.description,
            };
        }
        return obj.description || `[${obj.type}]`;
    }
}
//# sourceMappingURL=ConsoleMonitor.js.map
