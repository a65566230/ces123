// @ts-nocheck

export function buildAnalyzeToolBlueprints(shared) {
    const {
        errorResponse,
        maybeExternalize,
        successResponse,
        LLMService,
        CodeAnalyzer,
        CryptoDetector,
        ObfuscationAnalysisService,
        getSession,
        hydrateScriptInventory,
        resolveScriptSource,
        createStandaloneLLMService,
    } = shared;

    function normalizeCoverageLimit(maxScripts) {
        if (typeof maxScripts !== 'number' || !Number.isFinite(maxScripts)) {
            return 5;
        }
        return Math.max(1, Math.min(20, Math.trunc(maxScripts)));
    }

    function pushCoverageAction(actions, seen, action) {
        const key = JSON.stringify([
            action?.tool,
            action?.action,
            action?.scriptId,
            action?.url,
        ]);
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        actions.push(action);
    }

    async function buildCoveragePayload(session, coverageEntries, maxScripts) {
        const status = await session.engine.getStatus().catch(() => undefined);
        const scripts = await hydrateScriptInventory(session, {
            includeSource: false,
            indexPolicy: 'metadata-only',
            maxScripts: 250,
            currentUrl: status?.currentUrl,
        });
        const scriptByUrl = new Map((scripts || [])
            .filter((script) => typeof script?.url === 'string' && script.url.length > 0)
            .map((script) => [script.url, script]));
        const records = (coverageEntries || [])
            .filter((entry) => typeof entry?.url === 'string' && entry.url.length > 0)
            .map((entry) => {
            const matchedScript = scriptByUrl.get(entry.url);
            return {
                scriptId: matchedScript?.scriptId,
                url: entry.url,
                totalBytes: Number(entry.totalBytes || 0),
                usedBytes: Number(entry.usedBytes || 0),
                coveragePercentage: Number(entry.coveragePercentage || 0),
                rangeCount: Array.isArray(entry.ranges) ? entry.ranges.length : 0,
            };
        })
            .sort((left, right) => {
            if (right.usedBytes !== left.usedBytes) {
                return right.usedBytes - left.usedBytes;
            }
            if (right.coveragePercentage !== left.coveragePercentage) {
                return right.coveragePercentage - left.coveragePercentage;
            }
            return String(left.url || '').localeCompare(String(right.url || ''));
        });
        const hotScripts = records.slice(0, normalizeCoverageLimit(maxScripts)).map((entry) => ({
            scriptId: entry.scriptId,
            url: entry.url,
            usedBytes: entry.usedBytes,
            totalBytes: entry.totalBytes,
            coveragePercentage: Number(entry.coveragePercentage.toFixed(2)),
            rangeCount: entry.rangeCount,
        }));
        const recommendedActions = [];
        const seen = new Set();
        for (const entry of hotScripts.slice(0, 3)) {
            pushCoverageAction(recommendedActions, seen, {
                tool: 'inspect.scripts',
                action: 'source',
                scriptId: entry.scriptId,
                url: entry.url,
                reason: `Inspect hot covered script ${entry.url}`,
            });
            pushCoverageAction(recommendedActions, seen, {
                tool: 'analyze.rank-functions',
                scriptId: entry.scriptId,
                url: entry.url,
                reason: `Rank likely-significant functions in hot covered script ${entry.url}`,
            });
        }
        const totalScripts = records.length;
        const coveredScripts = records.filter((entry) => entry.usedBytes > 0).length;
        const totalUsedBytes = records.reduce((sum, entry) => sum + entry.usedBytes, 0);
        const avgCoveragePercentage = totalScripts > 0
            ? Number((records.reduce((sum, entry) => sum + entry.coveragePercentage, 0) / totalScripts).toFixed(2))
            : 0;
        return {
            records,
            summary: {
                scope: 'scripts',
                totalScripts,
                coveredScripts,
                totalUsedBytes,
                avgCoveragePercentage,
                hotScripts,
                candidateRefinementHints: hotScripts.slice(0, 3).map((entry) => `Hot script ${entry.url} executed ${entry.usedBytes} bytes (${entry.coveragePercentage}% coverage).`),
            },
            recommendedActions,
        };
    }

    return [
{
        name: 'analyze.understand',
        group: 'analyze',
        lifecycle: 'session-optional',
        profiles: ['expert', 'legacy'],
        description: 'Generate a structured understanding report for a script or code snippet.',
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
                context: {
                    type: 'object',
                },
                focus: {
                    type: 'string',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                let analyzer;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                    analyzer = session.analyzer;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                    analyzer = new CodeAnalyzer(createStandaloneLLMService(runtime));
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const analysis = await analyzer.understand({
                    code: source,
                    context: typeof args.context === 'object' ? args.context : undefined,
                    focus: typeof args.focus === 'string' ? args.focus : 'all',
                });
                const externalized = maybeExternalize(runtime.artifacts, 'understand-code', 'Structured code understanding result', analysis, sessionId);
                const evidence = runtime.evidence.create('understand-code', 'Code understanding completed', {
                    qualityScore: analysis.qualityScore,
                    functionCount: analysis.structure?.functions?.length || 0,
                    securityRiskCount: analysis.securityRisks?.length || 0,
                }, sessionId);
                return successResponse('Code understanding completed', externalized.data, {
                    sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.crypto',
        group: 'analyze',
        lifecycle: 'session-optional',
        profiles: ['expert', 'legacy'],
        description: 'Detect cryptographic libraries, algorithms, and security issues in a script or code snippet.',
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
                useAI: {
                    type: 'boolean',
                },
            },
        },
        createHandler(runtime) {
            return async (args) => {
                let source;
                let sessionId;
                let detector;
                if (typeof args.sessionId === 'string') {
                    const session = getSession(runtime, args.sessionId);
                    if (!session) {
                        return errorResponse('Session not found', new Error('Unknown sessionId'));
                    }
                    sessionId = session.sessionId;
                    source = (await resolveScriptSource(session, args)).source;
                    detector = session.cryptoDetector;
                }
                else if (typeof args.code === 'string') {
                    source = args.code;
                    detector = new CryptoDetector(createStandaloneLLMService(runtime));
                }
                else {
                    return errorResponse('Code input missing', new Error('Provide code or sessionId + scriptId/url'));
                }
                const analysis = await detector.detect({
                    code: source,
                    useAI: args.useAI !== false,
                });
                const externalized = maybeExternalize(runtime.artifacts, 'crypto-analysis', 'Structured crypto analysis result', analysis, sessionId);
                const evidence = runtime.evidence.create('crypto-analysis', 'Crypto analysis completed', {
                    algorithmCount: analysis.algorithms?.length || 0,
                    libraryCount: analysis.libraries?.length || 0,
                    securityIssueCount: analysis.securityIssues?.length || 0,
                    strength: analysis.strength,
                }, sessionId);
                return successResponse('Crypto analysis completed', externalized.data, {
                    sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    {
        name: 'analyze.coverage',
        group: 'analyze',
        lifecycle: 'session-required',
        profiles: ['expert', 'legacy'],
        description: 'Start, stop, or summarize precise coverage for hot scripts in a Playwright-backed session.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                },
                action: {
                    type: 'string',
                    enum: ['start', 'stop', 'summary'],
                },
                maxScripts: {
                    type: 'number',
                },
            },
            required: ['sessionId', 'action'],
        },
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                if (!session.performanceMonitor) {
                    return errorResponse('Unsupported session engine', new Error('Coverage analysis requires a Playwright-backed session'), {
                        sessionId: session.sessionId,
                    });
                }
                const maxScripts = normalizeCoverageLimit(args.maxScripts);
                switch (args.action) {
                    case 'start': {
                        const state = await session.performanceMonitor.startCoverage();
                        return successResponse('Coverage collection started', {
                            active: state.active,
                            startedAt: state.startedAt,
                            collectedAt: state.collectedAt,
                            hasCoverageResult: state.hasCoverageResult,
                            totalScripts: state.totalScripts,
                            scope: 'scripts',
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    case 'stop': {
                        const coverage = await session.performanceMonitor.stopCoverage();
                        const payload = await buildCoveragePayload(session, coverage, maxScripts);
                        const state = session.performanceMonitor.getCoverageState();
                        const evidence = runtime.evidence.create('coverage-analysis', 'Coverage analysis completed', {
                            summary: payload.summary,
                            recommendedActions: payload.recommendedActions,
                        }, session.sessionId);
                        const fullPayload = {
                            action: 'stop',
                            active: state.active,
                            startedAt: state.startedAt,
                            collectedAt: state.collectedAt,
                            scope: 'scripts',
                            records: payload.records,
                            summary: payload.summary,
                            recommendedActions: payload.recommendedActions,
                        };
                        const externalized = maybeExternalize(runtime.artifacts, 'coverage-analysis', 'Coverage analysis result', fullPayload, session.sessionId);
                        const data = externalized.artifactId
                            ? {
                                action: 'stop',
                                active: state.active,
                                startedAt: state.startedAt,
                                collectedAt: state.collectedAt,
                                scope: 'scripts',
                                summary: {
                                    ...payload.summary,
                                    references: {
                                        artifactId: externalized.artifactId,
                                        detailId: externalized.detailId,
                                        evidenceIds: [evidence.id],
                                    },
                                },
                                recommendedActions: payload.recommendedActions,
                            }
                            : fullPayload;
                        return successResponse('Coverage analysis completed', data, {
                            sessionId: session.sessionId,
                            artifactId: externalized.artifactId,
                            detailId: externalized.detailId,
                            evidenceIds: [evidence.id],
                        });
                    }
                    case 'summary': {
                        const state = session.performanceMonitor.getCoverageState();
                        const lastCoverage = session.performanceMonitor.getLastCoverage();
                        if (lastCoverage.length === 0) {
                            return successResponse('Coverage summary unavailable', {
                                action: 'summary',
                                active: state.active,
                                startedAt: state.startedAt,
                                collectedAt: state.collectedAt,
                                scope: 'scripts',
                                summary: null,
                                recommendedActions: [],
                            }, {
                                sessionId: session.sessionId,
                            });
                        }
                        const payload = await buildCoveragePayload(session, lastCoverage, maxScripts);
                        return successResponse('Coverage summary loaded', {
                            action: 'summary',
                            active: state.active,
                            startedAt: state.startedAt,
                            collectedAt: state.collectedAt,
                            scope: 'scripts',
                            summary: payload.summary,
                            recommendedActions: payload.recommendedActions,
                        }, {
                            sessionId: session.sessionId,
                        });
                    }
                    default:
                        return errorResponse('Unsupported coverage action', new Error('Unknown analyze.coverage action'), {
                            sessionId: session.sessionId,
                        });
                }
            };
        },
    },
    {
        name: 'analyze.bundle-fingerprint',
        group: 'analyze',
        lifecycle: 'session-optional',
        profiles: ['expert', 'legacy'],
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
        profiles: ['expert', 'legacy'],
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
        profiles: ['expert', 'legacy'],
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
        profiles: ['expert', 'legacy'],
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
        profiles: ['expert', 'legacy'],
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
        profiles: ['expert', 'legacy'],
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
    ];
}
