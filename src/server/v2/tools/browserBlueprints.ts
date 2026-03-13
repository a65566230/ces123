// @ts-nocheck

export function buildBrowserToolBlueprints(shared) {
    const {
        errorResponse,
        successResponse,
        sessionSchema,
        getSession,
        buildStatusPayload,
        buildRecoveryNextActions,
    } = shared;

    return [
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
                    enum: ['auto', 'playwright'],
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
                const payload = buildStatusPayload(session, status);
                return successResponse('Session status loaded', {
                    ...payload,
                    workerStats: runtime.workerService.getStats(),
                    runtimeMonitor: runtime.runtimeMonitor.getStats(),
                    rateLimit: runtime.toolRateLimiter.getStats(),
                }, {
                    sessionId: session.sessionId,
                    nextActions: buildRecoveryNextActions(session.sessionId, payload),
                });
            };
        },
    },
    {
        name: 'browser.recover',
        group: 'browser',
        lifecycle: 'session-required',
        description: 'Recover a browser session from the latest snapshot in the Playwright pool.',
        inputSchema: sessionSchema({
            engine: {
                type: 'string',
                enum: ['auto', 'playwright'],
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
        name: 'browser.storage',
        group: 'browser',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Get, set, or clear cookies, localStorage, and sessionStorage for the active page.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['get', 'set', 'clear'],
            },
            target: {
                type: 'string',
                enum: ['cookies', 'local', 'session'],
            },
            cookies: {
                type: 'array',
                items: {
                    type: 'object',
                },
            },
            entries: {
                type: 'object',
                additionalProperties: {
                    type: 'string',
                },
            },
        }, ['action', 'target']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.pageController) {
                    return errorResponse('Unsupported session engine', new Error('browser.storage requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                const target = String(args.target || '');
                switch (args.action) {
                    case 'get':
                        if (target === 'cookies') {
                            const cookies = await session.pageController.getCookies();
                            return successResponse('Cookies loaded', {
                                action: 'get',
                                target,
                                count: cookies.length,
                                cookies,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        if (target === 'local' || target === 'session') {
                            const entries = target === 'local'
                                ? await session.pageController.getLocalStorage()
                                : await session.pageController.getSessionStorage();
                            return successResponse(`${target}Storage loaded`, {
                                action: 'get',
                                target,
                                count: Object.keys(entries || {}).length,
                                entries,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        break;
                    case 'set':
                        if (target === 'cookies') {
                            const cookies = Array.isArray(args.cookies) ? args.cookies : [];
                            if (cookies.length === 0) {
                                return errorResponse('Cookie input missing', new Error('cookies is required when target=cookies and action=set'), {
                                    sessionId: session.sessionId,
                                });
                            }
                            await session.pageController.setCookies(cookies);
                            return successResponse('Cookies updated', {
                                action: 'set',
                                target,
                                count: cookies.length,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        if (target === 'local' || target === 'session') {
                            const entries = typeof args.entries === 'object' && args.entries !== null ? args.entries : {};
                            if (Object.keys(entries).length === 0) {
                                return errorResponse('Storage entries missing', new Error('entries is required when target=local/session and action=set'), {
                                    sessionId: session.sessionId,
                                });
                            }
                            await session.pageController.setStorageEntries(target === 'local' ? 'local' : 'session', entries);
                            return successResponse(`${target}Storage updated`, {
                                action: 'set',
                                target,
                                count: Object.keys(entries).length,
                                entries,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        break;
                    case 'clear':
                        if (target === 'cookies') {
                            await session.pageController.clearCookies();
                            return successResponse('Cookies cleared', {
                                action: 'clear',
                                target,
                                cleared: true,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        if (target === 'local' || target === 'session') {
                            await session.pageController.clearStorage(target === 'local' ? 'local' : 'session');
                            return successResponse(`${target}Storage cleared`, {
                                action: 'clear',
                                target,
                                cleared: true,
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        break;
                    default:
                        break;
                }
                return errorResponse('Unsupported storage operation', new Error('Unknown browser.storage action/target combination'), {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'browser.capture',
        group: 'browser',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Capture a screenshot from the active page.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['screenshot'],
            },
            path: {
                type: 'string',
                description: 'Optional filesystem path to save the screenshot',
            },
            type: {
                type: 'string',
                enum: ['png', 'jpeg'],
            },
            quality: {
                type: 'number',
            },
            fullPage: {
                type: 'boolean',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.pageController) {
                    return errorResponse('Unsupported session engine', new Error('browser.capture requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                if (args.action !== 'screenshot') {
                    return errorResponse('Unsupported capture action', new Error('Unknown browser.capture action'), {
                        sessionId: session.sessionId,
                    });
                }
                const type = args.type === 'jpeg' ? 'jpeg' : 'png';
                const buffer = await session.pageController.screenshot({
                    path: typeof args.path === 'string' ? args.path : undefined,
                    type,
                    quality: typeof args.quality === 'number' ? args.quality : undefined,
                    fullPage: args.fullPage === true,
                });
                return successResponse('Screenshot captured', {
                    action: 'screenshot',
                    path: typeof args.path === 'string' ? args.path : undefined,
                    type,
                    fullPage: args.fullPage === true,
                    sizeBytes: buffer.length,
                }, {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'browser.interact',
        group: 'browser',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Perform grouped page interaction actions such as click, type, hover, scroll, wait, select, and key press.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['click', 'type', 'select', 'hover', 'scroll', 'waitForSelector', 'pressKey'],
            },
            selector: {
                type: 'string',
            },
            text: {
                type: 'string',
            },
            button: {
                type: 'string',
                enum: ['left', 'middle', 'right'],
            },
            clickCount: {
                type: 'number',
            },
            delay: {
                type: 'number',
            },
            values: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
            x: {
                type: 'number',
            },
            y: {
                type: 'number',
            },
            timeout: {
                type: 'number',
            },
            key: {
                type: 'string',
            },
            replace: {
                type: 'boolean',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.pageController) {
                    return errorResponse('Unsupported session engine', new Error('browser.interact requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                switch (args.action) {
                    case 'click':
                        if (typeof args.selector !== 'string') {
                            return errorResponse('Selector missing', new Error('selector is required when action=click'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.pageController.click(String(args.selector), {
                            button: typeof args.button === 'string' ? args.button : undefined,
                            clickCount: typeof args.clickCount === 'number' ? args.clickCount : undefined,
                            delay: typeof args.delay === 'number' ? args.delay : undefined,
                        });
                        return successResponse('Interaction completed', {
                            action: 'click',
                            selector: String(args.selector),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'type':
                        if (typeof args.selector !== 'string' || typeof args.text !== 'string') {
                            return errorResponse('Type input missing', new Error('selector and text are required when action=type'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.pageController.type(String(args.selector), String(args.text), {
                            delay: typeof args.delay === 'number' ? args.delay : undefined,
                            replace: args.replace !== false,
                        });
                        return successResponse('Interaction completed', {
                            action: 'type',
                            selector: String(args.selector),
                            textLength: String(args.text).length,
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'select':
                        if (typeof args.selector !== 'string' || !Array.isArray(args.values) || args.values.length === 0) {
                            return errorResponse('Select input missing', new Error('selector and values are required when action=select'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.pageController.select(String(args.selector), ...args.values.map((value) => String(value)));
                        return successResponse('Interaction completed', {
                            action: 'select',
                            selector: String(args.selector),
                            values: args.values.map((value) => String(value)),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'hover':
                        if (typeof args.selector !== 'string') {
                            return errorResponse('Selector missing', new Error('selector is required when action=hover'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.pageController.hover(String(args.selector));
                        return successResponse('Interaction completed', {
                            action: 'hover',
                            selector: String(args.selector),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'scroll':
                        await session.pageController.scroll({
                            x: typeof args.x === 'number' ? args.x : 0,
                            y: typeof args.y === 'number' ? args.y : 0,
                        });
                        return successResponse('Interaction completed', {
                            action: 'scroll',
                            x: typeof args.x === 'number' ? args.x : 0,
                            y: typeof args.y === 'number' ? args.y : 0,
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'waitForSelector':
                        if (typeof args.selector !== 'string') {
                            return errorResponse('Selector missing', new Error('selector is required when action=waitForSelector'), {
                                sessionId: session.sessionId,
                            });
                        }
                        return successResponse('Interaction completed', {
                            action: 'waitForSelector',
                            result: await session.pageController.waitForSelector(String(args.selector), typeof args.timeout === 'number' ? args.timeout : undefined),
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'pressKey':
                        if (typeof args.key !== 'string') {
                            return errorResponse('Key missing', new Error('key is required when action=pressKey'), {
                                sessionId: session.sessionId,
                            });
                        }
                        await session.pageController.pressKey(String(args.key));
                        return successResponse('Interaction completed', {
                            action: 'pressKey',
                            key: String(args.key),
                        }, {
                            sessionId: session.sessionId,
                        });
                    default:
                        return errorResponse('Unsupported interaction action', new Error('Unknown browser.interact action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'browser.stealth',
        group: 'browser',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Apply anti-detection scripts and realistic user-agent shaping to the active browser session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['apply'],
            },
            platform: {
                type: 'string',
                enum: ['windows', 'mac', 'linux'],
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.pageController) {
                    return errorResponse('Unsupported session engine', new Error('browser.stealth requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                if (args.action !== 'apply') {
                    return errorResponse('Unsupported stealth action', new Error('Unknown browser.stealth action'), {
                        sessionId: session.sessionId,
                    });
                }
                const platform = typeof args.platform === 'string' ? args.platform : 'windows';
                const { StealthScripts2025 } = await import('../../../modules/stealth/StealthScripts2025.js');
                const page = await session.pageController.getPage();
                await StealthScripts2025.injectAll(page);
                await StealthScripts2025.setRealisticUserAgent(page, platform);
                return successResponse('Stealth settings applied', {
                    action: 'apply',
                    platform,
                    applied: true,
                }, {
                    sessionId: session.sessionId,
                });
            };
        },
    },
    {
        name: 'browser.captcha',
        group: 'browser',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Detect, wait for, or configure captcha handling for the active browser session.',
        inputSchema: sessionSchema({
            action: {
                type: 'string',
                enum: ['detect', 'wait', 'config'],
            },
            timeout: {
                type: 'number',
            },
            autoDetectCaptcha: {
                type: 'boolean',
            },
            autoSwitchHeadless: {
                type: 'boolean',
            },
            captchaTimeout: {
                type: 'number',
            },
        }, ['action']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.pageController) {
                    return errorResponse('Unsupported session engine', new Error('browser.captcha requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                session.captchaConfig = session.captchaConfig || {
                    autoDetectCaptcha: true,
                    autoSwitchHeadless: true,
                    captchaTimeout: 300000,
                };
                const { AICaptchaDetector } = await import('../../../modules/captcha/AICaptchaDetector.js');
                const screenshotDir = process.env.CAPTCHA_SCREENSHOT_DIR || './screenshots';
                const detector = new AICaptchaDetector(session.llm, screenshotDir);
                const page = await session.pageController.getPage();
                switch (args.action) {
                    case 'config':
                        if (typeof args.autoDetectCaptcha === 'boolean') {
                            session.captchaConfig.autoDetectCaptcha = args.autoDetectCaptcha;
                        }
                        if (typeof args.autoSwitchHeadless === 'boolean') {
                            session.captchaConfig.autoSwitchHeadless = args.autoSwitchHeadless;
                        }
                        if (typeof args.captchaTimeout === 'number') {
                            session.captchaConfig.captchaTimeout = args.captchaTimeout;
                        }
                        return successResponse('Captcha config updated', {
                            action: 'config',
                            config: {
                                ...session.captchaConfig,
                            },
                        }, {
                            sessionId: session.sessionId,
                        });
                    case 'detect': {
                        const result = await detector.detect(page);
                        return successResponse('Captcha detection completed', {
                            action: 'detect',
                            captchaDetected: result.detected === true,
                            captchaInfo: result,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'wait': {
                        const timeout = typeof args.timeout === 'number'
                            ? args.timeout
                            : session.captchaConfig.captchaTimeout;
                        const completed = await detector.waitForCompletion(page, timeout);
                        return successResponse('Captcha wait completed', {
                            action: 'wait',
                            completed,
                            timeout,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported captcha action', new Error('Unknown browser.captcha action'), {
                            sessionId: session.sessionId,
                        });
                }
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
                description: 'Enable request capture before navigation',
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
    ];
}
