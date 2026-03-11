// @ts-nocheck

import { logger } from '../../utils/logger.js';

export class AIHookGenerator {
    hookCounter = 0;
    llm;
    rag;
    constructor(options = {}) {
        this.llm = options.llm;
        this.rag = options.rag;
    }
    async planHookRequest(request) {
        if (request.target && request.behavior) {
            return {
                target: request.target,
                behavior: request.behavior,
                condition: request.condition,
                strategy: {
                    source: 'direct',
                    templateId: null,
                    score: 0,
                    explanation: 'Using explicit target/behavior from request.',
                },
            };
        }
        if (this.rag) {
            const ragPlan = await this.rag.buildPlan({
                description: request.description,
                context: request.context,
                sessionId: request.sessionId,
            });
            if (ragPlan?.strategy?.score > 0) {
                return ragPlan;
            }
        }
        if (this.llm?.generateHookGenerationPrompt) {
            try {
                const messages = this.llm.generateHookGenerationPrompt(request.description, request.context || {});
                const response = await this.llm.chat(messages, { temperature: 0.1, maxTokens: 600 });
                const match = response.content.match(/\{[\s\S]*\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (parsed.target && parsed.behavior) {
                        return {
                            target: parsed.target,
                            behavior: parsed.behavior,
                            condition: parsed.condition,
                            strategy: {
                                source: 'llm',
                                templateId: null,
                                score: 1,
                                explanation: parsed.reasoning || 'Derived from natural-language hook planning prompt.',
                            },
                        };
                    }
                }
            }
            catch (_error) {
            }
        }
        return {
            target: {
                type: 'api',
                name: 'fetch',
            },
            behavior: {
                captureArgs: true,
                captureReturn: true,
                captureStack: false,
                logToConsole: true,
            },
            condition: request.condition,
            strategy: {
                source: 'rule',
                templateId: null,
                score: 0,
                explanation: 'Falling back to generic fetch capture.',
            },
        };
    }
    async generateHook(request) {
        logger.info(`AI Hook Generator: ${request.description}`);
        const hookId = `ai-hook-${++this.hookCounter}-${Date.now()}`;
        const warnings = [];
        try {
            const planned = await this.planHookRequest(request);
            const normalizedRequest = {
                ...request,
                target: planned.target,
                behavior: planned.behavior,
                condition: request.condition || planned.condition,
            };
            let generatedCode = '';
            let explanation = '';
            let injectionMethod = 'evaluateOnNewDocument';
            switch (normalizedRequest.target.type) {
                case 'function':
                    ({ code: generatedCode, explanation } = this.generateFunctionHook(normalizedRequest, hookId));
                    break;
                case 'object-method':
                    ({ code: generatedCode, explanation } = this.generateObjectMethodHook(normalizedRequest, hookId));
                    break;
                case 'api':
                    ({ code: generatedCode, explanation } = this.generateAPIHook(normalizedRequest, hookId));
                    injectionMethod = 'evaluateOnNewDocument';
                    break;
                case 'property':
                    ({ code: generatedCode, explanation } = this.generatePropertyHook(normalizedRequest, hookId));
                    break;
                case 'event':
                    ({ code: generatedCode, explanation } = this.generateEventHook(normalizedRequest, hookId));
                    injectionMethod = 'evaluate';
                    break;
                case 'custom':
                    ({ code: generatedCode, explanation } = this.generateCustomHook(normalizedRequest, hookId));
                    break;
                default:
                    throw new Error(`Unsupported target type: ${normalizedRequest.target.type}`);
            }
            generatedCode = this.wrapWithGlobalStorage(generatedCode, hookId);
            this.validateGeneratedCode(generatedCode, warnings);
            logger.success(`Hook generated: ${hookId}`);
            return {
                success: true,
                hookId,
                generatedCode,
                explanation,
                injectionMethod,
                target: normalizedRequest.target,
                behavior: normalizedRequest.behavior,
                strategy: planned.strategy,
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }
        catch (error) {
            logger.error('Failed to generate hook', error);
            return {
                success: false,
                hookId,
                generatedCode: '',
                explanation: `Error: ${error instanceof Error ? error.message : String(error)}`,
                injectionMethod: 'evaluateOnNewDocument',
                strategy: {
                    source: 'error',
                    templateId: null,
                    score: 0,
                },
                warnings: ['Hook generation failed'],
            };
        }
    }
    generateFunctionHook(request, hookId) {
        const { target, behavior, condition, customCode } = request;
        const functionName = target.name || target.pattern || 'unknownFunction';
        const code = `
// AI Generated Hook: ${request.description}
// Hook ID: ${hookId}
(function() {
  const originalFunction = window.${functionName};

  if (typeof originalFunction !== 'function') {
    console.warn('[${hookId}] Function not found: ${functionName}');
    return;
  }

  let callCount = 0;
  const maxCalls = ${condition?.maxCalls || 'Infinity'};

  window.${functionName} = function(...args) {
    callCount++;

    if (callCount > maxCalls) {
      return originalFunction.apply(this, args);
    }

    const hookData = {
      hookId: '${hookId}',
      functionName: '${functionName}',
      callCount,
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'args: args,' : ''}
      ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
    };

    ${customCode?.before || ''}

    ${condition?.argFilter ? `
    const argFilterPassed = (function() {
      try {
        return ${condition.argFilter};
      } catch (e) {
        console.error('[${hookId}] Arg filter error:', e);
        return true;
      }
    })();

    if (!argFilterPassed) {
      return originalFunction.apply(this, args);
    }
    ` : ''}

    ${behavior.logToConsole ? `
    console.log('[${hookId}] Function called:', hookData);
    ` : ''}

    ${behavior.blockExecution ? `
    console.warn('[${hookId}] Execution blocked');
    return undefined;
    ` : `
    const startTime = performance.now();
    const result = originalFunction.apply(this, args);
    const executionTime = performance.now() - startTime;

    ${behavior.captureReturn ? `
    hookData.returnValue = result;
    hookData.executionTime = executionTime;
    ` : ''}

    ${customCode?.after || ''}

    if (!window.__aiHooks) window.__aiHooks = {};
    if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
    window.__aiHooks['${hookId}'].push(hookData);

    return result;
    `}
  };

  console.log('[${hookId}] Hook installed for: ${functionName}');
})();
`;
        const explanation = `Hook generated for function ${functionName}`;
        return { code, explanation };
    }
    generateObjectMethodHook(request, hookId) {
        const { target, behavior } = request;
        const objectPath = target.object || 'window';
        const methodName = target.property || target.name || 'unknownMethod';
        const code = `
// AI Generated Object Method Hook: ${request.description}
(function() {
  const targetObject = ${objectPath};
  const methodName = '${methodName}';

  if (!targetObject || typeof targetObject[methodName] !== 'function') {
    console.warn('[${hookId}] Method not found: ${objectPath}.${methodName}');
    return;
  }

  const originalMethod = targetObject[methodName];
  let callCount = 0;

  targetObject[methodName] = function(...args) {
    callCount++;

    const hookData = {
      hookId: '${hookId}',
      object: '${objectPath}',
      method: '${methodName}',
      callCount,
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'args: args,' : ''}
      ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
    };

    ${behavior.logToConsole ? `
    console.log('[${hookId}] Method called:', hookData);
    ` : ''}

    const result = originalMethod.apply(this, args);

    ${behavior.captureReturn ? `
    hookData.returnValue = result;
    ` : ''}

    if (!window.__aiHooks) window.__aiHooks = {};
    if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
    window.__aiHooks['${hookId}'].push(hookData);

    return result;
  };

  console.log('[${hookId}] Hook installed for: ${objectPath}.${methodName}');
})();
`;
        const explanation = `Hook generated for object method ${objectPath}.${methodName}`;
        return { code, explanation };
    }
    generateAPIHook(request, hookId) {
        const apiName = request.target.name || 'fetch';
        let code = '';
        if (apiName === 'fetch') {
            code = this.generateFetchAPIHook(request, hookId);
        }
        else if (apiName === 'XMLHttpRequest') {
            code = this.generateXHRAPIHook(request, hookId);
        }
        else {
            code = `console.error('[${hookId}] Unsupported API: ${apiName}');`;
        }
        const explanation = `Hook generated for API: ${apiName}`;
        return { code, explanation };
    }
    generateFetchAPIHook(request, hookId) {
        const { behavior, condition } = request;
        return `
// AI Generated Fetch Hook
(function() {
  const originalFetch = window.fetch;

  window.fetch = function(...args) {
    const [url, options] = args;

    ${condition?.urlPattern ? `
    const urlPattern = new RegExp('${condition.urlPattern}');
    if (!urlPattern.test(url)) {
      return originalFetch.apply(this, args);
    }
    ` : ''}

    const hookData = {
      hookId: '${hookId}',
      type: 'fetch',
      url: url,
      method: options?.method || 'GET',
      timestamp: Date.now(),
      ${behavior.captureArgs ? 'options: options,' : ''}
      ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
    };

    ${behavior.logToConsole ? `
    console.log('[${hookId}] Fetch request:', hookData);
    ` : ''}

    return originalFetch.apply(this, args).then(response => {
      ${behavior.captureReturn ? `
      hookData.status = response.status;
      hookData.statusText = response.statusText;
      ` : ''}

      if (!window.__aiHooks) window.__aiHooks = {};
      if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
      window.__aiHooks['${hookId}'].push(hookData);

      return response;
    });
  };

  console.log('[${hookId}] Fetch Hook installed');
})();
`;
    }
    generateXHRAPIHook(_request, hookId) {
        return `
// AI Generated XHR Hook
(function() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__hookData = {
      hookId: '${hookId}',
      type: 'xhr',
      method,
      url,
      timestamp: Date.now(),
    };
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const xhr = this;
    xhr.addEventListener('load', function() {
      if (xhr.__hookData) {
        xhr.__hookData.status = xhr.status;
        xhr.__hookData.response = xhr.responseText;
        if (!window.__aiHooks) window.__aiHooks = {};
        if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
        window.__aiHooks['${hookId}'].push(xhr.__hookData);
      }
    });
    return originalSend.apply(this, args);
  };

  console.log('[${hookId}] XHR Hook installed');
})();
`;
    }
    generatePropertyHook(request, _hookId) {
        const code = `// Property Hook not yet implemented for: ${request.description}`;
        const explanation = 'Property Hook generation is under development';
        return { code, explanation };
    }
    generateEventHook(request, _hookId) {
        const code = `// Event Hook not yet implemented for: ${request.description}`;
        const explanation = 'Event Hook generation is under development';
        return { code, explanation };
    }
    generateCustomHook(request, _hookId) {
        const code = request.customCode?.replace || `// Custom Hook: ${request.description}`;
        const explanation = 'Custom Hook code provided by user';
        return { code, explanation };
    }
    wrapWithGlobalStorage(code, hookId) {
        return `
// Initialize global hook storage
if (!window.__aiHooks) {
  window.__aiHooks = {};
  window.__aiHookMetadata = {};
}

window.__aiHookMetadata['${hookId}'] = {
  id: '${hookId}',
  createdAt: Date.now(),
  enabled: true,
};

${code}
`;
    }
    validateGeneratedCode(code, warnings) {
        if (code.includes('eval(') || code.includes('Function(')) {
            warnings.push('Generated code contains eval() or Function(), which may be dangerous');
        }
        const openBraces = (code.match(/{/g) || []).length;
        const closeBraces = (code.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
            warnings.push('Possible syntax error: unmatched braces');
        }
    }
}
