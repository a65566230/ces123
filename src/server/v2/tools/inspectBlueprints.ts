// @ts-nocheck

export function buildInspectToolBlueprints(shared) {
    const {
        compactPayload,
        errorResponse,
        maybeExternalize,
        successResponse,
        paginateItems,
        sessionSchema,
        getSession,
        ensureSessionCapability,
        enforceRateLimit,
        hydrateScriptInventory,
        findScriptMetadataMatches,
        progressivelySearchScriptSources,
        resolveScriptSource,
        requirePlaywrightFeatures,
    } = shared;

    function buildReadSummary(data) {
        return {
            totalRecords: Number(data?.totalRecords || 0),
            hasRecords: Number(data?.totalRecords || 0) > 0,
        };
    }

    return [
{
        name: 'inspect.dom',
        group: 'inspect',
        lifecycle: 'session-required',
        description: 'Inspect DOM state for a Playwright-backed session.',
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
                const unsupported = requirePlaywrightFeatures(session, 'inspect.dom');
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
            responseMode: {
                type: 'string',
                enum: ['full', 'compact'],
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
                        const metadataScripts = await hydrateScriptInventory(session, {
                            includeSource: false,
                            indexPolicy: args.indexPolicy || 'metadata-only',
                            maxScripts: 250,
                        });
                        if (typeof args.keyword === 'string' && args.keyword.length > 0) {
                            const metadataMatches = findScriptMetadataMatches(metadataScripts, args.keyword, typeof args.maxResults === 'number' ? args.maxResults : 100);
                            if (metadataMatches.length > 0) {
                                const paged = paginateItems(metadataMatches, {
                                    page: typeof args.page === 'number' ? args.page : undefined,
                                    pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
                                    cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
                                });
                                result = {
                                    keyword: String(args.keyword || ''),
                                    searchMode: 'metadata',
                                    totalMatches: metadataMatches.length,
                                    truncated: false,
                                    executionMode: 'metadata',
                                    matches: paged.items,
                                    page: paged.page,
                                };
                                break;
                            }
                        }
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
                                    loadStrategy: 'storage-index',
                                    matches: paged.items,
                                    page: paged.page,
                                };
                            }
                            else {
                                const workerResult = await progressivelySearchScriptSources(runtime, session, args);
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
                            const workerResult = await progressivelySearchScriptSources(runtime, session, args);
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
                            return errorResponse('Unsupported session engine', new Error('Function tree extraction requires a Playwright-backed session'));
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
                const payload = args.responseMode === 'compact' ? compactPayload(result) : result;
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-scripts', 'Script inspection payload', payload, session.sessionId);
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
            responseMode: {
                type: 'string',
                enum: ['full', 'compact'],
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
                const responsePayload = args.responseMode === 'compact' ? compactPayload(payload) : payload;
                const externalized = maybeExternalize(runtime.artifacts, 'inspect-network', 'Network inspection payload', responsePayload, session.sessionId);
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
        name: 'inspect.function-trace',
        group: 'inspect',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Start, read, stop, or clear structured runtime traces for a target function.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['start', 'read', 'stop', 'clear'],
            },
            functionName: {
                type: 'string',
            },
            captureArgs: {
                type: 'boolean',
            },
            captureReturn: {
                type: 'boolean',
            },
            captureStack: {
                type: 'boolean',
            },
        }, ['action', 'functionName']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const unsupported = requirePlaywrightFeatures(session, 'inspect.function-trace');
                if (unsupported) {
                    return errorResponse('Unsupported session engine', new Error(unsupported), {
                        sessionId: session.sessionId,
                    });
                }
                const functionName = String(args.functionName || '').trim();
                if (!functionName) {
                    return errorResponse('Function name missing', new Error('functionName is required'), {
                        sessionId: session.sessionId,
                    });
                }
                switch (args.action) {
                    case 'start': {
                        const started = await session.consoleMonitor.injectFunctionTracer(functionName, {
                            captureArgs: args.captureArgs !== false,
                            captureReturn: args.captureReturn !== false,
                            captureStack: args.captureStack === true,
                        });
                        return successResponse('Function trace started', started, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'read': {
                        const traceData = await session.consoleMonitor.readFunctionTrace(functionName);
                        const summary = buildReadSummary(traceData);
                        const inlinePayload = {
                            ...traceData,
                            summary,
                        };
                        const externalized = maybeExternalize(runtime.artifacts, 'function-trace', 'Function trace records', inlinePayload, session.sessionId);
                        const data = externalized.artifactId
                            ? {
                                functionName: traceData.functionName,
                                active: traceData.active === true,
                                settings: traceData.settings || {},
                                summary: {
                                    ...summary,
                                    references: {
                                        artifactId: externalized.artifactId,
                                        detailId: externalized.detailId,
                                    },
                                },
                            }
                            : inlinePayload;
                        return successResponse('Function trace loaded', data, {
                            sessionId: session.sessionId,
                            artifactId: externalized.artifactId,
                            detailId: externalized.detailId,
                        });
                    }
                    case 'clear': {
                        const cleared = await session.consoleMonitor.clearFunctionTrace(functionName);
                        return successResponse('Function trace cleared', cleared, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'stop': {
                        const stopped = await session.consoleMonitor.stopFunctionTrace(functionName);
                        return successResponse('Function trace stopped', stopped, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported function trace action', new Error('Unknown inspect.function-trace action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'inspect.interceptor',
        group: 'inspect',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Start, read, or clear XHR/fetch interception records captured in the page runtime.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['start', 'read', 'clear'],
            },
            type: {
                type: 'string',
                enum: ['xhr', 'fetch', 'both'],
            },
            urlPattern: {
                type: 'string',
            },
        }, ['action', 'type']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const unsupported = requirePlaywrightFeatures(session, 'inspect.interceptor');
                if (unsupported) {
                    return errorResponse('Unsupported session engine', new Error(unsupported), {
                        sessionId: session.sessionId,
                    });
                }
                const interceptionType = String(args.type || 'both');
                switch (args.action) {
                    case 'start': {
                        const results = [];
                        if (interceptionType === 'xhr' || interceptionType === 'both') {
                            results.push(await session.consoleMonitor.injectXHRInterceptor({
                                urlPattern: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
                            }));
                        }
                        if (interceptionType === 'fetch' || interceptionType === 'both') {
                            results.push(await session.consoleMonitor.injectFetchInterceptor({
                                urlPattern: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
                            }));
                        }
                        return successResponse('Interceptor started', {
                            type: interceptionType,
                            urlPattern: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
                            results,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'read': {
                        const intercepted = await session.consoleMonitor.readInterceptorRecords(interceptionType, typeof args.urlPattern === 'string' ? args.urlPattern : undefined);
                        const summary = buildReadSummary(intercepted);
                        const inlinePayload = {
                            ...intercepted,
                            summary,
                        };
                        const externalized = maybeExternalize(runtime.artifacts, 'interceptor-records', 'Interceptor records', inlinePayload, session.sessionId);
                        const data = externalized.artifactId
                            ? {
                                type: intercepted.type,
                                urlPattern: intercepted.urlPattern,
                                active: intercepted.active,
                                summary: {
                                    ...summary,
                                    references: {
                                        artifactId: externalized.artifactId,
                                        detailId: externalized.detailId,
                                    },
                                },
                            }
                            : inlinePayload;
                        return successResponse('Interceptor records loaded', data, {
                            sessionId: session.sessionId,
                            artifactId: externalized.artifactId,
                            detailId: externalized.detailId,
                        });
                    }
                    case 'clear': {
                        const cleared = await session.consoleMonitor.clearInterceptorRecords(interceptionType);
                        return successResponse('Interceptor records cleared', cleared, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported interceptor action', new Error('Unknown inspect.interceptor action'), {
                            sessionId: session.sessionId,
                        });
                }
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
    ];
}
