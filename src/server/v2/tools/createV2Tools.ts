// @ts-nocheck

import { errorResponse, maybeExternalize, successResponse } from '../response.js';
import { paginateItems } from '../pagination.js';
import { LLMService } from '../../../services/LLMService.js';
import { ObfuscationAnalysisService } from '../analysis/ObfuscationAnalysisService.js';
function sessionSchema(properties, required = []) {
    return {
        type: 'object',
        properties: {
            sessionId: {
                type: 'string',
                description: 'Active session identifier returned by browser.launch or flow.collect-site',
            },
            ...properties,
        },
        required: ['sessionId', ...required],
    };
}
function getSession(runtime, sessionId) {
    if (typeof sessionId !== 'string') {
        return undefined;
    }
    return runtime.sessions.getSession(sessionId);
}
async function ensureSessionCapability(runtime, session, capability) {
    if (!session) {
        return session;
    }
    if (session.autoEngine === true && session.engineType !== 'puppeteer' && ['script-search', 'script-source', 'function-tree', 'debugger'].includes(capability)) {
        return runtime.sessions.maybeUpgradeSessionEngine(session.sessionId, capability);
    }
    return session;
}
function normalizeBudgets(budgets) {
    return {
        maxScripts: typeof budgets?.maxScripts === 'number' ? budgets.maxScripts : 250,
        maxBytes: typeof budgets?.maxBytes === 'number' ? budgets.maxBytes : 512 * 1024,
        maxRequests: typeof budgets?.maxRequests === 'number' ? budgets.maxRequests : 100,
    };
}
function buildStatusPayload(session, status) {
    return {
        ...status,
        health: session.health,
        recoverable: session.recoverable,
        recoveryCount: session.recoveryCount || 0,
        lastFailure: session.lastFailure,
        engineCapabilities: session.engineCapabilities,
        siteProfile: session.siteProfile || session.scriptInventory.getSiteProfile(status?.currentUrl),
        engineSelectionReason: session.engineSelectionReason,
    };
}
function enforceRateLimit(runtime, sessionId, toolName) {
    const result = runtime.toolRateLimiter.check(`${sessionId || 'global'}:${toolName}`);
    if (!result.allowed) {
        throw new Error(`rate limit exceeded for ${toolName}; retry after ${result.resetInMs}ms`);
    }
}
async function buildHookContext(runtime, session, description) {
    const scripts = await hydrateScriptInventory(session, {
        includeSource: true,
        indexPolicy: 'deep',
        maxScripts: 40,
    });
    const signatureCandidates = scripts
        .filter((script) => script.source)
        .map((script) => ({
        scriptId: script.scriptId,
        url: script.url,
        rankedFunctions: runtime.functionRanker.rank(script.source).slice(0, 5),
        objectPaths: Array.from(String(script.source).matchAll(/window\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)).map((match) => `window.${match[1]}.${match[2]}`),
    }))
        .filter((candidate) => candidate.rankedFunctions.length > 0 || candidate.objectPaths.length > 0)
        .slice(0, 10);
    return {
        description,
        signatureCandidates,
        siteProfile: session.siteProfile,
    };
}
async function hydrateScriptInventory(session, options = {}) {
    const includeSource = options.includeSource === true;
    const indexPolicy = options.indexPolicy || (includeSource ? 'deep' : 'metadata-only');
    const maxScripts = typeof options.maxScripts === 'number' ? options.maxScripts : 250;
    const scripts = await session.engine.getScripts({
        includeSource,
        maxScripts,
    });
    session.scriptInventory.recordScripts(scripts, {
        indexPolicy,
    });
    session.siteProfile = session.scriptInventory.getSiteProfile(options.currentUrl);
    return session.scriptInventory.list({
        includeSource,
        maxScripts,
    });
}
async function resolveScriptSource(session, args) {
    if (typeof args.code === 'string') {
        return {
            source: args.code,
            scriptUrl: typeof args.url === 'string' ? args.url : undefined,
        };
    }
    if (typeof args.chunkRef === 'string') {
        const chunk = session.scriptInventory.getChunk(args.chunkRef);
        if (chunk) {
            const entry = session.scriptInventory.getScript({ scriptId: chunk.scriptId });
            return {
                source: chunk.content,
                scriptUrl: entry?.url,
                scriptId: chunk.scriptId,
                chunkRef: args.chunkRef,
            };
        }
    }
    const cachedScript = session.scriptInventory.getScript({
        scriptId: typeof args.scriptId === 'string' ? args.scriptId : undefined,
        url: typeof args.url === 'string' ? args.url : undefined,
    });
    if (cachedScript?.source) {
        return {
            source: cachedScript.source,
            scriptUrl: cachedScript.url,
            scriptId: cachedScript.scriptId,
        };
    }
    if (session.scriptManager) {
        const script = await session.scriptManager.getScriptSource(typeof args.scriptId === 'string' ? args.scriptId : undefined, typeof args.url === 'string' ? args.url : undefined);
        if (script?.source) {
            session.scriptInventory.recordScripts([{
                    scriptId: script.scriptId,
                    url: script.url,
                    source: script.source,
                    sourceLength: script.sourceLength,
                }], {
                    indexPolicy: 'deep',
                });
            return {
                source: script.source,
                scriptUrl: script.url,
                scriptId: script.scriptId,
            };
        }
    }
    const scripts = await hydrateScriptInventory(session, {
        includeSource: true,
        indexPolicy: 'deep',
        maxScripts: 200,
    });
    const match = scripts.find((script) => {
        if (typeof args.scriptId === 'string' && script.scriptId === args.scriptId) {
            return true;
        }
        if (typeof args.url === 'string' && script.url.includes(args.url)) {
            return true;
        }
        return false;
    });
    if (!match?.source) {
        throw new Error('Script source could not be resolved from the active session');
    }
    return {
        source: match.source,
        scriptUrl: match.url,
        scriptId: match.scriptId,
    };
}
function requirePuppeteerFeatures(session, capability) {
    if (!session.pageController || !session.domInspector || !session.consoleMonitor) {
        return `${capability} currently requires a Puppeteer-backed session`;
    }
    return null;
}
const blueprints = [
    {
        name: 'browser.launch',
        group: 'browser',
        lifecycle: 'none',
        description: 'Launch a new browser session and return a sessionId.',
        inputSchema: {
            type: 'object',
            properties: {
                engine: {
                    type: 'string',
                    enum: ['auto', 'puppeteer', 'playwright'],
                    description: 'Browser engine to use for the new session',
                },
                label: {
                    type: 'string',
                    description: 'Optional human-readable label for the session',
                },
                url: {
                    type: 'string',
                    description: 'Optional URL to open immediately after launch',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                const engine = typeof args.engine === 'string' ? args.engine : runtime.options.defaultBrowserEngine;
                const label = typeof args.label === 'string' ? args.label : undefined;
                const session = await runtime.sessions.createSession(engine, label);
                if (typeof args.url === 'string') {
                    await session.engine.navigate(args.url, {
                        waitProfile: 'interactive',
                    });
                    await runtime.sessions.refreshSnapshot(session);
                }
                return successResponse(`Session ${session.sessionId} launched with ${session.engineType}`, {
                    sessionId: session.sessionId,
                    engine: session.engineType,
                    createdAt: session.createdAt,
                    label: session.label,
                    health: session.health,
                    engineSelectionReason: session.engineSelectionReason,
                }, {
                    sessionId: session.sessionId,
                    nextActions: ['Use browser.navigate or flow.collect-site to start exploring a target page.'],
                });
            };
        },
    },
    {
        name: 'browser.status',
        group: 'browser',
        lifecycle: 'session-required',
        description: 'Get the current status for a browser session.',
        inputSchema: sessionSchema({}),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const status = await session.engine.getStatus();
                return successResponse('Session status loaded', {
                    ...buildStatusPayload(session, status),
                    workerStats: runtime.workerService.getStats(),
                    runtimeMonitor: runtime.runtimeMonitor.getStats(),
                    rateLimit: runtime.toolRateLimiter.getStats(),
                }, {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'browser.recover',
        group: 'browser',
        lifecycle: 'session-required',
        description: 'Recover a browser session from the latest snapshot or upgrade it to a more capable engine.',
        inputSchema: sessionSchema({
            engine: {
                type: 'string',
                enum: ['auto', 'puppeteer', 'playwright'],
            },
            reason: {
                type: 'string',
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const recovered = await runtime.sessions.recoverSession(session.sessionId, typeof args.engine === 'string' ? args.engine : undefined, typeof args.reason === 'string' ? args.reason : 'manual-recovery');
                if (!recovered) {
                    return errorResponse('Session recovery failed', new Error('Unable to recover session'));
                }
                const status = await recovered.engine.getStatus();
                return successResponse('Session recovered', {
                    sessionId: recovered.sessionId,
                    engine: recovered.engineType,
                    recoveryCount: recovered.recoveryCount || 0,
                    status: buildStatusPayload(recovered, status),
                }, {
                    sessionId: recovered.sessionId,
                });
            };
        },
    },
    {
        name: 'browser.close',
        group: 'browser',
        lifecycle: 'session-required',
        description: 'Close a browser session and release its artifacts.',
        inputSchema: sessionSchema({}),
        createHandler(runtime) {
            return async (args) => {
                const sessionId = typeof args.sessionId === 'string' ? args.sessionId : '';
                const closed = await runtime.sessions.closeSession(sessionId);
                if (!closed) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                runtime.artifacts.clearSession(sessionId);
                runtime.evidence.clearSession(sessionId);
                return successResponse(`Session ${sessionId} closed`, {
                    sessionId,
                });
            };
        },
    },
    {
        name: 'browser.navigate',
        group: 'browser',
        lifecycle: 'session-required',
        description: 'Navigate an active browser session to a URL.',
        inputSchema: sessionSchema({
            url: {
                type: 'string',
                description: 'Destination URL',
            },
            waitUntil: {
                type: 'string',
                enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'],
            },
            waitProfile: {
                type: 'string',
                enum: ['interactive', 'network-quiet', 'spa', 'streaming'],
            },
            timeout: {
                type: 'number',
                description: 'Navigation timeout in milliseconds',
            },
            enableNetworkCapture: {
                type: 'boolean',
                description: 'For Puppeteer sessions, enable request capture before navigation',
            },
        }, ['url']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (args.enableNetworkCapture !== false && session.consoleMonitor) {
                    await session.consoleMonitor.enable({
                        enableNetwork: true,
                        enableExceptions: true,
                    });
                }
                const result = await session.engine.navigate(String(args.url), {
                    waitUntil: args.waitUntil,
                    waitProfile: args.waitProfile,
                    timeout: typeof args.timeout === 'number' ? args.timeout : undefined,
                });
                await runtime.sessions.refreshSnapshot(session);
                return successResponse(`Navigated session ${session.sessionId} to ${result.url}`, result, {
                    sessionId: session.sessionId,
                    diagnostics: result.diagnostics,
                    nextActions: ['Use inspect.dom, inspect.scripts, or flow.collect-site to inspect this page.'],
                });
            };
        },
    },
    {
        name: 'inspect.dom',
        group: 'inspect',
        lifecycle: 'session-required',
        description: 'Inspect DOM state for a Puppeteer-backed session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['query', 'all', 'structure', 'clickable', 'style', 'text', 'xpath', 'viewport'],
            },
            selector: {
                type: 'string',
            },
            text: {
                type: 'string',
            },
            maxDepth: {
                type: 'number',
            },
            includeText: {
                type: 'boolean',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                let session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                session = await ensureSessionCapability(runtime, session, 'debugger');
                const unsupported = requirePuppeteerFeatures(session, 'inspect.dom');
                if (unsupported) {
                    return errorResponse('Unsupported session engine', new Error(unsupported), {
                        sessionId: session.sessionId,
                    });
                }
                let result;
                switch (args.action) {
                    case 'query':
                        result = await session.domInspector.querySelector(String(args.selector));
                        break;
                    case 'all':
                        result = await session.domInspector.querySelectorAll(String(args.selector));
                        break;
                    case 'structure':
                        result = await session.domInspector.getStructure(typeof args.maxDepth === 'number' ? args.maxDepth : 3, args.includeText !== false);
                        break;
                    case 'clickable':
                        result = await session.domInspector.findClickable(typeof args.text === 'string' ? args.text : undefined);
                        break;
                    case 'style':
                        result = await session.domInspector.getComputedStyle(String(args.selector));
                        break;
                    case 'text':
                        result = await session.domInspector.findByText(String(args.text));
                        break;
                    case 'xpath':
                        result = await session.domInspector.getXPath(String(args.selector));
                        break;
                    case 'viewport':
                        result = await session.domInspector.isInViewport(String(args.selector));
                        break;
                    default:
                        return errorResponse('Unsupported DOM action', new Error('Unknown inspect.dom action'));
                }
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-dom', 'DOM inspection payload', result, session.sessionId);
                return successResponse(`DOM action ${String(args.action)} completed`, externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                });
            };
        },
    },
    {
        name: 'inspect.scripts',
        group: 'inspect',
        lifecycle: 'session-required',
        description: 'List, fetch, search, or summarize scripts for a session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['list', 'source', 'search', 'function-tree'],
            },
            includeSource: {
                type: 'boolean',
            },
            scriptId: {
                type: 'string',
            },
            functionName: {
                type: 'string',
            },
            url: {
                type: 'string',
            },
            keyword: {
                type: 'string',
            },
            searchMode: {
                type: 'string',
                enum: ['indexed', 'substring', 'regex'],
            },
            indexPolicy: {
                type: 'string',
                enum: ['metadata-only', 'hot-sources', 'deep'],
            },
            maxResults: {
                type: 'number',
            },
            maxBytes: {
                type: 'number',
            },
            chunkRef: {
                type: 'string',
            },
            page: {
                type: 'number',
            },
            pageSize: {
                type: 'number',
            },
            cursor: {
                type: 'string',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                let session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (args.action === 'function-tree') {
                    session = await ensureSessionCapability(runtime, session, 'function-tree');
                }
                let result;
                switch (args.action) {
                    case 'list':
                        {
                            const listed = await hydrateScriptInventory(session, {
                                includeSource: args.includeSource === true,
                                indexPolicy: args.indexPolicy || (args.includeSource === true ? 'deep' : 'metadata-only'),
                                maxScripts: 250,
                                currentUrl: (await session.engine.getStatus())?.currentUrl,
                            });
                            if (typeof args.page === 'number' || typeof args.pageSize === 'number' || typeof args.cursor === 'string') {
                                const paged = paginateItems(listed, {
                                    page: typeof args.page === 'number' ? args.page : undefined,
                                    pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                                    cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                                });
                                result = {
                                    items: paged.items,
                                    page: paged.page,
                                };
                            }
                            else {
                                result = listed;
                            }
                        }
                        break;
                    case 'source':
                        result = await resolveScriptSource(session, args);
                        break;
                    case 'search':
                        enforceRateLimit(runtime, session.sessionId, 'inspect.scripts.search');
                        await hydrateScriptInventory(session, {
                            includeSource: true,
                            indexPolicy: args.indexPolicy || 'deep',
                            maxScripts: 250,
                        });
                        if (runtime.storage && typeof args.keyword === 'string' && args.keyword.length > 0) {
                            const stored = await runtime.storage.searchScriptChunks({
                                sessionId: session.sessionId,
                                query: String(args.keyword || ''),
                                limit: typeof args.maxResults === 'number' ? args.maxResults : 100,
                            });
                            if (stored.total > 0) {
                                const paged = paginateItems(stored.items.map((item) => ({
                                    scriptId: item.scriptId,
                                    url: item.url,
                                    chunkRef: item.chunkRef,
                                    chunkIndex: item.chunkIndex,
                                    context: item.contentPreview,
                                })), {
                                    page: typeof args.page === 'number' ? args.page : undefined,
                                    pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                                    cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                                });
                                result = {
                                    keyword: String(args.keyword || ''),
                                    searchMode: args.searchMode || 'indexed',
                                    totalMatches: stored.total,
                                    truncated: false,
                                    executionMode: 'worker',
                                    matches: paged.items,
                                    page: paged.page,
                                };
                            }
                            else {
                                const scriptsForWorker = session.scriptInventory.list({
                                    includeSource: true,
                                    maxScripts: 250,
                                }).filter((item) => typeof item.source === 'string');
                                const workerResult = await runtime.workerService.runSearchTask({
                                    keyword: String(args.keyword || ''),
                                    searchMode: args.searchMode || 'indexed',
                                    maxResults: typeof args.maxResults === 'number' ? args.maxResults : 100,
                                    maxBytes: typeof args.maxBytes === 'number' ? args.maxBytes : 24 * 1024,
                                    scripts: scriptsForWorker.map((item) => ({
                                        scriptId: item.scriptId,
                                        url: item.url,
                                        source: item.source,
                                    })),
                                });
                                const paged = paginateItems(workerResult.matches || [], {
                                    page: typeof args.page === 'number' ? args.page : undefined,
                                    pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                                    cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                                });
                                result = {
                                    ...workerResult,
                                    matches: paged.items,
                                    page: paged.page,
                                };
                            }
                        }
                        else {
                            enforceRateLimit(runtime, session.sessionId, 'inspect.scripts.search');
                            const scriptsForWorker = session.scriptInventory.list({
                                includeSource: true,
                                maxScripts: 250,
                            }).filter((item) => typeof item.source === 'string');
                            const workerResult = await runtime.workerService.runSearchTask({
                                keyword: String(args.keyword || ''),
                                searchMode: args.searchMode || 'indexed',
                                maxResults: typeof args.maxResults === 'number' ? args.maxResults : 100,
                                maxBytes: typeof args.maxBytes === 'number' ? args.maxBytes : 24 * 1024,
                                scripts: scriptsForWorker.map((item) => ({
                                    scriptId: item.scriptId,
                                    url: item.url,
                                    source: item.source,
                                })),
                            });
                            const paged = paginateItems(workerResult.matches || [], {
                                page: typeof args.page === 'number' ? args.page : undefined,
                                pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                                cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                            });
                            result = {
                                ...workerResult,
                                matches: paged.items,
                                page: paged.page,
                            };
                        }
                        break;
                    case 'function-tree':
                        if (!session.scriptManager) {
                            return errorResponse('Unsupported session engine', new Error('Function tree extraction requires a Puppeteer-backed session'));
                        }
                        {
                            const sourcePayload = await resolveScriptSource(session, args);
                            result = await runtime.workerService.runAstTask({
                                kind: 'function-tree',
                                code: sourcePayload.source,
                                functionName: String(args.functionName || 'main'),
                            });
                        }
                        break;
                    default:
                        return errorResponse('Unsupported script action', new Error('Unknown inspect.scripts action'));
                }
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-scripts', 'Script inspection payload', result, session.sessionId);
                return successResponse(`Script action ${String(args.action)} completed`, externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                });
            };
        },
    },
    {
        name: 'inspect.network',
        group: 'inspect',
        lifecycle: 'session-required',
        description: 'Inspect captured network activity for a session.',
        inputSchema: sessionSchema({
            url: {
                type: 'string',
            },
            method: {
                type: 'string',
            },
            limit: {
                type: 'number',
            },
            requestId: {
                type: 'string',
            },
            page: {
                type: 'number',
            },
            pageSize: {
                type: 'number',
            },
            cursor: {
                type: 'string',
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                enforceRateLimit(runtime, session.sessionId, 'inspect.network');
                const snapshot = await session.engine.collectNetwork({
                    url: typeof args.url === 'string' ? args.url : undefined,
                    method: typeof args.method === 'string' ? args.method : undefined,
                    limit: typeof args.limit === 'number' ? args.limit : undefined,
                    requestId: typeof args.requestId === 'string' ? args.requestId : undefined,
                });
                const pagedRequests = paginateItems(snapshot.requests || [], {
                    page: typeof args.page === 'number' ? args.page : undefined,
                    pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                    cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                });
                const payload = {
                    ...snapshot,
                    requests: pagedRequests.items,
                    page: pagedRequests.page,
                };
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-network', 'Network inspection payload', payload, session.sessionId);
                return successResponse('Network activity loaded', externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                });
            };
        },
    },
    {
        name: 'inspect.runtime',
        group: 'inspect',
        lifecycle: 'session-required',
        description: 'Evaluate a JavaScript expression inside the active page runtime.',
        inputSchema: sessionSchema({
            expression: {
                type: 'string',
            },
        }, ['expression']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const result = await session.engine.inspectRuntime(String(args.expression));
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-runtime', 'Runtime evaluation payload', result, session.sessionId);
                return successResponse('Runtime expression evaluated', externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                });
            };
        },
    },
    {
        name: 'inspect.artifact',
        group: 'inspect',
        lifecycle: 'none',
        description: 'Retrieve a stored artifact by artifactId or detailId.',
        inputSchema: {
            type: 'object',
            properties: {
                artifactId: {
                    type: 'string',
                },
                detailId: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                const identifier = typeof args.artifactId === 'string'
                    ? args.artifactId
                    : typeof args.detailId === 'string'
                        ? args.detailId
                        : undefined;
                if (!identifier) {
                    return errorResponse('Artifact identifier missing', new Error('artifactId or detailId is required'));
                }
                const artifact = runtime.artifacts.get(identifier);
                if (!artifact) {
                    return errorResponse('Artifact not found', new Error('Unknown artifactId/detailId'));
                }
                return successResponse(`Artifact ${identifier} loaded`, artifact.data, {
                    sessionId: artifact.sessionId,
                });
            };
        },
    },
    {
        name: 'inspect.evidence',
        group: 'inspect',
        lifecycle: 'none',
        description: 'Retrieve a stored evidence record by evidenceId.',
        inputSchema: {
            type: 'object',
            properties: {
                evidenceId: {
                    type: 'string',
                },
            },
            required: ['evidenceId'],
        },
        createHandler(runtime) {
            return async (args) => {
                const identifier = String(args.evidenceId || '');
                const evidence = runtime.evidence.get(identifier);
                if (!evidence) {
                    return errorResponse('Evidence not found', new Error('Unknown evidenceId'));
                }
                return successResponse(`Evidence ${identifier} loaded`, evidence.data, {
                    sessionId: evidence.sessionId,
                    evidenceIds: [identifier],
                });
            };
        },
    },
    {
        name: 'debug.control',
        group: 'debug',
        lifecycle: 'session-required',
        description: 'Enable or control the debugger for a Puppeteer-backed session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['enable', 'disable', 'pause', 'resume', 'stepInto', 'stepOver', 'stepOut', 'state'],
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.debuggerManager || !session.runtimeInspector) {
                    return errorResponse('Unsupported session engine', new Error('Debugging requires a Puppeteer-backed session'));
                }
                switch (args.action) {
                    case 'enable':
                        await session.debuggerManager.init();
                        await session.runtimeInspector.init();
                        break;
                    case 'disable':
                        await session.runtimeInspector.disable();
                        await session.debuggerManager.disable();
                        break;
                    case 'pause':
                        await session.debuggerManager.pause();
                        break;
                    case 'resume':
                        await session.debuggerManager.resume();
                        break;
                    case 'stepInto':
                        await session.debuggerManager.stepInto();
                        break;
                    case 'stepOver':
                        await session.debuggerManager.stepOver();
                        break;
                    case 'stepOut':
                        await session.debuggerManager.stepOut();
                        break;
                    case 'state':
                        break;
                    default:
                        return errorResponse('Unsupported debug action', new Error('Unknown debug.control action'));
                }
                return successResponse(`Debug action ${String(args.action)} completed`, {
                    enabled: session.debuggerManager.isEnabled(),
                    pausedState: session.debuggerManager.getPausedState(),
                }, {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'debug.evaluate',
        group: 'debug',
        lifecycle: 'session-required',
        description: 'Evaluate an expression in the debugger or global runtime.',
        inputSchema: sessionSchema({
            expression: {
                type: 'string',
            },
            callFrameId: {
                type: 'string',
            },
        }, ['expression']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.runtimeInspector) {
                    return errorResponse('Unsupported session engine', new Error('Debugger evaluation requires a Puppeteer-backed session'));
                }
                await session.runtimeInspector.init();
                const result = typeof args.callFrameId === 'string'
                    ? await session.runtimeInspector.evaluate(String(args.expression), args.callFrameId)
                    : await session.runtimeInspector.evaluateGlobal(String(args.expression));
                return successResponse('Debugger evaluation completed', result, {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'analyze.bundle-fingerprint',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Compute a static fingerprint for a script or code snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                scriptId: {
                    type: 'string',
                },
                url: {
                    type: 'string',
                },
                code: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const workerResult = await runtime.workerService.runAnalysisTask({
                    kind: 'bundle-fingerprint',
                    code: source,
                });
                const fingerprint = {
                    ...(workerResult.result || runtime.bundleFingerprints.fingerprint(source)),
                    executionMode: workerResult.executionMode || 'main-thread',
                };
                const evidence = runtime.evidence.create('bundle-fingerprint', 'Bundle fingerprint generated', fingerprint, sessionId);
                return successResponse('Bundle fingerprint generated', fingerprint, {
                    sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.source-map',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Resolve and inspect source map metadata for a script or code snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                scriptId: {
                    type: 'string',
                },
                url: {
                    type: 'string',
                },
                code: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let scriptUrl;
                let sessionId;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    const resolved = await resolveScriptSource(session, args);
                    source = resolved.source;
                    scriptUrl = resolved.scriptUrl;
                    sessionId = session.sessionId;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                    scriptUrl = typeof args.url === 'string' ? args.url : undefined;
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const analysis = await runtime.sourceMaps.analyze(source, scriptUrl);
                const evidence = runtime.evidence.create('source-map', 'Source map analysis generated', analysis, sessionId);
                return successResponse('Source map analysis completed', analysis, {
                    sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.script-diff',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Compare two script versions and summarize changed lines.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                leftCode: {
                    type: 'string',
                },
                rightCode: {
                    type: 'string',
                },
                leftScriptId: {
                    type: 'string',
                },
                rightScriptId: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let leftCode = typeof args.leftCode === 'string' ? args.leftCode : undefined;
                let rightCode = typeof args.rightCode === 'string' ? args.rightCode : undefined;
                let sessionId;
                if ((!leftCode || !rightCode) && typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    if (!leftCode && typeof args.leftScriptId === 'string') {
                        leftCode = (await resolveScriptSource(session, { scriptId: args.leftScriptId })).source;
                    }
                    if (!rightCode && typeof args.rightScriptId === 'string') {
                        rightCode = (await resolveScriptSource(session, { scriptId: args.rightScriptId })).source;
                    }
                }
                if (!leftCode || !rightCode) {
                    return errorResponse('Script inputs missing', new Error('Provide left/right code or script ids'));
                }
                const diff = runtime.scriptDiff.diff(leftCode, rightCode);
                const evidence = runtime.evidence.create('script-diff', 'Script diff generated', diff, sessionId);
                return successResponse('Script diff completed', diff, {
                    sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.rank-functions',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Rank likely-significant functions in a script using heuristic scoring.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                scriptId: {
                    type: 'string',
                },
                url: {
                    type: 'string',
                },
                code: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const workerResult = await runtime.workerService.runAnalysisTask({
                    kind: 'rank-functions',
                    code: source,
                });
                const ranked = workerResult.result || runtime.functionRanker.rank(source);
                const evidence = runtime.evidence.create('function-ranking', 'Function ranking generated', ranked, sessionId);
                return successResponse('Function ranking completed', ranked, {
                    sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.obfuscation',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Detect likely JavaScript obfuscation patterns and recommend the next reverse-engineering passes.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                scriptId: {
                    type: 'string',
                },
                url: {
                    type: 'string',
                },
                code: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                let service;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                    service = session.obfuscationAnalysis;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                    service = new ObfuscationAnalysisService(new LLMService(runtime.config.llm, undefined, {
                        storage: runtime.storage,
                        llmCache: runtime.config.llmCache,
                    }));
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const workerResult = await runtime.workerService.runAnalysisTask({
                    kind: 'obfuscation-prescan',
                    code: source,
                });
                const analysis = service.detect(source);
                const evidence = runtime.evidence.create('obfuscation-detection', 'Obfuscation analysis generated', analysis, sessionId);
                return successResponse('Obfuscation analysis completed', {
                    ...analysis,
                    workerSignals: workerResult.result,
                    executionMode: workerResult.executionMode || 'main-thread',
                }, {
                    sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.deobfuscate',
        group: 'analyze',
        lifecycle: 'session-optional',
        description: 'Run a structured deobfuscation pipeline and return staged results.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                scriptId: {
                    type: 'string',
                },
                url: {
                    type: 'string',
                },
                code: {
                    type: 'string',
                },
                aggressive: {
                    type: 'boolean',
                },
                aggressiveVM: {
                    type: 'boolean',
                },
                includeExplanation: {
                    type: 'boolean',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                let service;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                    service = session.obfuscationAnalysis;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                    service = new ObfuscationAnalysisService(new LLMService(runtime.config.llm, undefined, {
                        storage: runtime.storage,
                        llmCache: runtime.config.llmCache,
                    }));
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const analysis = await service.deobfuscate(source, {
                    aggressive: args.aggressive === true,
                    aggressiveVM: args.aggressiveVM === true,
                    includeExplanation: args.includeExplanation !== false,
                });
                const externalized = maybeExternalize(runtime.artifacts, 'deobfuscation', 'Structured deobfuscation result', analysis, sessionId);
                const evidence = runtime.evidence.create('deobfuscation', 'Deobfuscation pipeline completed', {
                    pipelineStages: analysis.pipelineStages,
                    detected: analysis.detected,
                }, sessionId);
                return successResponse('Deobfuscation pipeline completed', {
                    ...externalized.data,
                    cached: analysis.cached === true,
                }, {
                    sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'hook.generate',
        group: 'hook',
        lifecycle: 'session-optional',
        description: 'Generate a hook template from a high-level target description.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                description: {
                    type: 'string',
                },
                target: {
                    type: 'object',
                },
                behavior: {
                    type: 'object',
                },
                condition: {
                    type: 'object',
                },
            },
            required: ['description'],
        },
        createHandler(runtime) {
            return async (args) => {
                const session = typeof args.sessionId === 'string' ? getSession(runtime, args.sessionId) : undefined;
                if (typeof args.sessionId === 'string' && !session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const generator = session?.aiHookGenerator || new (await import('../../../modules/hook/AIHookGenerator.js')).AIHookGenerator({
                    llm: new LLMService(runtime.config.llm, undefined, {
                        storage: runtime.storage,
                        llmCache: runtime.config.llmCache,
                    }),
                    rag: new (await import('../../../modules/hook/rag.js')).HookRAG(runtime.storage),
                });
                const hookContext = session ? await buildHookContext(runtime, session, String(args.description)) : undefined;
                const generated = await generator.generateHook({
                    description: String(args.description),
                    target: args.target,
                    behavior: args.behavior,
                    condition: args.condition,
                    context: hookContext,
                    sessionId: session?.sessionId,
                });
                const evidence = runtime.evidence.create('hook-template', 'Hook template generated', generated, session?.sessionId);
                if (session?.sessionId) {
                    await runtime.storage.recordHookEvent(session.sessionId, {
                        hookId: generated.hookId,
                        eventType: 'hook-template-generated',
                        summary: generated.strategy?.explanation || String(args.description),
                        payload: generated,
                        createdAt: Date.now(),
                    });
                }
                return successResponse('Hook template generated', generated, {
                    sessionId: session?.sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'hook.inject',
        group: 'hook',
        lifecycle: 'session-required',
        description: 'Inject a hook script into the active page.',
        inputSchema: sessionSchema({
            code: {
                type: 'string',
            },
            onNewDocument: {
                type: 'boolean',
            },
        }, ['code']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                await session.engine.injectHook(String(args.code), {
                    onNewDocument: args.onNewDocument === true,
                });
                await runtime.sessions.refreshSnapshot(session);
                const evidence = runtime.evidence.create('hook-injection', 'Hook injected into page', {
                    onNewDocument: args.onNewDocument === true,
                }, session.sessionId);
                return successResponse('Hook injected successfully', {
                    onNewDocument: args.onNewDocument === true,
                }, {
                    sessionId: session.sessionId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'hook.data',
        group: 'hook',
        lifecycle: 'session-required',
        description: 'Read captured records from a generated AI hook.',
        inputSchema: sessionSchema({
            hookId: {
                type: 'string',
            },
        }, ['hookId']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const expression = `(() => {
          const hookId = ${JSON.stringify(String(args.hookId))};
          if (!window.__aiHooks || !window.__aiHooks[hookId]) {
            return null;
          }
          return {
            hookId,
            metadata: window.__aiHookMetadata?.[hookId],
            records: window.__aiHooks[hookId],
            totalRecords: window.__aiHooks[hookId].length,
          };
        })()`;
                const result = await session.engine.inspectRuntime(expression);
                if (!result) {
                    return errorResponse('Hook data not found', new Error('No hook data captured for this hookId'), {
                        sessionId: session.sessionId,
                    });
                }
                const externalized = maybeExternalize(runtime.artifacts, 'hook-data', 'Captured hook data', result, session.sessionId);
                return successResponse('Hook data loaded', externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                });
            };
        },
    },
    {
        name: 'flow.collect-site',
        group: 'flow',
        lifecycle: 'session-optional',
        description: 'Launch or reuse a session, navigate to a page, and gather a first-pass reverse-engineering snapshot.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                engine: {
                    type: 'string',
                    enum: ['auto', 'puppeteer', 'playwright'],
                },
                url: {
                    type: 'string',
                },
                label: {
                    type: 'string',
                },
                waitProfile: {
                    type: 'string',
                    enum: ['interactive', 'network-quiet', 'spa', 'streaming'],
                },
                collectionStrategy: {
                    type: 'string',
                    enum: ['manifest', 'priority', 'deep'],
                },
                scope: {
                    type: 'string',
                    enum: ['same-origin', 'all-frames', 'include-workers'],
                },
                budgets: {
                    type: 'object',
                },
            },
            required: ['url'],
        },
        createHandler(runtime) {
            return async (args) => {
                const existingSession = typeof args.sessionId === 'string' ? getSession(runtime, args.sessionId) : undefined;
                if (typeof args.sessionId === 'string' && !existingSession) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const session = existingSession ||
                    (await runtime.sessions.createSession((typeof args.engine === 'string' ? args.engine : runtime.options.defaultBrowserEngine), typeof args.label === 'string' ? args.label : undefined));
                if (session.consoleMonitor) {
                    await session.consoleMonitor.enable({
                        enableNetwork: true,
                        enableExceptions: true,
                    });
                }
                const budgets = normalizeBudgets(args.budgets);
                const collectionStrategy = typeof args.collectionStrategy === 'string' ? args.collectionStrategy : 'manifest';
                const navigation = await session.engine.navigate(String(args.url), {
                    waitProfile: args.waitProfile,
                });
                await runtime.sessions.refreshSnapshot(session);
                await hydrateScriptInventory(session, {
                    includeSource: collectionStrategy !== 'manifest',
                    indexPolicy: collectionStrategy === 'manifest' ? 'metadata-only' : collectionStrategy === 'priority' ? 'hot-sources' : 'deep',
                    maxScripts: budgets.maxScripts,
                    currentUrl: navigation.url,
                });
                const manifest = session.scriptInventory.createManifest(budgets);
                const siteProfile = runtime.sessions.updateSiteProfile(session, session.scriptInventory.getSiteProfile(navigation.url));
                const network = await session.engine.collectNetwork({
                    limit: budgets.maxRequests,
                });
                if (session.consoleMonitor?.flushNetworkToStorage) {
                    await session.consoleMonitor.flushNetworkToStorage();
                }
                let collectorSummary = undefined;
                if (session.collector && typeof session.collector.collect === 'function' && collectionStrategy !== 'manifest') {
                    collectorSummary = await session.collector.collect({
                        url: String(args.url),
                        includeInline: true,
                        includeExternal: true,
                        includeDynamic: true,
                        smartMode: collectionStrategy === 'priority' ? 'priority' : 'summary',
                        maxTotalSize: budgets.maxBytes,
                    });
                }
                const artifact = runtime.artifacts.create('flow-collect-site', 'Initial site snapshot', {
                    navigation,
                    manifest,
                    siteProfile,
                    network,
                    collectorSummary,
                    collectionStrategy,
                    scope: args.scope || 'same-origin',
                }, session.sessionId);
                const evidence = runtime.evidence.create('flow-collect-site', 'Initial site collection completed', {
                    navigation,
                    scriptCount: siteProfile.totalScripts,
                    collectionStrategy,
                }, session.sessionId);
                return successResponse('Initial site collection completed', {
                    navigation,
                    manifest,
                    siteProfile,
                    scriptCount: siteProfile.totalScripts,
                    networkStats: network.stats,
                    collectorSummary,
                    collectionStrategy,
                    scope: args.scope || 'same-origin',
                }, {
                    sessionId: session.sessionId,
                    artifactId: artifact.id,
                    detailId: artifact.id,
                    evidenceIds: [evidence.id],
                    diagnostics: navigation.diagnostics,
                    nextActions: ['Use flow.find-signature-path or flow.trace-request to continue the investigation.'],
                });
            };
        },
    },
    {
        name: 'flow.find-signature-path',
        group: 'flow',
        lifecycle: 'session-required',
        description: 'Rank likely request-signing code paths using script search and function heuristics.',
        inputSchema: sessionSchema({
            requestPattern: {
                type: 'string',
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const keywords = [args.requestPattern, 'sign', 'signature', 'token', 'nonce', 'timestamp']
                    .filter((value) => typeof value === 'string' && value.length > 0);
                const scripts = await session.engine.getScripts({
                    includeSource: true,
                    maxScripts: 40,
                });
                const candidates = scripts
                    .filter((script) => script.source)
                    .map((script) => ({
                    scriptId: script.scriptId,
                    url: script.url,
                    matches: keywords.filter((keyword) => script.source.toLowerCase().includes(keyword.toLowerCase())),
                    rankedFunctions: runtime.functionRanker.rank(script.source).slice(0, 5),
                    objectPaths: Array.from(String(script.source).matchAll(/window\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)).map((match) => `window.${match[1]}.${match[2]}`),
                }))
                    .filter((candidate) => candidate.matches.length > 0 || candidate.rankedFunctions.length > 0)
                    .sort((left, right) => (right.matches.length + right.rankedFunctions.length) - (left.matches.length + left.rankedFunctions.length))
                    .slice(0, 10)
                    .map((candidate) => ({
                    ...candidate,
                    recommendedHookDescription: candidate.objectPaths?.[0]
                        ? `自动破解 ${candidate.objectPaths[0]} 加密并捕获返回值`
                        : candidate.rankedFunctions?.[0]?.name
                            ? `自动破解 ${candidate.rankedFunctions[0].name} 签名并捕获返回值`
                            : '自动破解签名加密并捕获返回值',
                }));
                const evidence = runtime.evidence.create('signature-path', 'Potential signature path candidates identified', candidates, session.sessionId);
                return successResponse('Potential signature path candidates identified', candidates, {
                    sessionId: session.sessionId,
                    evidenceIds: [evidence.id],
                    nextActions: ['Inspect the top candidate scripts or run flow.generate-hook against the target API primitive.'],
                });
            };
        },
    },
    {
        name: 'flow.trace-request',
        group: 'flow',
        lifecycle: 'session-required',
        description: 'Filter captured requests and summarize the most relevant request path for investigation.',
        inputSchema: sessionSchema({
            urlPattern: {
                type: 'string',
            },
            method: {
                type: 'string',
            },
            requestId: {
                type: 'string',
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const snapshot = await session.engine.collectNetwork({
                    url: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
                    method: typeof args.method === 'string' ? args.method : undefined,
                    requestId: typeof args.requestId === 'string' ? args.requestId : undefined,
                    limit: 50,
                });
                const evidence = runtime.evidence.create('request-trace', 'Filtered request trace generated', snapshot, session.sessionId);
                const externalized = maybeExternalize(runtime.artifacts, 'request-trace', 'Filtered request trace', snapshot, session.sessionId);
                return successResponse('Request trace generated', externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'flow.generate-hook',
        group: 'flow',
        lifecycle: 'session-required',
        description: 'Generate a hook from a request-analysis goal and optionally inject it into the page.',
        inputSchema: sessionSchema({
            description: {
                type: 'string',
            },
            target: {
                type: 'object',
            },
            behavior: {
                type: 'object',
            },
            condition: {
                type: 'object',
            },
            autoInject: {
                type: 'boolean',
            },
        }, ['description']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const hookContext = await buildHookContext(runtime, session, String(args.description));
                const generated = await session.aiHookGenerator.generateHook({
                    description: String(args.description),
                    target: args.target,
                    behavior: args.behavior,
                    condition: args.condition,
                    context: hookContext,
                    sessionId: session.sessionId,
                });
                if (args.autoInject === true && generated.success) {
                    await session.engine.injectHook(generated.generatedCode, {
                        onNewDocument: generated.injectionMethod === 'evaluateOnNewDocument',
                    });
                    await runtime.sessions.refreshSnapshot(session);
                }
                await runtime.storage.recordHookEvent(session.sessionId, {
                    hookId: generated.hookId,
                    eventType: generated.success ? 'flow-hook-generated' : 'flow-hook-failed',
                    summary: generated.strategy?.explanation || String(args.description),
                    payload: generated,
                    createdAt: Date.now(),
                });
                const evidence = runtime.evidence.create('flow-generate-hook', 'Flow hook generation completed', {
                    generated,
                    autoInjected: args.autoInject === true && generated.success,
                }, session.sessionId);
                return successResponse('Flow hook generation completed', {
                    generated,
                    autoInjected: args.autoInject === true && generated.success,
                }, {
                    sessionId: session.sessionId,
                    evidenceIds: [evidence.id],
                    nextActions: ['Use hook.data after exercising the page to inspect captured records.'],
                });
            };
        },
    },
    {
        name: 'flow.reverse-report',
        group: 'flow',
        lifecycle: 'session-required',
        description: 'Summarize the current reverse-engineering session into a structured report.',
        inputSchema: sessionSchema({
            focus: {
                type: 'string',
                enum: ['overview', 'network', 'scripts', 'hooks'],
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const status = buildStatusPayload(session, await session.engine.getStatus());
                const scripts = await hydrateScriptInventory(session, {
                    includeSource: true,
                    indexPolicy: 'deep',
                    maxScripts: 8,
                });
                const fingerprints = scripts
                    .filter((script) => script.source)
                    .map((script) => ({
                    scriptId: script.scriptId,
                    url: script.url,
                    fingerprint: runtime.bundleFingerprints.fingerprint(script.source),
                    rankedFunctions: runtime.functionRanker.rank(script.source).slice(0, 3),
                }));
                const report = {
                    session: {
                        sessionId: session.sessionId,
                        engine: session.engineType,
                        createdAt: session.createdAt,
                        lastActivityAt: session.lastActivityAt,
                        engineSelectionReason: session.engineSelectionReason,
                    },
                    focus: args.focus || 'overview',
                    status,
                    workerStats: runtime.workerService.getStats(),
                    runtimeMonitor: runtime.runtimeMonitor.getStats(),
                    rateLimit: runtime.toolRateLimiter.getStats(),
                    siteProfile: session.siteProfile || session.scriptInventory.getSiteProfile(status?.currentUrl),
                    artifacts: runtime.artifacts.listBySession(session.sessionId).map((artifact) => ({
                        artifactId: artifact.id,
                        kind: artifact.kind,
                        summary: artifact.summary,
                        createdAt: artifact.createdAt,
                    })),
                    evidence: runtime.evidence.listBySession(session.sessionId).map((item) => ({
                        evidenceId: item.id,
                        kind: item.kind,
                        summary: item.summary,
                        createdAt: item.createdAt,
                    })),
                    fingerprints,
                };
                const artifact = runtime.artifacts.create('reverse-report', 'Structured reverse report', report, session.sessionId);
                return successResponse('Structured reverse report generated', report, {
                    sessionId: session.sessionId,
                    artifactId: artifact.id,
                    detailId: artifact.id,
                });
            };
        },
    },
    {
        name: 'flow.resume-session',
        group: 'flow',
        lifecycle: 'session-required',
        description: 'Return the current session summary, recent artifacts, and next suggested actions.',
        inputSchema: sessionSchema({}),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                return successResponse('Session summary loaded', {
                    session: {
                        sessionId: session.sessionId,
                        engine: session.engineType,
                        createdAt: session.createdAt,
                        lastActivityAt: session.lastActivityAt,
                        health: session.health,
                        recoverable: session.recoverable,
                        recoveryCount: session.recoveryCount || 0,
                    },
                    siteProfile: session.siteProfile || session.scriptInventory.getSiteProfile(),
                    recentArtifacts: runtime.artifacts.listBySession(session.sessionId).slice(-10).map((artifact) => ({
                        artifactId: artifact.id,
                        kind: artifact.kind,
                        summary: artifact.summary,
                        createdAt: artifact.createdAt,
                    })),
                    recentEvidence: runtime.evidence.listBySession(session.sessionId).slice(-10).map((item) => ({
                        evidenceId: item.id,
                        kind: item.kind,
                        summary: item.summary,
                        createdAt: item.createdAt,
                    })),
                }, {
                    sessionId: session.sessionId,
                    nextActions: ['Use flow.reverse-report for a consolidated snapshot or browser.navigate to continue exploration.'],
                });
            };
        },
    },
];
export const V2_TOOL_CATALOG = blueprints.map(({ name, group, lifecycle, description, inputSchema }) => ({
    name,
    group,
    lifecycle,
    description,
    inputSchema,
}));
export function createV2Tools(runtime) {
    return blueprints.map((blueprint) => ({
        name: blueprint.name,
        description: blueprint.description,
        inputSchema: blueprint.inputSchema,
        group: blueprint.group,
        lifecycle: blueprint.lifecycle,
        execute: blueprint.createHandler(runtime),
    }));
}
//# sourceMappingURL=createV2Tools.js.map
