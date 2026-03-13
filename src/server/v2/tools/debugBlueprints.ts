// @ts-nocheck

export function buildDebugToolBlueprints(shared) {
    const {
        errorResponse,
        successResponse,
        sessionSchema,
        getSession,
        ensureDebugCapabilities,
        evaluateWatchesInGlobalContext,
    } = shared;

    return [
{
        name: 'debug.control',
        group: 'debug',
        lifecycle: 'session-required',
        description: 'Enable or control the debugger for a Playwright-backed session.',
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
                    return errorResponse('Unsupported session engine', new Error('Debugging requires a Playwright-backed session'));
                }
                switch (args.action) {
                    case 'enable':
                        await session.debuggerManager.init();
                        await session.runtimeInspector.init();
                        await session.debuggerManager.initAdvancedFeatures(session.runtimeInspector);
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
                    return errorResponse('Unsupported session engine', new Error('Debugger evaluation requires a Playwright-backed session'));
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
        name: 'debug.breakpoint',
        group: 'debug',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Manage breakpoints and pause-on-exception settings for a Playwright-backed session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['set', 'remove', 'list', 'clear', 'setOnException'],
            },
            scriptId: {
                type: 'string',
            },
            url: {
                type: 'string',
            },
            lineNumber: {
                type: 'number',
            },
            columnNumber: {
                type: 'number',
            },
            condition: {
                type: 'string',
            },
            breakpointId: {
                type: 'string',
            },
            state: {
                type: 'string',
                enum: ['none', 'uncaught', 'all'],
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                try {
                    await ensureDebugCapabilities(session);
                }
                catch (error) {
                    return errorResponse('Unsupported session engine', error, {
                        sessionId: session.sessionId,
                    });
                }
                switch (args.action) {
                    case 'set': {
                        if (typeof args.lineNumber !== 'number') {
                            return errorResponse('Breakpoint line missing', new Error('lineNumber is required when action=set'), {
                                sessionId: session.sessionId,
                            });
                        }
                        let breakpoint;
                        if (typeof args.url === 'string') {
                            breakpoint = await session.debuggerManager.setBreakpointByUrl({
                                url: String(args.url),
                                lineNumber: args.lineNumber,
                                columnNumber: typeof args.columnNumber === 'number' ? args.columnNumber : undefined,
                                condition: typeof args.condition === 'string' ? args.condition : undefined,
                            });
                        }
                        else if (typeof args.scriptId === 'string') {
                            breakpoint = await session.debuggerManager.setBreakpoint({
                                scriptId: String(args.scriptId),
                                lineNumber: args.lineNumber,
                                columnNumber: typeof args.columnNumber === 'number' ? args.columnNumber : undefined,
                                condition: typeof args.condition === 'string' ? args.condition : undefined,
                            });
                        }
                        else {
                            return errorResponse('Breakpoint target missing', new Error('Provide url or scriptId when action=set'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Breakpoint set', {
                            breakpoint,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'remove':
                        if (typeof args.breakpointId !== 'string') {
                            return errorResponse('Breakpoint id missing', new Error('breakpointId is required when action=remove'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.debuggerManager.removeBreakpoint(String(args.breakpointId));
                        return successResponse('Breakpoint removed', {
                            breakpointId: String(args.breakpointId),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'list': {
                        const breakpoints = session.debuggerManager.listBreakpoints();
                        return successResponse('Breakpoint list loaded', {
                            count: breakpoints.length,
                            breakpoints,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'clear': {
                        const cleared = session.debuggerManager.listBreakpoints().length;
                        await session.debuggerManager.clearAllBreakpoints();
                        return successResponse('Breakpoints cleared', {
                            cleared,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'setOnException': {
                        const state = typeof args.state === 'string' ? args.state : 'uncaught';
                        await session.debuggerManager.setPauseOnExceptions(state);
                        return successResponse('Pause-on-exception state updated', {
                            state,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported breakpoint action', new Error('Unknown debug.breakpoint action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'debug.watch',
        group: 'debug',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Manage watch expressions for a Playwright-backed debug session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['add', 'remove', 'list', 'evaluate', 'clear'],
            },
            expression: {
                type: 'string',
            },
            name: {
                type: 'string',
            },
            watchId: {
                type: 'string',
            },
            callFrameId: {
                type: 'string',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                try {
                    await ensureDebugCapabilities(session);
                }
                catch (error) {
                    return errorResponse('Unsupported session engine', error, {
                        sessionId: session.sessionId,
                    });
                }
                const watchManager = session.debuggerManager.getWatchManager();
                switch (args.action) {
                    case 'add': {
                        if (typeof args.expression !== 'string' || args.expression.trim().length === 0) {
                            return errorResponse('Watch expression missing', new Error('expression is required when action=add'), {
                                sessionId: session.sessionId,
                            });
                        }
                        const watchId = watchManager.addWatch(String(args.expression), typeof args.name === 'string' ? args.name : undefined);
                        return successResponse('Watch expression added', {
                            watchId,
                            expression: String(args.expression),
                            name: typeof args.name === 'string' ? args.name : String(args.expression),
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'remove':
                        if (typeof args.watchId !== 'string') {
                            return errorResponse('Watch id missing', new Error('watchId is required when action=remove'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Watch expression removed', {
                            watchId: String(args.watchId),
                            removed: watchManager.removeWatch(String(args.watchId)),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'list': {
                        const watches = watchManager.getAllWatches();
                        return successResponse('Watch list loaded', {
                            count: watches.length,
                            watches,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'evaluate': {
                        const pausedState = session.debuggerManager.getPausedState();
                        const results = pausedState || typeof args.callFrameId === 'string'
                            ? await watchManager.evaluateAll(typeof args.callFrameId === 'string' ? args.callFrameId : undefined)
                            : await evaluateWatchesInGlobalContext(session, watchManager);
                        return successResponse('Watch expressions evaluated', {
                            count: results.length,
                            mode: pausedState || typeof args.callFrameId === 'string' ? 'call-frame' : 'global',
                            results,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'clear': {
                        const cleared = watchManager.getAllWatches().length;
                        watchManager.clearAll();
                        return successResponse('Watch expressions cleared', {
                            cleared,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported watch action', new Error('Unknown debug.watch action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'debug.xhr',
        group: 'debug',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Manage XHR and fetch breakpoints for a Playwright-backed debug session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['set', 'remove', 'list', 'clear'],
            },
            urlPattern: {
                type: 'string',
            },
            breakpointId: {
                type: 'string',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                try {
                    await ensureDebugCapabilities(session);
                }
                catch (error) {
                    return errorResponse('Unsupported session engine', error, {
                        sessionId: session.sessionId,
                    });
                }
                const xhrManager = session.debuggerManager.getXHRManager();
                switch (args.action) {
                    case 'set':
                        if (typeof args.urlPattern !== 'string' || args.urlPattern.trim().length === 0) {
                            return errorResponse('XHR pattern missing', new Error('urlPattern is required when action=set'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('XHR breakpoint set', {
                            breakpointId: await xhrManager.setXHRBreakpoint(String(args.urlPattern)),
                            urlPattern: String(args.urlPattern),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'remove':
                        if (typeof args.breakpointId !== 'string') {
                            return errorResponse('XHR breakpoint id missing', new Error('breakpointId is required when action=remove'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('XHR breakpoint removed', {
                            breakpointId: String(args.breakpointId),
                            removed: await xhrManager.removeXHRBreakpoint(String(args.breakpointId)),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'list': {
                        const breakpoints = xhrManager.getAllXHRBreakpoints();
                        return successResponse('XHR breakpoint list loaded', {
                            count: breakpoints.length,
                            breakpoints,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'clear': {
                        const cleared = xhrManager.getAllXHRBreakpoints().length;
                        await xhrManager.clearAllXHRBreakpoints();
                        return successResponse('XHR breakpoints cleared', {
                            cleared,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported XHR breakpoint action', new Error('Unknown debug.xhr action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'debug.event',
        group: 'debug',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Manage DOM and runtime event listener breakpoints for a Playwright-backed debug session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['set', 'setCategory', 'remove', 'list', 'clear'],
            },
            eventName: {
                type: 'string',
            },
            targetName: {
                type: 'string',
            },
            category: {
                type: 'string',
                enum: ['mouse', 'keyboard', 'timer', 'websocket'],
            },
            breakpointId: {
                type: 'string',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                try {
                    await ensureDebugCapabilities(session);
                }
                catch (error) {
                    return errorResponse('Unsupported session engine', error, {
                        sessionId: session.sessionId,
                    });
                }
                const eventManager = session.debuggerManager.getEventManager();
                switch (args.action) {
                    case 'set':
                        if (typeof args.eventName !== 'string' || args.eventName.trim().length === 0) {
                            return errorResponse('Event name missing', new Error('eventName is required when action=set'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Event breakpoint set', {
                            breakpointId: await eventManager.setEventListenerBreakpoint(
                                String(args.eventName),
                                typeof args.targetName === 'string' ? args.targetName : undefined,
                            ),
                            eventName: String(args.eventName),
                            targetName: typeof args.targetName === 'string' ? args.targetName : undefined,
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'setCategory': {
                        if (typeof args.category !== 'string') {
                            return errorResponse('Event category missing', new Error('category is required when action=setCategory'), {
                                sessionId: session.sessionId,
                            });
                        }
                        let breakpointIds;
                        switch (args.category) {
                            case 'mouse':
                                breakpointIds = await eventManager.setMouseEventBreakpoints();
                                break;
                            case 'keyboard':
                                breakpointIds = await eventManager.setKeyboardEventBreakpoints();
                                break;
                            case 'timer':
                                breakpointIds = await eventManager.setTimerEventBreakpoints();
                                break;
                            case 'websocket':
                                breakpointIds = await eventManager.setWebSocketEventBreakpoints();
                                break;
                            default:
                                return errorResponse('Unsupported event category', new Error('Unknown debug.event category'), {
                                    sessionId: session.sessionId,
                                });
                        }
                        return successResponse('Event breakpoint category applied', {
                            category: String(args.category),
                            breakpointIds,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'remove':
                        if (typeof args.breakpointId !== 'string') {
                            return errorResponse('Event breakpoint id missing', new Error('breakpointId is required when action=remove'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Event breakpoint removed', {
                            breakpointId: String(args.breakpointId),
                            removed: await eventManager.removeEventListenerBreakpoint(String(args.breakpointId)),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'list': {
                        const breakpoints = eventManager.getAllEventBreakpoints();
                        return successResponse('Event breakpoint list loaded', {
                            count: breakpoints.length,
                            breakpoints,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'clear': {
                        const cleared = eventManager.getAllEventBreakpoints().length;
                        await eventManager.clearAllEventBreakpoints();
                        return successResponse('Event breakpoints cleared', {
                            cleared,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported event breakpoint action', new Error('Unknown debug.event action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'debug.blackbox',
        group: 'debug',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Manage blackboxed script patterns for a Playwright-backed debug session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['add', 'addCommon', 'remove', 'list', 'clear'],
            },
            urlPattern: {
                type: 'string',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                try {
                    await ensureDebugCapabilities(session);
                }
                catch (error) {
                    return errorResponse('Unsupported session engine', error, {
                        sessionId: session.sessionId,
                    });
                }
                const blackboxManager = session.debuggerManager.getBlackboxManager();
                switch (args.action) {
                    case 'add':
                        if (typeof args.urlPattern !== 'string' || args.urlPattern.trim().length === 0) {
                            return errorResponse('Blackbox pattern missing', new Error('urlPattern is required when action=add'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await blackboxManager.blackboxByPattern(String(args.urlPattern));
                        return successResponse('Blackbox pattern added', {
                            urlPattern: String(args.urlPattern),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'addCommon':
                        await blackboxManager.blackboxCommonLibraries();
                        return successResponse('Common library patterns blackboxed', {
                            patterns: blackboxManager.getAllBlackboxedPatterns(),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'remove':
                        if (typeof args.urlPattern !== 'string') {
                            return errorResponse('Blackbox pattern missing', new Error('urlPattern is required when action=remove'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Blackbox pattern removed', {
                            urlPattern: String(args.urlPattern),
                            removed: await blackboxManager.unblackboxByPattern(String(args.urlPattern)),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'list': {
                        const patterns = blackboxManager.getAllBlackboxedPatterns();
                        return successResponse('Blackbox pattern list loaded', {
                            count: patterns.length,
                            patterns,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'clear': {
                        const cleared = blackboxManager.getAllBlackboxedPatterns().length;
                        await blackboxManager.clearAllBlackboxedPatterns();
                        return successResponse('Blackbox patterns cleared', {
                            cleared,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported blackbox action', new Error('Unknown debug.blackbox action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    ];
}
