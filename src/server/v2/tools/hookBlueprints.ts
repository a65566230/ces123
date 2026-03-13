// @ts-nocheck

export function buildHookToolBlueprints(shared) {
    const {
        errorResponse,
        maybeExternalize,
        successResponse,
        LLMService,
        sessionSchema,
        getSession,
        buildHookContext,
    } = shared;

    function deriveObjectMethodTarget(objectPath) {
        if (typeof objectPath !== 'string' || !/^(window|globalThis|self)(\.[A-Za-z_$][\w$]*)+$/.test(objectPath)) {
            return null;
        }
        const match = objectPath.match(/^(.*)\.([^.]+)$/);
        if (!match) {
            return null;
        }
        return {
            type: 'object-method',
            object: match[1],
            property: match[2],
            name: match[2],
        };
    }

    function normalizePreferredHookTypes(preferredHookTypes) {
        return Array.isArray(preferredHookTypes)
            ? preferredHookTypes.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : [];
    }

    function isNoisyObjectPath(objectPath) {
        return /^(window|globalThis|self)\.(navigator|document|location|chrome|history|localStorage|sessionStorage|performance|JSON|Math|console)\b/.test(String(objectPath || ''));
    }

    function buildHookCandidates(hookContext, args) {
        const preferredTypes = normalizePreferredHookTypes(args?.preferredHookTypes);
        const normalizedTargetField = typeof args?.targetField === 'string' ? args.targetField.trim().toLowerCase() : '';
        const providedCandidates = Array.isArray(args?.candidates) ? args.candidates : [];
        const candidates = [];
        const seen = new Set();
        const pushCandidate = (candidate) => {
            if (!candidate || typeof candidate !== 'object') {
                return;
            }
            if (preferredTypes.length > 0 && !preferredTypes.includes(String(candidate.target?.type || ''))) {
                return;
            }
            const key = JSON.stringify([candidate.target?.type, candidate.target?.object, candidate.target?.property, candidate.target?.name]);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            candidates.push(candidate);
        };
        for (const candidate of providedCandidates) {
            pushCandidate(candidate);
        }
        for (const signatureCandidate of hookContext?.signatureCandidates || []) {
            for (const objectPath of signatureCandidate.objectPaths || []) {
                if (isNoisyObjectPath(objectPath)) {
                    continue;
                }
                const target = deriveObjectMethodTarget(objectPath);
                if (!target) {
                    continue;
                }
                pushCandidate({
                    target,
                    score: 0.92
                        + (normalizedTargetField && String(objectPath).toLowerCase().includes(normalizedTargetField) ? 0.18 : 0)
                        + (((signatureCandidate.fieldWriteHints || []).length || 0) > 0 ? 0.12 : 0),
                    reasoning: ['object-path-candidate', 'runtime-call-surface'],
                    verification: ['inspect.function-trace', 'inspect.interceptor'],
                });
            }
            for (const rankedFunction of signatureCandidate.rankedFunctions || []) {
                if (typeof rankedFunction?.name !== 'string' || rankedFunction.name.length === 0) {
                    continue;
                }
                pushCandidate({
                    target: {
                        type: 'function',
                        name: rankedFunction.name,
                    },
                    score: 0.68
                        + (normalizedTargetField && String(rankedFunction.name || '').toLowerCase().includes(normalizedTargetField) ? 0.08 : 0)
                        + (((signatureCandidate.fieldWriteHints || []).length || 0) > 0 ? 0.08 : 0),
                    reasoning: ['ranked-function-candidate'],
                    verification: ['inspect.function-trace', 'debug.breakpoint'],
                });
            }
        }
        pushCandidate({
            target: {
                type: 'api',
                name: 'fetch',
            },
            score: 0.4,
            reasoning: ['api-fallback'],
            verification: ['inspect.interceptor'],
        });
        return candidates
            .slice()
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    }

    function resolveInjectStrategy(requestedStrategy, onNewDocument, generated) {
        if (requestedStrategy === 'pre-init') {
            return {
                injectStrategy: 'pre-init',
                onNewDocument: true,
                code: String(generated?.generatedCode || ''),
            };
        }
        if (requestedStrategy === 'runtime') {
            return {
                injectStrategy: 'runtime',
                onNewDocument: false,
                code: String(generated?.generatedCode || ''),
            };
        }
        if (requestedStrategy === 'delayed') {
            return {
                injectStrategy: 'delayed',
                onNewDocument: false,
                code: `setTimeout(() => { ${String(generated?.generatedCode || '')} }, 0);`,
            };
        }
        if (onNewDocument === true) {
            return {
                injectStrategy: 'pre-init',
                onNewDocument: true,
                code: String(generated?.generatedCode || ''),
            };
        }
        return {
            injectStrategy: 'runtime',
            onNewDocument: false,
            code: String(generated?.generatedCode || ''),
        };
    }

    function collectTargetFieldPaths(value, targetField, currentPath = '', depth = 0, seen = new WeakSet()) {
        if (!targetField || value === null || typeof value !== 'object' || depth > 4) {
            return [];
        }
        if (seen.has(value)) {
            return [];
        }
        seen.add(value);
        const matches = [];
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                matches.push(...collectTargetFieldPaths(item, targetField, `${currentPath}[${index}]`, depth + 1, seen));
            });
            return matches;
        }
        for (const key of Object.keys(value)) {
            const nextPath = currentPath ? `${currentPath}.${key}` : key;
            if (key === targetField) {
                matches.push(nextPath);
            }
            matches.push(...collectTargetFieldPaths(value[key], targetField, nextPath, depth + 1, seen));
        }
        return matches;
    }

    function buildTargetFieldSummary(records, targetField) {
        if (typeof targetField !== 'string' || targetField.trim().length === 0) {
            return {};
        }
        const normalizedTarget = targetField.trim();
        let bestHitSummary = null;
        let targetFieldObserved = false;
        let fieldWriteObserved = false;
        let requestCorrelationObserved = false;
        let finalPayloadCorrelationObserved = false;
        let hitCount = 0;
        for (const record of Array.isArray(records) ? records : []) {
            const matchedPaths = collectTargetFieldPaths(record, normalizedTarget);
            if (matchedPaths.length === 0) {
                continue;
            }
            targetFieldObserved = true;
            fieldWriteObserved = true;
            hitCount += 1;
            if (record?.request || record?.url || record?.method) {
                requestCorrelationObserved = true;
            }
            if (record?.payload || record?.finalPayload || record?.returnValue || record?.body) {
                finalPayloadCorrelationObserved = true;
            }
            if (!bestHitSummary) {
                bestHitSummary = {
                    matchedField: normalizedTarget,
                    matchedPaths: matchedPaths.slice(0, 5),
                    previewKeys: Object.keys(record || {}).slice(0, 8),
                };
            }
        }
        return {
            targetField: normalizedTarget,
            hitCount,
            targetFieldObserved,
            fieldWriteObserved,
            requestCorrelationObserved,
            finalPayloadCorrelationObserved,
            bestHitSummary,
            rerankHint: targetFieldObserved && (requestCorrelationObserved || finalPayloadCorrelationObserved)
                ? 'promote-candidate'
                : targetFieldObserved
                    ? 'keep-candidate'
                    : 'needs-more-evidence',
        };
    }

    return [
{
        name: 'hook.generate',
        group: 'hook',
        lifecycle: 'session-optional',
        profiles: ['expert', 'legacy'],
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
                targetField: {
                    type: 'string',
                },
                fieldRole: {
                    type: 'string',
                    enum: ['explicit', 'derived', 'final-signature'],
                },
                candidates: {
                    type: 'array',
                    items: {
                        type: 'object',
                    },
                },
                preferredHookTypes: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
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
                const hookContext = session ? await buildHookContext(runtime, session, String(args.description), {
                    targetField: args.targetField,
                    fieldRole: args.fieldRole,
                }) : undefined;
                const candidates = buildHookCandidates(hookContext, args);
                const selectedCandidate = typeof args.target === 'object' && args.target
                    ? { target: args.target, score: 1, reasoning: ['explicit-target'], verification: ['inspect.function-trace'] }
                    : candidates[0];
                const generated = await generator.generateHook({
                    description: String(args.description),
                    target: typeof args.target === 'object' && args.target ? args.target : undefined,
                    explicitTarget: typeof args.target === 'object' && args.target ? true : false,
                    behavior: args.behavior,
                    condition: args.condition,
                    context: hookContext,
                    sessionId: session?.sessionId,
                });
                const payload = {
                    ...generated,
                    targetField: typeof args.targetField === 'string' ? args.targetField : undefined,
                    fieldRole: typeof args.fieldRole === 'string' ? args.fieldRole : undefined,
                    selectedCandidate,
                    candidates,
                    candidateScores: candidates.map((candidate) => ({
                        target: candidate.target,
                        score: candidate.score,
                    })),
                    verification: Array.isArray(selectedCandidate?.verification) ? selectedCandidate.verification : [],
                    reasoning: Array.isArray(selectedCandidate?.reasoning) ? selectedCandidate.reasoning : [],
                };
                const evidence = runtime.evidence.create('hook-template', 'Hook template generated', payload, session?.sessionId);
                if (session?.sessionId) {
                    await runtime.storage.recordHookEvent(session.sessionId, {
                        hookId: generated.hookId,
                        eventType: 'hook-template-generated',
                        summary: generated.strategy?.explanation || String(args.description),
                        payload,
                        createdAt: Date.now(),
                    });
                }
                return successResponse('Hook template generated', payload, {
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
        profiles: ['expert', 'legacy'],
        description: 'Inject a hook script into the active page.',
        inputSchema: sessionSchema({
            code: {
                type: 'string',
            },
            onNewDocument: {
                type: 'boolean',
            },
            injectStrategy: {
                type: 'string',
                enum: ['pre-init', 'runtime', 'delayed', 'auto'],
            },
        }, ['code']),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const strategy = resolveInjectStrategy(typeof args.injectStrategy === 'string' ? args.injectStrategy : 'auto', args.onNewDocument === true, {
                    generatedCode: String(args.code),
                });
                await session.engine.injectHook(strategy.code, {
                    onNewDocument: strategy.onNewDocument,
                });
                await runtime.sessions.refreshSnapshot(session);
                const evidence = runtime.evidence.create('hook-injection', 'Hook injected into page', {
                    onNewDocument: strategy.onNewDocument,
                    injectStrategy: strategy.injectStrategy,
                }, session.sessionId);
                return successResponse('Hook injected successfully', {
                    onNewDocument: strategy.onNewDocument,
                    injectStrategy: strategy.injectStrategy,
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
        profiles: ['expert', 'legacy'],
        description: 'Read captured records from a generated AI hook.',
        inputSchema: sessionSchema({
            hookId: {
                type: 'string',
            },
            targetField: {
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
                const summary = {
                    totalRecords: Number(result.totalRecords || 0),
                    hasRecords: Number(result.totalRecords || 0) > 0,
                    suggestedNextActions: Number(result.totalRecords || 0) > 0
                        ? ['Inspect the captured records and correlate them with flow.find-signature-path candidates.']
                        : ['Exercise the target page flow, then re-run hook.data to confirm the hook fires.'],
                    ...buildTargetFieldSummary(result.records, args.targetField),
                };
                const evidence = runtime.evidence.create('hook-data', 'Captured hook data loaded', {
                    hookId: String(args.hookId),
                    metadata: result.metadata,
                    summary,
                }, session.sessionId);
                const artifactPayload = {
                    ...result,
                };
                const externalized = maybeExternalize(runtime.artifacts, 'hook-data', 'Captured hook data', artifactPayload, session.sessionId);
                const data = externalized.artifactId
                    ? {
                        hookId: result.hookId,
                        metadata: result.metadata,
                        summary: {
                            ...summary,
                            references: {
                                artifactId: externalized.artifactId,
                                detailId: externalized.detailId,
                                evidenceIds: [evidence.id],
                            },
                        },
                    }
                    : {
                        ...result,
                        summary,
                    };
                return successResponse('Hook data loaded', data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                });
            };
        },
    },
    ];
}
