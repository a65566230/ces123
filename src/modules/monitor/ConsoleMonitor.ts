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
    networkListeners = {};
    objectCache = new Map();
    constructor(collector, storage, sessionId) {
        this.collector = collector;
        this.storage = storage;
        this.sessionId = sessionId;
    }
    async enable(options) {
        if (this.cdpSession) {
            logger.warn('ConsoleMonitor already enabled');
            return;
        }
        const page = await this.collector.getActivePage();
        this.cdpSession = await page.createCDPSession();
        await this.cdpSession.send('Runtime.enable');
        await this.cdpSession.send('Console.enable');
        this.cdpSession.on('Runtime.consoleAPICalled', (params) => {
            const stackTrace = params.stackTrace?.callFrames?.map((frame) => ({
                functionName: frame.functionName || '(anonymous)',
                url: frame.url,
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
            })) || [];
            const message = {
                type: params.type,
                text: params.args.map((arg) => this.formatRemoteObject(arg)).join(' '),
                args: params.args.map((arg) => this.extractValue(arg)),
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
        if (options?.enableExceptions !== false) {
            this.cdpSession.on('Runtime.exceptionThrown', (params) => {
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
            });
        }
        if (options?.enableNetwork) {
            await this.enableNetworkMonitoring();
        }
        logger.info('ConsoleMonitor enabled', {
            network: options?.enableNetwork || false,
            exceptions: options?.enableExceptions !== false,
        });
    }
    async disable() {
        if (this.cdpSession) {
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
                    logger.warn('Failed to disable Network domain:', error);
                }
                this.networkListeners = {};
                this.networkEnabled = false;
                logger.info('Network monitoring disabled');
            }
            await this.cdpSession.send('Console.disable');
            await this.cdpSession.send('Runtime.disable');
            await this.cdpSession.detach();
            this.cdpSession = null;
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
            logger.error(`Failed to get response body for ${requestId}:`, {
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
        if (response) {
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
    async injectFunctionTracer(functionName) {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        const tracerCode = `
      (function() {
        const originalFunc = window.${functionName};
        if (typeof originalFunc !== 'function') {
          console.error('[Tracer] ${functionName} is not a function');
          return;
        }

        window.${functionName} = new Proxy(originalFunc, {
          apply: function(target, thisArg, args) {
            console.log('[Tracer] ${functionName} called with args:', args);
            const startTime = performance.now();

            try {
              const result = target.apply(thisArg, args);
              const endTime = performance.now();
              console.log('[Tracer] ${functionName} returned:', result, 'Time:', (endTime - startTime).toFixed(2), 'ms');
              return result;
            } catch (error) {
              console.error('[Tracer] ${functionName} threw error:', error);
              throw error;
            }
          }
        });

        console.log('[Tracer] ${functionName} is now being traced');
      })();
    `;
        await this.cdpSession.send('Runtime.evaluate', {
            expression: tracerCode,
        });
        logger.info(`Function tracer injected for: ${functionName}`);
    }
    async injectXHRInterceptor() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        const interceptorCode = `
      (function() {
        if (window.__xhrInterceptorInstalled) {
          console.log('[XHRInterceptor] Already installed');
          return;
        }
        window.__xhrInterceptorInstalled = true;

        const xhrRequests = [];
        const originalXHR = window.XMLHttpRequest;

        window.XMLHttpRequest = function() {
          const xhr = new originalXHR();
          const requestInfo = {
            method: '',
            url: '',
            requestHeaders: {},
            responseHeaders: {},
            status: 0,
            response: null,
            timestamp: Date.now(),
          };

          // Hook open
          const originalOpen = xhr.open;
          xhr.open = function(method, url, ...args) {
            requestInfo.method = method;
            requestInfo.url = url;
            console.log('[XHRInterceptor] XHR opened:', method, url);
            return originalOpen.call(xhr, method, url, ...args);
          };

          // Hook setRequestHeader
          const originalSetRequestHeader = xhr.setRequestHeader;
          xhr.setRequestHeader = function(header, value) {
            requestInfo.requestHeaders[header] = value;
            return originalSetRequestHeader.call(xhr, header, value);
          };

          // Hook send
          const originalSend = xhr.send;
          xhr.send = function(body) {
            console.log('[XHRInterceptor] XHR sent:', requestInfo.url, 'Body:', body);

            xhr.addEventListener('load', function() {
              requestInfo.status = xhr.status;
              requestInfo.response = xhr.response;
              requestInfo.responseHeaders = xhr.getAllResponseHeaders();

              xhrRequests.push(requestInfo);
              console.log('[XHRInterceptor] XHR completed:', requestInfo.url, 'Status:', xhr.status);
            });

            return originalSend.call(xhr, body);
          };

          return xhr;
        };

        window.__getXHRRequests = function() {
          return xhrRequests;
        };

        console.log('[XHRInterceptor] XHR interceptor installed');
      })();
    `;
        await this.cdpSession.send('Runtime.evaluate', {
            expression: interceptorCode,
        });
        logger.info('XHR interceptor injected');
    }
    async injectFetchInterceptor() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        const interceptorCode = `
      (function() {
        if (window.__fetchInterceptorInstalled) {
          console.log('[FetchInterceptor] Already installed');
          return;
        }
        window.__fetchInterceptorInstalled = true;

        const fetchRequests = [];
        const originalFetch = window.fetch;

        window.fetch = function(url, options = {}) {
          const requestInfo = {
            url: typeof url === 'string' ? url : url.url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            timestamp: Date.now(),
            response: null,
            status: 0,
          };

          console.log('[FetchInterceptor] Fetch called:', requestInfo.method, requestInfo.url);

          return originalFetch.call(window, url, options).then(async (response) => {
            requestInfo.status = response.status;

            // Clone response to read body
            const clonedResponse = response.clone();
            try {
              requestInfo.response = await clonedResponse.text();
            } catch (e) {
              requestInfo.response = '[Unable to read response]';
            }

            fetchRequests.push(requestInfo);
            console.log('[FetchInterceptor] Fetch completed:', requestInfo.url, 'Status:', response.status);

            return response;
          }).catch((error) => {
            console.error('[FetchInterceptor] Fetch failed:', requestInfo.url, error);
            throw error;
          });
        };

        window.__getFetchRequests = function() {
          return fetchRequests;
        };

        console.log('[FetchInterceptor] Fetch interceptor installed');
      })();
    `;
        await this.cdpSession.send('Runtime.evaluate', {
            expression: interceptorCode,
        });
        logger.info('Fetch interceptor injected');
    }
    async getXHRRequests() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        try {
            const result = await this.cdpSession.send('Runtime.evaluate', {
                expression: 'window.__getXHRRequests ? window.__getXHRRequests() : []',
                returnByValue: true,
            });
            return result.result.value || [];
        }
        catch (error) {
            logger.error('Failed to get XHR requests:', error);
            return [];
        }
    }
    async getFetchRequests() {
        if (!this.cdpSession) {
            throw new Error('CDP session not initialized');
        }
        try {
            const result = await this.cdpSession.send('Runtime.evaluate', {
                expression: 'window.__getFetchRequests ? window.__getFetchRequests() : []',
                returnByValue: true,
            });
            return result.result.value || [];
        }
        catch (error) {
            logger.error('Failed to get Fetch requests:', error);
            return [];
        }
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
