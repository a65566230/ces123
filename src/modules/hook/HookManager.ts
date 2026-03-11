// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class HookManager {
    storage;
    sessionId;
    hooks = new Map();
    hookScripts = new Map();
    hookMetadata = new Map();
    hookConditions = new Map();
    MAX_HOOK_RECORDS = 1000;
    MAX_TOTAL_RECORDS = 10000;
    constructor(storage, sessionId) {
        this.storage = storage;
        this.sessionId = sessionId;
    }
    async createHook(options) {
        logger.info(`Creating hook for ${options.target} (type: ${options.type})...`);
        try {
            const { target, type, action = 'log', condition, performance = false } = options;
            const hookScript = this.generateHookScript(target, type, action, options.customCode, condition, performance);
            const hookId = `${target}-${type}-${Date.now()}`;
            this.hookScripts.set(hookId, hookScript);
            if (condition) {
                this.hookConditions.set(hookId, condition);
            }
            this.hookMetadata.set(hookId, {
                id: hookId,
                enabled: true,
                createdAt: Date.now(),
                callCount: 0,
                totalExecutionTime: 0,
            });
            if (this.storage && this.sessionId) {
                await this.storage.recordHookEvent(this.sessionId, {
                    hookId,
                    eventType: 'hook-created',
                    summary: `${options.type}:${options.target}`,
                    payload: {
                        target: options.target,
                        type: options.type,
                        action,
                        condition,
                        performance,
                    },
                    createdAt: Date.now(),
                });
            }
            logger.success(`Hook created: ${hookId}`);
            return {
                hookId,
                script: hookScript,
                instructions: this.getInjectionInstructions(type),
            };
        }
        catch (error) {
            logger.error('Failed to create hook', error);
            throw error;
        }
    }
    generateHookScript(target, type, action, customCode, condition, performance = false) {
        switch (type) {
            case 'function':
                return this.generateFunctionHook(target, action, customCode, condition, performance);
            case 'xhr':
                return this.generateXHRHook(action, customCode, condition, performance);
            case 'fetch':
                return this.generateFetchHook(action, customCode, condition, performance);
            case 'websocket':
                return this.generateWebSocketHook(action, customCode, condition, performance);
            case 'localstorage':
                return this.generateLocalStorageHook(action, customCode, condition, performance);
            case 'cookie':
                return this.generateCookieHook(action, customCode, condition, performance);
            case 'eval':
                return this.generateEvalHook(action, customCode, condition, performance);
            case 'object-method':
                return this.generateObjectMethodHook(target, action, customCode, condition, performance);
            default:
                throw new Error(`Unsupported hook type: ${type}`);
        }
    }
    generateFunctionHook(target, action, customCode, condition, performance = false) {
        const conditionCode = condition
            ? `
    // 条件检查
    let callCount = 0;
    let lastCallTime = 0;
    const maxCalls = ${condition.maxCalls || 'Infinity'};
    const minInterval = ${condition.minInterval || 0};
    `
            : '';
        const performanceCode = performance
            ? `
    const startTime = performance.now();
    `
            : '';
        const performanceEndCode = performance
            ? `
    const endTime = performance.now();
    console.log('[Hook] Execution time:', (endTime - startTime).toFixed(2), 'ms');
    `
            : '';
        return `
(function() {
  'use strict';
  ${conditionCode}

  // 保存原始函数
  const originalFunction = ${target};

  if (typeof originalFunction !== 'function') {
    console.error('[Hook] Target is not a function: ${target}');
    return;
  }

  // Hook函数
  ${target} = function(...args) {
    ${condition
            ? `
    // 条件过滤
    const now = Date.now();
    if (callCount >= maxCalls) {
      console.log('[Hook] Max calls reached, skipping');
      return originalFunction.apply(this, args);
    }
    if (now - lastCallTime < minInterval) {
      console.log('[Hook] Min interval not met, skipping');
      return originalFunction.apply(this, args);
    }
    callCount++;
    lastCallTime = now;
    `
            : ''}

    ${performanceCode}

    const hookContext = {
      target: '${target}',
      type: 'function',
      timestamp: Date.now(),
      arguments: args,
      stackTrace: new Error().stack
    };

    console.log('[Hook] Function called:', hookContext);

    ${action === 'block' ? 'return undefined;' : ''}
    ${action === 'modify' && customCode ? customCode : ''}

    // 调用原始函数
    const result = originalFunction.apply(this, args);

    ${performanceEndCode}

    console.log('[Hook] Function result:', result);

    return result;
  };

  console.log('[Hook] Successfully hooked: ${target}');
})();
`.trim();
    }
    generateXHRHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  // 保存原始方法
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;

  // Hook open方法
  XHR.open = function(method, url, async, user, password) {
    // 保存请求信息
    this._hookData = {
      method: method,
      url: url,
      async: async !== false, // 默认异步
      timestamp: Date.now(),
      headers: {},
      stackTrace: new Error().stack
    };

    console.log('[XHR Hook] open:', {
      method: method,
      url: url,
      async: async !== false
    });

    ${action === 'block' ? 'return;' : ''}

    // 调用原始方法
    return originalOpen.apply(this, arguments);
  };

  // Hook setRequestHeader方法
  XHR.setRequestHeader = function(header, value) {
    if (this._hookData) {
      this._hookData.headers[header] = value;
      console.log('[XHR Hook] setRequestHeader:', { header, value });
    }

    return originalSetRequestHeader.apply(this, arguments);
  };

  // Hook send方法
  XHR.send = function(data) {
    const xhr = this;

    if (xhr._hookData) {
      xhr._hookData.requestData = data;
      xhr._hookData.sendTime = Date.now();

      console.log('[XHR Hook] send:', {
        url: xhr._hookData.url,
        method: xhr._hookData.method,
        headers: xhr._hookData.headers,
        data: data
      });
    }

    // Hook响应处理
    const originalOnReadyStateChange = xhr.onreadystatechange;

    xhr.onreadystatechange = function() {
      // readyState === 4 表示请求完成
      if (xhr.readyState === 4) {
        const responseTime = Date.now() - (xhr._hookData?.sendTime || 0);

        console.log('[XHR Hook] response:', {
          url: xhr._hookData?.url,
          status: xhr.status,
          statusText: xhr.statusText,
          responseTime: responseTime + 'ms',
          responseHeaders: xhr.getAllResponseHeaders(),
          responseType: xhr.responseType,
          responseURL: xhr.responseURL
        });

        // 根据responseType记录响应内容
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            console.log('[XHR Hook] responseText:', xhr.responseText?.substring(0, 500));
          } else if (xhr.responseType === 'json') {
            console.log('[XHR Hook] responseJSON:', xhr.response);
          } else {
            console.log('[XHR Hook] response:', typeof xhr.response);
          }
        } catch (e) {
          console.warn('[XHR Hook] Failed to log response:', e);
        }
      }

      // 调用原始的onreadystatechange
      if (originalOnReadyStateChange) {
        return originalOnReadyStateChange.apply(this, arguments);
      }
    };

    // 也Hook addEventListener('load')
    const originalAddEventListener = xhr.addEventListener;
    xhr.addEventListener = function(event, listener, ...args) {
      if (event === 'load' || event === 'error' || event === 'abort') {
        const wrappedListener = function(e) {
          console.log(\`[XHR Hook] event '\${event}':\`, {
            url: xhr._hookData?.url,
            status: xhr.status
          });
          return listener.apply(this, arguments);
        };
        return originalAddEventListener.call(this, event, wrappedListener, ...args);
      }
      return originalAddEventListener.apply(this, arguments);
    };

    ${customCode || ''}

    // 调用原始send
    return originalSend.apply(this, arguments);
  };
  
  console.log('[Hook] XHR hooked successfully');
})();
`.trim();
    }
    generateFetchHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  const originalFetch = window.fetch;

  // 使用Proxy包装fetch (更强大的拦截方式)
  window.fetch = new Proxy(originalFetch, {
    apply: function(target, thisArg, args) {
      const [resource, config] = args;

      // 解析请求信息
      let url, method, headers, body;

      if (resource instanceof Request) {
        // 如果是Request对象
        url = resource.url;
        method = resource.method;
        headers = Object.fromEntries(resource.headers.entries());
        body = resource.body;
      } else {
        // 如果是URL字符串
        url = resource;
        method = config?.method || 'GET';
        headers = config?.headers || {};
        body = config?.body;
      }

      const hookContext = {
        url: url,
        method: method,
        headers: headers,
        body: body,
        timestamp: Date.now(),
        stackTrace: new Error().stack.split('\\n').slice(2, 5).join('\\n') // 简化调用栈
      };

      console.log('[Fetch Hook] request:', hookContext);

      ${action === 'block' ? 'return Promise.reject(new Error("Fetch blocked by hook"));' : ''}
      ${customCode || ''}

      // 调用原始fetch
      const startTime = performance.now();

      return Reflect.apply(target, thisArg, args)
        .then(async response => {
          const endTime = performance.now();
          const duration = (endTime - startTime).toFixed(2);

          // Clone响应以便读取 (重要: Response只能读取一次)
          const clonedResponse = response.clone();

          // 记录响应基本信息
          const responseInfo = {
            url: url,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            redirected: response.redirected,
            type: response.type,
            headers: Object.fromEntries(response.headers.entries()),
            duration: duration + 'ms'
          };

          console.log('[Fetch Hook] response:', responseInfo);

          // 尝试读取响应内容 (根据Content-Type)
          try {
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
              const json = await clonedResponse.json();
              console.log('[Fetch Hook] responseJSON:', json);
            } else if (contentType.includes('text/')) {
              const text = await clonedResponse.text();
              console.log('[Fetch Hook] responseText:', text.substring(0, 500));
            } else {
              console.log('[Fetch Hook] response type:', contentType);
            }
          } catch (e) {
            console.warn('[Fetch Hook] Failed to parse response:', e.message);
          }

          return response;
        })
        .catch(error => {
          const endTime = performance.now();
          const duration = (endTime - startTime).toFixed(2);

          console.error('[Fetch Hook] error:', {
            url: url,
            error: error.message,
            duration: duration + 'ms'
          });

          throw error;
        });
    }
  });

  console.log('[Fetch Hook] Successfully hooked window.fetch');
})();
`.trim();
    }
    generateWebSocketHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  const OriginalWebSocket = window.WebSocket;
  let wsCounter = 0;

  window.WebSocket = function(url, protocols) {
    const wsId = ++wsCounter;
    const connectTime = Date.now();

    console.log(\`[WebSocket Hook #\${wsId}] connecting:\`, {
      url: url,
      protocols: protocols,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'throw new Error("WebSocket blocked by hook");' : ''}

    // 创建原始WebSocket实例
    const ws = new OriginalWebSocket(url, protocols);

    // Hook send方法
    const originalSend = ws.send;
    ws.send = function(data) {
      const dataInfo = {
        wsId: wsId,
        url: url,
        timestamp: new Date().toISOString(),
        dataType: typeof data,
        size: data?.length || data?.byteLength || data?.size || 0
      };

      // 根据数据类型记录内容
      if (typeof data === 'string') {
        dataInfo.content = data.length > 500 ? data.substring(0, 500) + '...' : data;
      } else if (data instanceof ArrayBuffer) {
        dataInfo.content = \`ArrayBuffer(\${data.byteLength} bytes)\`;
      } else if (data instanceof Blob) {
        dataInfo.content = \`Blob(\${data.size} bytes, \${data.type})\`;
      }

      console.log(\`[WebSocket Hook #\${wsId}] send:\`, dataInfo);

      ${customCode || ''}

      return originalSend.apply(this, arguments);
    };

    // Hook open事件
    ws.addEventListener('open', function(event) {
      const duration = Date.now() - connectTime;
      console.log(\`[WebSocket Hook #\${wsId}] open:\`, {
        url: url,
        readyState: ws.readyState,
        protocol: ws.protocol,
        extensions: ws.extensions,
        duration: duration + 'ms'
      });
    });

    // Hook message事件
    ws.addEventListener('message', function(event) {
      const messageInfo = {
        wsId: wsId,
        url: url,
        timestamp: new Date().toISOString(),
        dataType: typeof event.data
      };

      // 根据数据类型记录内容
      if (typeof event.data === 'string') {
        messageInfo.content = event.data.length > 500 ? event.data.substring(0, 500) + '...' : event.data;
      } else if (event.data instanceof ArrayBuffer) {
        messageInfo.content = \`ArrayBuffer(\${event.data.byteLength} bytes)\`;
      } else if (event.data instanceof Blob) {
        messageInfo.content = \`Blob(\${event.data.size} bytes, \${event.data.type})\`;
      }

      console.log(\`[WebSocket Hook #\${wsId}] message:\`, messageInfo);
    });

    // Hook error事件
    ws.addEventListener('error', function(event) {
      console.error(\`[WebSocket Hook #\${wsId}] error:\`, {
        url: url,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    });

    // Hook close事件
    ws.addEventListener('close', function(event) {
      const duration = Date.now() - connectTime;
      console.log(\`[WebSocket Hook #\${wsId}] close:\`, {
        url: url,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        duration: duration + 'ms',
        timestamp: new Date().toISOString()
      });
    });

    return ws;
  };

  // 复制原始WebSocket的静态属性
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  console.log('[WebSocket Hook] Successfully hooked window.WebSocket');
})();
`.trim();
    }
    generateLocalStorageHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  // 保存原始方法
  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  // Hook setItem
  Storage.prototype.setItem = function(key, value) {
    const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
    const stackTrace = new Error().stack.split('\\n').slice(2, 4).join('\\n');

    console.log(\`[Storage Hook] \${storageType}.setItem:\`, {
      key: key,
      value: value,
      valueType: typeof value,
      valueLength: value?.length || 0,
      stackTrace: stackTrace
    });

    ${action === 'block' ? 'return;' : ''}
    ${customCode || ''}

    return originalSetItem.apply(this, arguments);
  };

  // Hook getItem
  Storage.prototype.getItem = function(key) {
    const value = originalGetItem.apply(this, arguments);
    const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';

    console.log(\`[Storage Hook] \${storageType}.getItem:\`, {
      key: key,
      value: value,
      found: value !== null
    });

    return value;
  };

  // Hook removeItem
  Storage.prototype.removeItem = function(key) {
    const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
    const oldValue = this.getItem(key);

    console.log(\`[Storage Hook] \${storageType}.removeItem:\`, {
      key: key,
      oldValue: oldValue
    });

    return originalRemoveItem.apply(this, arguments);
  };

  // Hook clear
  Storage.prototype.clear = function() {
    const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
    const itemCount = this.length;

    console.log(\`[Storage Hook] \${storageType}.clear:\`, {
      itemCount: itemCount,
      items: Object.keys(this)
    });

    return originalClear.apply(this, arguments);
  };

  console.log('[Storage Hook] Successfully hooked localStorage and sessionStorage');
})();
`.trim();
    }
    generateCookieHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  // 获取原始cookie描述符
  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                           Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

  if (!cookieDescriptor) {
    console.error('[Cookie Hook] Failed to get cookie descriptor');
    return;
  }

  const originalGet = cookieDescriptor.get;
  const originalSet = cookieDescriptor.set;

  // 解析cookie字符串
  function parseCookie(cookieString) {
    const parts = cookieString.split(';')[0].split('=');
    return {
      name: parts[0]?.trim(),
      value: parts[1]?.trim(),
      raw: cookieString
    };
  }

  // 重新定义document.cookie
  Object.defineProperty(document, 'cookie', {
    get: function() {
      const value = originalGet.call(this);

      console.log('[Cookie Hook] get:', {
        value: value,
        cookieCount: value ? value.split(';').length : 0
      });

      return value;
    },
    set: function(value) {
      const cookieInfo = parseCookie(value);
      const stackTrace = new Error().stack.split('\\n').slice(2, 4).join('\\n');

      console.log('[Cookie Hook] set:', {
        name: cookieInfo.name,
        value: cookieInfo.value,
        raw: cookieInfo.raw,
        stackTrace: stackTrace
      });

      ${action === 'block' ? 'return;' : ''}
      ${customCode || ''}

      return originalSet.call(this, value);
    },
    configurable: true
  });

  console.log('[Cookie Hook] Successfully hooked document.cookie');
})();
`.trim();
    }
    getInjectionInstructions(type) {
        const baseInstructions = `
To inject this hook:

1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Copy and paste the hook script
4. Press Enter to execute

The hook will start monitoring ${type} operations immediately.
`.trim();
        return baseInstructions;
    }
    recordHookEvent(hookId, context) {
        const record = {
            hookId,
            timestamp: Date.now(),
            context,
        };
        const records = this.hooks.get(hookId) || [];
        records.push(record);
        this.hooks.set(hookId, records);
        logger.debug(`Hook event recorded: ${hookId}`);
    }
    getHookRecords(hookId) {
        return this.hooks.get(hookId) || [];
    }
    clearHookRecords(hookId) {
        if (hookId) {
            this.hooks.delete(hookId);
            logger.info(`Cleared records for hook: ${hookId}`);
        }
        else {
            this.hooks.clear();
            logger.info('Cleared all hook records');
        }
    }
    generateEvalHook(action, customCode, _condition, _performance = false) {
        return `
(function() {
  'use strict';

  // 保存原始函数
  const originalEval = window.eval;
  const originalFunction = window.Function;
  const originalSetTimeout = window.setTimeout;
  const originalSetInterval = window.setInterval;

  let evalCounter = 0;

  // Hook eval
  window.eval = function(code) {
    const evalId = ++evalCounter;
    const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

    console.log(\`[Eval Hook #\${evalId}] eval:\`, {
      code: typeof code === 'string' ? (code.length > 200 ? code.substring(0, 200) + '...' : code) : code,
      codeType: typeof code,
      codeLength: code?.length || 0,
      stackTrace: stackTrace,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'return undefined;' : ''}
    ${customCode || ''}

    try {
      const result = originalEval.call(this, code);
      console.log(\`[Eval Hook #\${evalId}] result:\`, typeof result);
      return result;
    } catch (error) {
      console.error(\`[Eval Hook #\${evalId}] error:\`, error.message);
      throw error;
    }
  };

  // Hook Function constructor
  window.Function = function(...args) {
    const evalId = ++evalCounter;
    const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

    // Function构造函数的最后一个参数是函数体,前面的是参数名
    const functionBody = args[args.length - 1];
    const functionParams = args.slice(0, -1);

    console.log(\`[Eval Hook #\${evalId}] Function constructor:\`, {
      params: functionParams,
      body: typeof functionBody === 'string' ?
        (functionBody.length > 200 ? functionBody.substring(0, 200) + '...' : functionBody) :
        functionBody,
      bodyLength: functionBody?.length || 0,
      stackTrace: stackTrace,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'return function() {};' : ''}
    ${customCode || ''}

    try {
      const result = originalFunction.apply(this, args);
      console.log(\`[Eval Hook #\${evalId}] Function created\`);
      return result;
    } catch (error) {
      console.error(\`[Eval Hook #\${evalId}] error:\`, error.message);
      throw error;
    }
  };

  // Hook setTimeout (可以接受字符串代码)
  window.setTimeout = function(handler, timeout, ...args) {
    if (typeof handler === 'string') {
      const evalId = ++evalCounter;
      console.log(\`[Eval Hook #\${evalId}] setTimeout with code:\`, {
        code: handler.length > 200 ? handler.substring(0, 200) + '...' : handler,
        timeout: timeout,
        timestamp: new Date().toISOString()
      });

      ${action === 'block' ? 'return 0;' : ''}
    }

    return originalSetTimeout.apply(this, [handler, timeout, ...args]);
  };

  // Hook setInterval (可以接受字符串代码)
  window.setInterval = function(handler, timeout, ...args) {
    if (typeof handler === 'string') {
      const evalId = ++evalCounter;
      console.log(\`[Eval Hook #\${evalId}] setInterval with code:\`, {
        code: handler.length > 200 ? handler.substring(0, 200) + '...' : handler,
        timeout: timeout,
        timestamp: new Date().toISOString()
      });

      ${action === 'block' ? 'return 0;' : ''}
    }

    return originalSetInterval.apply(this, [handler, timeout, ...args]);
  };

  console.log('[Eval Hook] Successfully hooked eval, Function, setTimeout, setInterval');
})();
`.trim();
    }
    generateObjectMethodHook(target, action, customCode, _condition, _performance = false) {
        const parts = target.split('.');
        const methodName = parts.pop();
        const objectPath = parts.join('.');
        return `
(function() {
  'use strict';

  // 解析对象路径
  function getObjectByPath(path) {
    const parts = path.split('.');
    let obj = window;

    for (const part of parts) {
      if (part === 'window') continue;
      if (!obj || !(part in obj)) {
        return null;
      }
      obj = obj[part];
    }

    return obj;
  }

  const targetObject = getObjectByPath('${objectPath}');
  const methodName = '${methodName}';

  if (!targetObject) {
    console.error('[Object Hook] Target object not found: ${objectPath}');
    return;
  }

  // 检查是否是方法
  const descriptor = Object.getOwnPropertyDescriptor(targetObject, methodName) ||
                     Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetObject), methodName);

  if (!descriptor) {
    console.error('[Object Hook] Property not found: ${target}');
    return;
  }

  let callCounter = 0;

  // 如果是普通方法
  if (typeof targetObject[methodName] === 'function') {
    const originalMethod = targetObject[methodName];

    targetObject[methodName] = function(...args) {
      const callId = ++callCounter;
      const startTime = performance.now();
      const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

      console.log(\`[Object Hook #\${callId}] ${target}:\`, {
        arguments: args,
        this: this,
        thisType: this?.constructor?.name,
        stackTrace: stackTrace,
        timestamp: new Date().toISOString()
      });

      ${action === 'block' ? 'return undefined;' : ''}
      ${customCode || ''}

      try {
        const result = originalMethod.apply(this, args);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        console.log(\`[Object Hook #\${callId}] ${target} result:\`, {
          result: result,
          resultType: typeof result,
          duration: duration + 'ms'
        });

        return result;
      } catch (error) {
        console.error(\`[Object Hook #\${callId}] ${target} error:\`, error);
        throw error;
      }
    };

    // 保留原始方法的属性
    Object.setPrototypeOf(targetObject[methodName], originalMethod);

    console.log('[Object Hook] Successfully hooked method: ${target}');
  }
  // 如果是getter/setter
  else if (descriptor.get || descriptor.set) {
    const originalGet = descriptor.get;
    const originalSet = descriptor.set;

    Object.defineProperty(targetObject, methodName, {
      get: function() {
        console.log('[Object Hook] getter called: ${target}');
        return originalGet ? originalGet.call(this) : undefined;
      },
      set: function(value) {
        console.log('[Object Hook] setter called: ${target}', { value });
        ${action === 'block' ? 'return;' : ''}
        if (originalSet) {
          originalSet.call(this, value);
        }
      },
      configurable: true,
      enumerable: descriptor.enumerable
    });

    console.log('[Object Hook] Successfully hooked property: ${target}');
  }
})();
`.trim();
    }
    enableHook(hookId) {
        const metadata = this.hookMetadata.get(hookId);
        if (metadata) {
            metadata.enabled = true;
            logger.info(`Hook enabled: ${hookId}`);
        }
        else {
            logger.warn(`Hook not found: ${hookId}`);
        }
    }
    disableHook(hookId) {
        const metadata = this.hookMetadata.get(hookId);
        if (metadata) {
            metadata.enabled = false;
            logger.info(`Hook disabled: ${hookId}`);
        }
        else {
            logger.warn(`Hook not found: ${hookId}`);
        }
    }
    getHookMetadata(hookId) {
        return this.hookMetadata.get(hookId);
    }
    getAllHookMetadata() {
        return Array.from(this.hookMetadata.values());
    }
    exportHookData(hookId) {
        if (hookId) {
            const metadata = this.hookMetadata.get(hookId);
            const records = this.hooks.get(hookId) || [];
            const script = this.hookScripts.get(hookId) || '';
            return {
                metadata: metadata ? [metadata] : [],
                records: { [hookId]: records },
                scripts: { [hookId]: script },
            };
        }
        const metadata = Array.from(this.hookMetadata.values());
        const records = {};
        const scripts = {};
        this.hooks.forEach((value, key) => {
            records[key] = value;
        });
        this.hookScripts.forEach((value, key) => {
            scripts[key] = value;
        });
        return { metadata, records, scripts };
    }
    getHookStats(hookId) {
        const metadata = this.hookMetadata.get(hookId);
        if (!metadata) {
            return null;
        }
        return {
            callCount: metadata.callCount,
            avgExecutionTime: metadata.callCount > 0 ? metadata.totalExecutionTime / metadata.callCount : 0,
            totalExecutionTime: metadata.totalExecutionTime,
            enabled: metadata.enabled,
        };
    }
    deleteHook(hookId) {
        this.hookScripts.delete(hookId);
        this.hookMetadata.delete(hookId);
        this.hookConditions.delete(hookId);
        this.hooks.delete(hookId);
        logger.info(`Hook deleted: ${hookId}`);
    }
    getAllHooks() {
        return Array.from(this.hookScripts.keys());
    }
    recordHookCall(hookId, record) {
        if (!this.hooks.has(hookId)) {
            this.hooks.set(hookId, []);
        }
        const records = this.hooks.get(hookId);
        if (records.length >= this.MAX_HOOK_RECORDS) {
            records.shift();
            logger.debug(`Hook ${hookId} reached max records, removed oldest`);
        }
        records.push(record);
        const totalRecords = Array.from(this.hooks.values()).reduce((sum, arr) => sum + arr.length, 0);
        if (totalRecords > this.MAX_TOTAL_RECORDS) {
            this.cleanupOldestRecords();
        }
        const metadata = this.hookMetadata.get(hookId);
        if (metadata) {
            metadata.callCount++;
            metadata.lastCalled = Date.now();
        }
    }
    cleanupOldestRecords() {
        let oldestHookId = null;
        let oldestTimestamp = Infinity;
        for (const [hookId, records] of this.hooks.entries()) {
            if (records.length > 0) {
                const firstRecord = records[0];
                if (firstRecord && firstRecord.timestamp < oldestTimestamp) {
                    oldestTimestamp = firstRecord.timestamp;
                    oldestHookId = hookId;
                }
            }
        }
        if (oldestHookId) {
            const records = this.hooks.get(oldestHookId);
            const removeCount = Math.floor(records.length / 2);
            records.splice(0, removeCount);
            logger.warn(`Cleaned up ${removeCount} old records from ${oldestHookId} (total records exceeded limit)`);
        }
    }
    getHookRecordsStats() {
        let totalRecords = 0;
        let oldestRecord = null;
        let newestRecord = null;
        const recordsByHook = {};
        for (const [hookId, records] of this.hooks.entries()) {
            recordsByHook[hookId] = records.length;
            totalRecords += records.length;
            if (records.length > 0) {
                const firstRecord = records[0];
                const lastRecord = records[records.length - 1];
                if (firstRecord) {
                    const firstTimestamp = firstRecord.timestamp;
                    if (oldestRecord === null || firstTimestamp < oldestRecord) {
                        oldestRecord = firstTimestamp;
                    }
                }
                if (lastRecord) {
                    const lastTimestamp = lastRecord.timestamp;
                    if (newestRecord === null || lastTimestamp > newestRecord) {
                        newestRecord = lastTimestamp;
                    }
                }
            }
        }
        return {
            totalHooks: this.hooks.size,
            totalRecords,
            recordsByHook,
            oldestRecord,
            newestRecord,
        };
    }
    generateAntiDebugBypass() {
        return `
(function() {
  'use strict';

  console.log('[Anti-Debug Bypass] Initializing...');

  // 1. 禁用debugger语句
  const originalEval = window.eval;
  window.eval = function(code) {
    if (typeof code === 'string') {
      // 移除debugger语句
      code = code.replace(/debugger\\s*;?/g, '');
    }
    return originalEval.call(this, code);
  };

  const originalFunction = window.Function;
  window.Function = function(...args) {
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'string') {
        args[args.length - 1] = lastArg.replace(/debugger\\s*;?/g, '');
      }
    }
    return originalFunction.apply(this, args);
  };

  // 2. 绕过DevTools检测
  Object.defineProperty(window, 'outerHeight', {
    get: function() {
      return window.innerHeight;
    }
  });

  Object.defineProperty(window, 'outerWidth', {
    get: function() {
      return window.innerWidth;
    }
  });

  // 3. 绕过时间差检测
  let lastTime = Date.now();
  const originalDateNow = Date.now;
  Date.now = function() {
    const currentTime = originalDateNow();
    // 如果时间差异过大(可能是debugger暂停),返回正常的时间增量
    if (currentTime - lastTime > 100) {
      lastTime += 16; // 模拟正常的帧时间
      return lastTime;
    }
    lastTime = currentTime;
    return currentTime;
  };

  // 4. 绕过toString检测
  const originalToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    if (this === window.eval || this === window.Function) {
      return 'function () { [native code] }';
    }
    return originalToString.call(this);
  };

  // 5. 绕过控制台检测
  const devtools = { open: false };
  const threshold = 160;

  setInterval(function() {
    if (window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold) {
      devtools.open = true;
    } else {
      devtools.open = false;
    }
  }, 500);

  // 覆盖devtools检测
  Object.defineProperty(window, 'devtools', {
    get: function() {
      return { open: false };
    }
  });

  console.log('[Anti-Debug Bypass] Successfully bypassed anti-debugging protections');
})();
`.trim();
    }
    generateHookTemplate(targetName, targetType) {
        if (targetType === 'function') {
            return `
(function() {
  'use strict';

  const original = ${targetName};

  ${targetName} = function(...args) {
    console.log('[Hook] ${targetName} called:', args);

    // 在这里添加自定义逻辑

    const result = original.apply(this, args);
    console.log('[Hook] ${targetName} result:', result);

    return result;
  };

  console.log('[Hook] Successfully hooked: ${targetName}');
})();
`.trim();
        }
        else if (targetType === 'property') {
            return `
(function() {
  'use strict';

  const descriptor = Object.getOwnPropertyDescriptor(${targetName.split('.').slice(0, -1).join('.')}, '${targetName.split('.').pop()}');
  const originalGet = descriptor?.get;
  const originalSet = descriptor?.set;

  Object.defineProperty(${targetName.split('.').slice(0, -1).join('.')}, '${targetName.split('.').pop()}', {
    get: function() {
      console.log('[Hook] ${targetName} get');
      return originalGet ? originalGet.call(this) : undefined;
    },
    set: function(value) {
      console.log('[Hook] ${targetName} set:', value);
      if (originalSet) {
        originalSet.call(this, value);
      }
    },
    configurable: true
  });

  console.log('[Hook] Successfully hooked property: ${targetName}');
})();
`.trim();
        }
        else {
            return `
(function() {
  'use strict';

  const original = ${targetName};

  ${targetName} = function(...args) {
    console.log('[Hook] ${targetName} constructor called:', args);

    const instance = new original(...args);

    // Hook实例方法
    const methodNames = Object.getOwnPropertyNames(original.prototype);
    methodNames.forEach(name => {
      if (name !== 'constructor' && typeof instance[name] === 'function') {
        const originalMethod = instance[name];
        instance[name] = function(...methodArgs) {
          console.log(\`[Hook] \${name} called:\`, methodArgs);
          return originalMethod.apply(this, methodArgs);
        };
      }
    });

    return instance;
  };

  // 保留原型链
  ${targetName}.prototype = original.prototype;

  console.log('[Hook] Successfully hooked prototype: ${targetName}');
})();
`.trim();
        }
    }
    async createBatchHooks(targets) {
        logger.info(`Creating ${targets.length} hooks...`);
        const results = [];
        for (const { target, type, action = 'log' } of targets) {
            try {
                const result = await this.createHook({ target, type, action });
                results.push(result);
            }
            catch (error) {
                logger.error(`Failed to create hook for ${target}:`, error);
            }
        }
        logger.success(`Created ${results.length}/${targets.length} hooks`);
        return results;
    }
    generateHookChain(hooks) {
        const scripts = hooks.map(h => h.script).join('\n\n');
        return `
// Hook Chain - ${hooks.length} hooks
// Generated at: ${new Date().toISOString()}

${scripts}

console.log('[Hook Chain] All ${hooks.length} hooks initialized');
`.trim();
    }
}
//# sourceMappingURL=HookManager.js.map
