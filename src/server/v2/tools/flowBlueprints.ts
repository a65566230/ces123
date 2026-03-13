// @ts-nocheck

export function buildFlowToolBlueprints(shared) {
    const {
        compactPayload,
        errorResponse,
        maybeExternalize,
        successResponse,
        sessionSchema,
        getSession,
        normalizeBudgets,
        buildStatusPayload,
        buildRecoveryNextActions,
        buildHookContext,
        hydrateScriptInventory,
        buildToolDiagnostic,
        collectExceptionPauseHints,
        collectExceptionStackBreakpointHints,
        buildExceptionDerivedCandidates,
        buildPausedStateDerivedCandidates,
        buildPausedStateExceptionRecords,
        collectObservedPausedLocationHints,
        collectObservedExceptionTopFrameHints,
        progressivelySearchScriptSources,
        buildCandidateDebugPlan,
        scoreSignatureCandidate,
        buildReportDebugPlan,
        collectSignatureCandidate,
        resolveReportFingerprintCandidates,
        resolveScriptSource,
    } = shared;

    function hasCommonLibraryNoise(scripts) {
        const patterns = [
            /react/i,
            /lodash/i,
            /webpack/i,
            /analytics/i,
            /vendor/i,
            /chunk-vendors/i,
            /polyfill/i,
        ];
        return (scripts || []).filter((script) => {
            const url = String(script?.url || '');
            return patterns.some((pattern) => pattern.test(url));
        }).length >= 2;
    }

    function getCoverageBoostMaps(runtime, sessionId) {
        const coverageEntries = runtime.evidence.listBySession(sessionId)
            .filter((item) => item.kind === 'coverage-analysis');
        const latest = coverageEntries[coverageEntries.length - 1];
        const hotScripts = Array.isArray(latest?.data?.summary?.hotScripts) ? latest.data.summary.hotScripts : [];
        return {
            coverageByScriptId: new Map(hotScripts
                .filter((item) => typeof item?.scriptId === 'string')
                .map((item) => [item.scriptId, item])),
            coverageByUrl: new Map(hotScripts
                .filter((item) => typeof item?.url === 'string')
                .map((item) => [item.url, item])),
        };
    }

    function getHookEvidenceBoostMaps(runtime, sessionId, targetField) {
        const normalizedTarget = typeof targetField === 'string' ? targetField.trim() : '';
        const hookBoostByObjectPath = new Map();
        const hookBoostByFunctionName = new Map();
        if (!normalizedTarget) {
            return {
                hookBoostByObjectPath,
                hookBoostByFunctionName,
            };
        }
        const evidence = runtime.evidence.listBySession(sessionId)
            .filter((item) => item.kind === 'hook-data');
        for (const entry of evidence) {
            if (entry?.data?.summary?.targetField !== normalizedTarget) {
                continue;
            }
            if (entry?.data?.summary?.targetFieldObserved !== true) {
                continue;
            }
            const boost = entry?.data?.summary?.rerankHint === 'promote-candidate' ? 140 : 60;
            const metadataTarget = entry?.data?.metadata?.target;
            if (typeof metadataTarget === 'string' && metadataTarget.trim().length > 0) {
                hookBoostByObjectPath.set(metadataTarget, Math.max(Number(hookBoostByObjectPath.get(metadataTarget) || 0), boost));
                const functionName = metadataTarget.split('.').pop();
                if (functionName) {
                    hookBoostByFunctionName.set(functionName, Math.max(Number(hookBoostByFunctionName.get(functionName) || 0), Math.round(boost / 2)));
                }
            }
            else if (metadataTarget && typeof metadataTarget === 'object') {
                const objectPath = metadataTarget.object && metadataTarget.property
                    ? `${metadataTarget.object}.${metadataTarget.property}`
                    : undefined;
                if (objectPath) {
                    hookBoostByObjectPath.set(objectPath, Math.max(Number(hookBoostByObjectPath.get(objectPath) || 0), boost));
                }
                const functionName = metadataTarget.property || metadataTarget.name;
                if (functionName) {
                    hookBoostByFunctionName.set(functionName, Math.max(Number(hookBoostByFunctionName.get(functionName) || 0), Math.round(boost / 2)));
                }
            }
        }
        return {
            hookBoostByObjectPath,
            hookBoostByFunctionName,
        };
    }

    function reorderActions(actions, preferredValidation, fieldRole) {
        if (!Array.isArray(actions) || actions.length === 0) {
            return actions || [];
        }
        const explicitOrder = Array.isArray(preferredValidation)
            ? preferredValidation.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : [];
        const derivedDefaults = (typeof fieldRole === 'string' && ['derived', 'final-signature'].includes(fieldRole))
            ? ['inspect.function-trace', 'inspect.interceptor', 'debug.blackbox']
            : [];
        const order = Array.from(new Set([...explicitOrder, ...derivedDefaults]));
        if (order.length === 0) {
            return actions;
        }
        const indexed = actions.map((action, index) => ({ action, index }));
        indexed.sort((left, right) => {
            const leftPriority = order.indexOf(String(left.action?.tool || ''));
            const rightPriority = order.indexOf(String(right.action?.tool || ''));
            const normalizedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
            const normalizedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
            if (normalizedLeft !== normalizedRight) {
                return normalizedLeft - normalizedRight;
            }
            return left.index - right.index;
        });
        return indexed.map((entry) => entry.action);
    }

    function ensurePreferredValidationActions(actions, preferredValidation) {
        const nextActions = Array.isArray(actions) ? [...actions] : [];
        const preferred = Array.isArray(preferredValidation)
            ? preferredValidation.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : [];
        if (preferred.includes('debug.blackbox') && !nextActions.some((item) => item?.tool === 'debug.blackbox')) {
            nextActions.push({
                tool: 'debug.blackbox',
                action: 'addCommon',
                reason: 'Reduce common-library noise before validating preferred candidate paths.',
                confidence: 'low',
                verification: 'preferred-validation',
            });
        }
        return nextActions;
    }

    function actionKey(action) {
        return JSON.stringify([
            action?.tool,
            action?.action,
            action?.url,
            action?.scriptId,
            action?.lineNumber,
            action?.expression,
            action?.urlPattern,
            action?.functionName,
            action?.type,
            action?.requestId,
            action?.state,
        ]);
    }

    function pushUniqueAction(actions, seen, action) {
        if (!action || typeof action !== 'object') {
            return;
        }
        const key = actionKey(action);
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        actions.push(action);
    }

    function buildTraceRecommendedActions(args, snapshot) {
        const actions = [];
        const seen = new Set();
        if (typeof args.urlPattern === 'string' && args.urlPattern.trim().length > 0) {
            pushUniqueAction(actions, seen, {
                tool: 'debug.xhr',
                action: 'set',
                urlPattern: String(args.urlPattern),
                reason: `Pause on requests matching "${args.urlPattern}"`,
            });
            pushUniqueAction(actions, seen, {
                tool: 'inspect.interceptor',
                action: 'start',
                type: 'both',
                urlPattern: String(args.urlPattern),
                reason: `Capture runtime request inputs for URLs matching "${args.urlPattern}"`,
            });
        }
        const firstRequest = Array.isArray(snapshot?.requests) ? snapshot.requests[0] : undefined;
        if (firstRequest?.requestId) {
            pushUniqueAction(actions, seen, {
                tool: 'inspect.network',
                requestId: firstRequest.requestId,
                reason: 'Inspect the most relevant request record in detail.',
            });
        }
        if (typeof args.urlPattern === 'string' && args.urlPattern.trim().length > 0) {
            pushUniqueAction(actions, seen, {
                tool: 'flow.find-signature-path',
                requestPattern: String(args.urlPattern),
                reason: 'Promote the traced request pattern into candidate function discovery.',
            });
        }
        return actions;
    }

    function buildTraceGuidance(args, snapshot) {
        const activeFilter = {
            urlPattern: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
            method: typeof args.method === 'string' ? args.method : undefined,
            requestId: typeof args.requestId === 'string' ? args.requestId : undefined,
        };
        const normalizedFieldRole = typeof args.fieldRole === 'string' ? args.fieldRole : 'explicit';
        const evidenceHints = [];
        const nextStepHints = [];
        const validationFocus = normalizedFieldRole === 'final-signature'
            ? 'final-write'
            : normalizedFieldRole === 'derived'
                ? 'derived-value'
                : 'request-visible-field';
        const hookObjective = normalizedFieldRole === 'final-signature'
            ? 'observe-final-write'
            : normalizedFieldRole === 'derived'
                ? 'observe-derived-value'
                : 'observe-input';
        if (activeFilter.urlPattern) {
            evidenceHints.push(`Matched requests using urlPattern "${activeFilter.urlPattern}".`);
            nextStepHints.push(`Start inspect.interceptor for "${activeFilter.urlPattern}" to confirm runtime request inputs.`);
        }
        if (activeFilter.method) {
            evidenceHints.push(`Filtered request list to HTTP method ${String(activeFilter.method).toUpperCase()}.`);
        }
        if (activeFilter.requestId) {
            evidenceHints.push(`Focused on captured requestId ${activeFilter.requestId}.`);
        }
        const firstRequest = Array.isArray(snapshot?.requests) ? snapshot.requests[0] : undefined;
        if (firstRequest?.requestId) {
            nextStepHints.push(`Inspect headers/body for requestId ${firstRequest.requestId} via inspect.network.`);
        }
        if (activeFilter.urlPattern) {
            nextStepHints.push(`Use flow.find-signature-path with "${activeFilter.urlPattern}" to rank candidate signing code.`);
        }
        return {
            activeFilter,
            validationFocus,
            hookObjective,
            evidenceHints,
            nextStepHints,
        };
    }

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

    function buildTraceHookCandidates(topCandidate, args) {
        const normalizedTargetField = typeof args?.targetField === 'string' ? args.targetField.trim().toLowerCase() : '';
        const candidates = [];
        const seen = new Set();
        const pushCandidate = (candidate) => {
            if (!candidate || typeof candidate !== 'object') {
                return;
            }
            const key = JSON.stringify([candidate.target?.type, candidate.target?.object, candidate.target?.property, candidate.target?.name]);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            candidates.push(candidate);
        };
        const finalWriteBoost = ((topCandidate?.fieldWriteHints || []).length || 0) > 0 ? 0.18 : 0;
        for (const objectPath of topCandidate?.objectPaths || []) {
            const target = deriveObjectMethodTarget(objectPath);
            if (!target) {
                continue;
            }
            pushCandidate({
                target,
                score: 1.02
                    + finalWriteBoost
                    + (normalizedTargetField && String(objectPath).toLowerCase().includes(normalizedTargetField) ? 0.18 : 0),
                reasoning: ['request-trace-object-path', 'runtime-call-surface'],
                verification: ['inspect.function-trace', 'inspect.interceptor'],
            });
        }
        for (const rankedFunction of topCandidate?.rankedFunctions || []) {
            if (typeof rankedFunction?.name !== 'string' || rankedFunction.name.length === 0) {
                continue;
            }
            pushCandidate({
                target: {
                    type: 'function',
                    name: rankedFunction.name,
                },
                score: 0.72
                    + finalWriteBoost
                    + (normalizedTargetField && String(rankedFunction.name).toLowerCase().includes(normalizedTargetField) ? 0.08 : 0),
                reasoning: ['request-trace-ranked-function'],
                verification: ['inspect.function-trace', 'debug.breakpoint'],
            });
        }
        if (typeof args?.urlPattern === 'string' && args.urlPattern.trim().length > 0) {
            pushCandidate({
                target: {
                    type: 'api',
                    name: 'fetch',
                },
                score: 0.4,
                reasoning: ['request-trace-api-fallback'],
                verification: ['inspect.interceptor'],
            });
        }
        return candidates
            .slice()
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
            .slice(0, 5);
    }

    function buildHookCandidates(hookContext, args) {
        const preferredTypes = Array.isArray(args?.preferredHookTypes)
            ? args.preferredHookTypes.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : [];
        const normalizedTargetField = typeof args?.targetField === 'string' ? args.targetField.trim().toLowerCase() : '';
        const candidates = [];
        const seen = new Set();
        const isNoisyObjectPath = (objectPath) => /^(window|globalThis|self)\.(navigator|document|location|chrome|history|localStorage|sessionStorage|performance|JSON|Math|console)\b/.test(String(objectPath || ''));
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
        const collectEvidencePayloads = (entry) => {
            if (!entry?.data || typeof entry.data !== 'object') {
                return [];
            }
            return Array.isArray(entry.data) ? entry.data : [entry.data];
        };
        const collectObjectPaths = (payload) => {
            const values = [];
            const pushValue = (value) => {
                if (typeof value === 'string' && value.trim().length > 0) {
                    values.push(value.trim());
                }
            };
            for (const objectPath of Array.isArray(payload?.candidateObjectPaths) ? payload.candidateObjectPaths : []) {
                pushValue(objectPath);
            }
            for (const objectPath of Array.isArray(payload?.objectPaths) ? payload.objectPaths : []) {
                pushValue(objectPath);
            }
            const selectedTarget = payload?.selectedCandidate?.target;
            if (selectedTarget?.type === 'object-method' && typeof selectedTarget.object === 'string' && typeof selectedTarget.property === 'string') {
                pushValue(`${selectedTarget.object}.${selectedTarget.property}`);
            }
            return Array.from(new Set(values));
        };
        const collectFunctionNames = (payload) => {
            const values = [];
            const pushValue = (value) => {
                if (typeof value === 'string' && value.trim().length > 0) {
                    values.push(value.trim());
                }
            };
            for (const candidate of Array.isArray(payload?.candidateFunctions) ? payload.candidateFunctions : []) {
                pushValue(candidate?.name);
            }
            for (const rankedFunction of Array.isArray(payload?.rankedFunctions) ? payload.rankedFunctions : []) {
                pushValue(rankedFunction?.name);
            }
            const selectedTarget = payload?.selectedCandidate?.target;
            if (selectedTarget?.type === 'function') {
                pushValue(selectedTarget.name);
            }
            else if (selectedTarget?.type === 'object-method') {
                pushValue(selectedTarget.property);
            }
            return Array.from(new Set(values));
        };
        const collectRecommendedTargets = (payload) => {
            const values = [];
            for (const candidate of Array.isArray(payload?.recommendedHookCandidates) ? payload.recommendedHookCandidates : []) {
                if (candidate?.target && typeof candidate.target === 'object') {
                    values.push(candidate.target);
                }
            }
            return values;
        };
        for (const candidate of Array.isArray(args?.candidates) ? args.candidates : []) {
            pushCandidate(candidate);
        }
        for (const entry of Array.isArray(hookContext?.sourceEvidence) ? hookContext.sourceEvidence : []) {
            const evidenceBoost = entry?.kind === 'request-trace'
                ? 0.42
                : entry?.kind === 'signature-path'
                    ? 0.34
                    : 0.24;
            for (const payload of collectEvidencePayloads(entry)) {
                const finalWriteBoost = ((payload?.finalWriteHints || []).length || (payload?.fieldWriteHints || []).length || 0) > 0 ? 0.18 : 0;
                for (const objectPath of collectObjectPaths(payload)) {
                    if (isNoisyObjectPath(objectPath)) {
                        continue;
                    }
                    const target = deriveObjectMethodTarget(objectPath);
                    if (!target) {
                        continue;
                    }
                    pushCandidate({
                        target,
                        score: 1.02
                            + evidenceBoost
                            + finalWriteBoost
                            + (normalizedTargetField && String(objectPath).toLowerCase().includes(normalizedTargetField) ? 0.18 : 0),
                        reasoning: ['source-evidence-object-path', `evidence:${entry.kind || 'unknown'}`],
                        verification: ['inspect.function-trace', 'inspect.interceptor'],
                    });
                }
                for (const functionName of collectFunctionNames(payload)) {
                    pushCandidate({
                        target: {
                            type: 'function',
                            name: functionName,
                        },
                        score: 0.82
                            + evidenceBoost
                            + finalWriteBoost
                            + (normalizedTargetField && String(functionName).toLowerCase().includes(normalizedTargetField) ? 0.08 : 0),
                        reasoning: ['source-evidence-function', `evidence:${entry.kind || 'unknown'}`],
                        verification: ['inspect.function-trace', 'debug.breakpoint'],
                    });
                }
                for (const target of collectRecommendedTargets(payload)) {
                    const targetName = target?.type === 'object-method'
                        ? `${target.object}.${target.property}`
                        : target?.name;
                    pushCandidate({
                        target,
                        score: 1.08
                            + evidenceBoost
                            + finalWriteBoost
                            + (normalizedTargetField && String(targetName || '').toLowerCase().includes(normalizedTargetField) ? 0.12 : 0),
                        reasoning: ['source-evidence-hook-candidate', `evidence:${entry.kind || 'unknown'}`],
                        verification: target?.type === 'api'
                            ? ['inspect.interceptor']
                            : ['inspect.function-trace', 'inspect.interceptor'],
                    });
                }
            }
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

    function resolveInjectStrategy(requestedStrategy, generated) {
        if (requestedStrategy === 'pre-init') {
            return { injectStrategy: 'pre-init', onNewDocument: true, code: String(generated?.generatedCode || '') };
        }
        if (requestedStrategy === 'runtime') {
            return { injectStrategy: 'runtime', onNewDocument: false, code: String(generated?.generatedCode || '') };
        }
        if (requestedStrategy === 'delayed') {
            return { injectStrategy: 'delayed', onNewDocument: false, code: `setTimeout(() => { ${String(generated?.generatedCode || '')} }, 0);` };
        }
        if (generated?.injectionMethod === 'evaluateOnNewDocument') {
            return { injectStrategy: 'pre-init', onNewDocument: true, code: String(generated?.generatedCode || '') };
        }
        return { injectStrategy: 'runtime', onNewDocument: false, code: String(generated?.generatedCode || '') };
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

    function safeParseJsonBody(text) {
        if (typeof text !== 'string' || text.trim().length === 0) {
            return null;
        }
        try {
            return JSON.parse(text);
        }
        catch {
            return null;
        }
    }

    function buildHookValidationSummary(records, targetField) {
        const normalizedTarget = typeof targetField === 'string' ? targetField.trim() : '';
        if (!normalizedTarget) {
            return {
                targetFieldObserved: false,
                bestHitSummary: null,
            };
        }
        let targetFieldObserved = false;
        let bestHitSummary = null;
        for (const record of Array.isArray(records) ? records : []) {
            const matchedPaths = collectTargetFieldPaths(record, normalizedTarget);
            if (matchedPaths.length === 0) {
                continue;
            }
            targetFieldObserved = true;
            if (!bestHitSummary) {
                bestHitSummary = {
                    matchedField: normalizedTarget,
                    matchedPaths: matchedPaths.slice(0, 5),
                };
            }
        }
        return {
            targetFieldObserved,
            bestHitSummary,
        };
    }

    async function readHookRuntimeRecords(session, hookId) {
        return session.engine.inspectRuntime(`(() => {
          const hookId = ${JSON.stringify(String(hookId || ''))};
          if (!window.__aiHooks || !window.__aiHooks[hookId]) {
            return { totalRecords: 0, records: [] };
          }
          return {
            totalRecords: window.__aiHooks[hookId].length,
            records: window.__aiHooks[hookId],
          };
        })()`);
    }

    async function validateInjectedHookCandidate(runtime, session, generated, args, strategy) {
        await session.engine.injectHook(strategy.code, {
            onNewDocument: strategy.onNewDocument,
        });
        await runtime.sessions.refreshSnapshot(session);
        if (typeof args.validationExpression !== 'string' || args.validationExpression.trim().length === 0 || !generated?.hookId) {
            return {
                status: 'pending-runtime-validation',
                injectStrategy: strategy.injectStrategy,
                selectedTargetType: generated?.target?.type,
            };
        }
        await session.engine.inspectRuntime(String(args.validationExpression));
        const hookPayload = await readHookRuntimeRecords(session, generated.hookId);
        const totalRecords = Number(hookPayload?.totalRecords || 0);
        const fieldSummary = buildHookValidationSummary(hookPayload?.records, args.targetField);
        let validationEvidenceId;
        if (totalRecords > 0) {
            const rerankHint = fieldSummary.targetFieldObserved
                ? 'promote-candidate'
                : 'keep-candidate';
            const validationEvidence = runtime.evidence.create('hook-data', 'Auto-validated hook data captured', {
                hookId: generated.hookId,
                metadata: {
                    hookId: generated.hookId,
                    target: generated?.target,
                    strategy: generated?.strategy,
                    injectStrategy: strategy.injectStrategy,
                    selectedTargetType: generated?.target?.type,
                },
                summary: {
                    totalRecords,
                    hasRecords: totalRecords > 0,
                    targetField: typeof args.targetField === 'string' ? args.targetField.trim() : undefined,
                    targetFieldObserved: fieldSummary.targetFieldObserved === true,
                    bestHitSummary: fieldSummary.bestHitSummary || null,
                    rerankHint,
                },
            }, session.sessionId);
            validationEvidenceId = validationEvidence.id;
        }
        if (totalRecords === 0) {
            return {
                status: 'no-hit',
                injectStrategy: strategy.injectStrategy,
                selectedTargetType: generated?.target?.type,
                totalRecords,
                validationEvidenceId,
            };
        }
        if (fieldSummary.targetFieldObserved) {
            return {
                status: 'observed-target-field',
                injectStrategy: strategy.injectStrategy,
                selectedTargetType: generated?.target?.type,
                totalRecords,
                bestHitSummary: fieldSummary.bestHitSummary,
                validationEvidenceId,
            };
        }
        return {
            status: 'observed-hook',
            injectStrategy: strategy.injectStrategy,
            selectedTargetType: generated?.target?.type,
            totalRecords,
            validationEvidenceId,
        };
    }

    async function buildTraceCorrelation(session, runtime, args, snapshot) {
        const diagnostics = [];
        const status = await session.engine.getStatus().catch(() => undefined);
        let scripts = [];
        try {
            scripts = await hydrateScriptInventory(session, {
                includeSource: true,
                indexPolicy: 'deep',
                maxScripts: 40,
                currentUrl: status?.currentUrl,
            });
        }
        catch (error) {
            diagnostics.push(buildToolDiagnostic('flow.trace-request', error, { stage: 'hydrate-scripts' }));
        }
        const keywords = [args.urlPattern, args.targetField, args.method, 'sign', 'signature', 'token', 'nonce', 'timestamp']
            .filter((value) => typeof value === 'string' && value.trim().length > 0);
        const rawCandidates = (scripts || [])
            .filter((script) => script?.source)
            .map((script) => collectSignatureCandidate(script, keywords, runtime, diagnostics, {
            targetField: args.targetField,
            fieldRole: args.fieldRole,
        }))
            .filter(Boolean)
            .sort((left, right) => scoreSignatureCandidate(right, args.urlPattern, {
            targetField: args.targetField,
            fieldRole: args.fieldRole,
        }) - scoreSignatureCandidate(left, args.urlPattern, {
            targetField: args.targetField,
            fieldRole: args.fieldRole,
        }));
        const topCandidate = rawCandidates[0];
        const candidateScripts = rawCandidates.slice(0, 3).map((candidate) => ({
            scriptId: candidate.scriptId,
            url: candidate.url,
            score: scoreSignatureCandidate(candidate, args.urlPattern, {
                targetField: args.targetField,
                fieldRole: args.fieldRole,
            }),
        }));
        const candidateFunctions = (topCandidate?.rankedFunctions || []).slice(0, 5).map((rankedFunction) => ({
            name: rankedFunction.name,
            line: rankedFunction.line,
            score: rankedFunction.score,
            reasons: rankedFunction.reasons,
        }));
        const candidateObjectPaths = (topCandidate?.objectPaths || []).slice(0, 5);
        const payloadAssemblyHints = [];
        const firstRequest = Array.isArray(snapshot?.requests) ? snapshot.requests[0] : undefined;
        const parsedRequestBody = safeParseJsonBody(firstRequest?.postData);
        if (firstRequest?.postData) {
            payloadAssemblyHints.push({
                source: 'request-body',
                preview: String(firstRequest.postData).slice(0, 200),
            });
        }
        for (const hit of topCandidate?.keywordHits || []) {
            payloadAssemblyHints.push({
                source: 'script-keyword-hit',
                keyword: hit.keyword,
                lineNumber: hit.displayLineNumber,
            });
        }
        const finalWriteHints = (topCandidate?.fieldWriteHints || []).map((hint) => ({
            field: hint.field,
            lineNumber: hint.displayLineNumber,
            snippet: hint.snippet,
        }));
        const finalPayloadHints = [];
        if (parsedRequestBody && typeof args.targetField === 'string' && args.targetField.trim().length > 0) {
            const matchedPaths = collectTargetFieldPaths(parsedRequestBody, args.targetField.trim());
            if (matchedPaths.length > 0) {
                finalPayloadHints.push({
                    field: args.targetField.trim(),
                    matchedPaths: matchedPaths.slice(0, 10),
                    preview: JSON.stringify(parsedRequestBody).slice(0, 200),
                });
            }
        }
        let recommendedActions = buildTraceRecommendedActions(args, snapshot);
        if (topCandidate?.objectPaths?.[0] || topCandidate?.rankedFunctions?.[0]?.name) {
            recommendedActions.push({
                tool: 'inspect.function-trace',
                action: 'start',
                functionName: topCandidate?.objectPaths?.[0]
                    ? String(topCandidate.objectPaths[0]).replace(/^window\./, '')
                    : topCandidate.rankedFunctions[0].name,
                reason: 'Trace the most likely runtime function involved in this request path.',
            });
        }
        if (hasCommonLibraryNoise(scripts) && ['derived', 'final-signature'].includes(String(args.fieldRole || ''))) {
            recommendedActions.push({
                tool: 'debug.blackbox',
                action: 'addCommon',
                reason: 'Blackbox common libraries before stepping through noisy request-related stacks.',
            });
        }
        const recommendedHookCandidates = buildTraceHookCandidates(topCandidate, args);
        recommendedActions = reorderActions(ensurePreferredValidationActions(recommendedActions, args.preferredValidation), args.preferredValidation, args.fieldRole);
        return {
            candidateScripts,
            candidateFunctions,
            candidateObjectPaths,
            payloadAssemblyHints,
            finalWriteHints,
            finalPayloadHints,
            recommendedHookCandidates,
            recommendedActions,
            diagnostics,
        };
    }

    function buildCompactTracePayload(tracePayload) {
        return {
            requests: compactPayload(tracePayload.requests || []),
            stats: tracePayload.stats,
            exceptions: compactPayload(tracePayload.exceptions || []),
            candidateScripts: compactPayload(tracePayload.candidateScripts || []),
            candidateFunctions: compactPayload(tracePayload.candidateFunctions || []),
            candidateObjectPaths: Array.isArray(tracePayload.candidateObjectPaths)
                ? tracePayload.candidateObjectPaths.slice(0, 5)
                : tracePayload.candidateObjectPaths,
            payloadAssemblyHints: compactPayload(tracePayload.payloadAssemblyHints || []),
            finalWriteHints: compactPayload(tracePayload.finalWriteHints || []),
            finalPayloadHints: compactPayload(tracePayload.finalPayloadHints || []),
            recommendedHookCandidates: compactPayload(tracePayload.recommendedHookCandidates || []),
            recommendedActions: compactPayload(tracePayload.recommendedActions || []),
            guidance: {
                activeFilter: tracePayload.guidance?.activeFilter,
                validationFocus: tracePayload.guidance?.validationFocus,
                hookObjective: tracePayload.guidance?.hookObjective,
                nextStepHints: Array.isArray(tracePayload.guidance?.nextStepHints)
                    ? tracePayload.guidance.nextStepHints.slice(0, 5)
                    : tracePayload.guidance?.nextStepHints,
            },
        };
    }

    async function buildWorkflowSummaries(session, runtime) {
        const evidence = runtime.evidence.listBySession(session.sessionId);
        const requestTraceEvidence = evidence.filter((item) => item.kind === 'request-trace');
        const hookDataEvidence = evidence.filter((item) => item.kind === 'hook-data');
        const hookTemplateEvidence = evidence.filter((item) => item.kind === 'hook-template' || item.kind === 'flow-generate-hook');
        const signatureEvidence = evidence.filter((item) => item.kind === 'signature-path');
        const requestCorrelationSummary = {
            traceCount: requestTraceEvidence.length,
            candidateScriptCount: requestTraceEvidence.reduce((sum, item) => sum + (((item.data || {}).candidateScripts || []).length || 0), 0),
        };
        const validationHitSummary = {
            hookDataCount: hookDataEvidence.length,
            targetFieldHitCount: hookDataEvidence.filter((item) => item.data?.summary?.targetFieldObserved === true).length,
        };
        const hookCompetitionSummary = {
            hookGenerationCount: hookTemplateEvidence.length,
            selectedCandidateCount: hookTemplateEvidence.filter((item) => item.data?.selectedCandidate || item.data?.generated).length,
        };
        const rerankResultSummary = {
            promoteCount: hookDataEvidence.filter((item) => item.data?.summary?.rerankHint === 'promote-candidate').length,
            keepCount: hookDataEvidence.filter((item) => item.data?.summary?.rerankHint === 'keep-candidate').length,
            needsMoreEvidenceCount: hookDataEvidence.filter((item) => item.data?.summary?.rerankHint === 'needs-more-evidence').length,
        };
        const finalWriteHypothesisSummary = {
            candidateCount: signatureEvidence.reduce((sum, item) => sum + (Array.isArray(item.data) ? item.data.length : 0), 0),
            fieldWriteHitCount: signatureEvidence.reduce((sum, item) => sum + (Array.isArray(item.data)
                ? item.data.reduce((inner, candidate) => inner + ((candidate?.fieldWriteHints || []).length || 0), 0)
                : 0), 0),
        };
        return {
            requestCorrelationSummary,
            validationHitSummary,
            hookCompetitionSummary,
            rerankResultSummary,
            finalWriteHypothesisSummary,
        };
    }

    function resolveSourceEvidence(runtime, sourceEvidenceIds) {
        if (!Array.isArray(sourceEvidenceIds)) {
            return [];
        }
        return sourceEvidenceIds
            .map((evidenceId) => typeof evidenceId === 'string' ? runtime.evidence.get(evidenceId) : undefined)
            .filter(Boolean)
            .map((record) => ({
            evidenceId: record.id,
            kind: record.kind,
            summary: record.summary,
            data: record.data,
        }));
    }

    function buildHookRecommendedActions(hookContext, sourceEvidence) {
        const actions = [];
        const seen = new Set();
        for (const entry of sourceEvidence) {
            const payload = entry?.data;
            if (payload && typeof payload === 'object') {
                const candidates = Array.isArray(payload) ? payload : [payload];
                for (const candidate of candidates) {
                    const candidateActions = [];
                    if (candidate?.preferredAction && typeof candidate.preferredAction === 'object') {
                        candidateActions.push(candidate.preferredAction);
                    }
                    if (Array.isArray(candidate?.recommendedActions) && candidate.recommendedActions.length > 0) {
                        candidateActions.push(...candidate.recommendedActions);
                    }
                    const prioritized = candidateActions
                        .filter((action) => action?.tool === 'inspect.function-trace' || action?.tool === 'inspect.interceptor')
                        .concat(candidateActions.filter((action) => action?.tool !== 'inspect.function-trace' && action?.tool !== 'inspect.interceptor'));
                    for (const action of prioritized.slice(0, 3)) {
                        pushUniqueAction(actions, seen, {
                            ...action,
                            reason: action?.reason || `Validate the generated hook against evidence ${entry.evidenceId}.`,
                        });
                    }
                }
            }
        }
        if (actions.length > 0) {
            return actions;
        }
        const firstCandidate = Array.isArray(hookContext?.signatureCandidates) ? hookContext.signatureCandidates[0] : undefined;
        const traceTarget = firstCandidate?.objectPaths?.[0]
            ? String(firstCandidate.objectPaths[0]).replace(/^window\./, '')
            : firstCandidate?.rankedFunctions?.[0]?.name;
        if (traceTarget) {
            pushUniqueAction(actions, seen, {
                tool: 'inspect.function-trace',
                action: 'start',
                functionName: traceTarget,
                captureArgs: true,
                captureReturn: true,
                reason: 'Trace the most likely runtime signing function before trusting the generated hook.',
            });
        }
        if (firstCandidate?.objectPaths?.[0]) {
            pushUniqueAction(actions, seen, {
                tool: 'debug.watch',
                action: 'add',
                expression: firstCandidate.objectPaths[0],
                reason: 'Watch the most likely runtime object path while exercising the generated hook.',
            });
        }
        if (firstCandidate?.url && Array.isArray(firstCandidate?.rankedFunctions) && firstCandidate.rankedFunctions[0]?.line > 0) {
            pushUniqueAction(actions, seen, {
                tool: 'debug.breakpoint',
                action: 'set',
                url: firstCandidate.url,
                lineNumber: Math.max(0, Number(firstCandidate.rankedFunctions[0].line) - 1),
                functionName: firstCandidate.rankedFunctions[0].name,
                reason: 'Pause near the highest-ranked function before trusting the generated hook.',
                });
        }
        return actions;
    }

    return [
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
                    enum: ['auto', 'playwright'],
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
            targetField: {
                type: 'string',
            },
            fieldRole: {
                type: 'string',
                enum: ['explicit', 'derived', 'final-signature'],
            },
            preferredValidation: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
        }),
        createHandler(runtime) {
            return async (args) => {
                const session = getSession(runtime, args.sessionId);
                if (!session) {
                    return errorResponse('Session not found', new Error('Unknown sessionId'));
                }
                const keywords = [args.requestPattern, args.targetField, 'sign', 'signature', 'token', 'nonce', 'timestamp']
                    .filter((value) => typeof value === 'string' && value.length > 0);
                const normalizedPrimaryKeyword = typeof args.requestPattern === 'string'
                    ? args.requestPattern.trim().toLowerCase()
                    : '';
                const normalizedTargetField = typeof args.targetField === 'string'
                    ? args.targetField.trim().toLowerCase()
                    : '';
                const exceptionRecords = [
                    ...(session.consoleMonitor?.getExceptions?.({ limit: 50 }) || []),
                    ...buildPausedStateExceptionRecords(session.debuggerManager?.getPausedState?.()),
                ];
                const exceptionHints = collectExceptionPauseHints(exceptionRecords, args.requestPattern);
                const diagnostics = [];
                let scripts = [];
                let allScriptsForNoise = [];
                try {
                    allScriptsForNoise = await session.engine.getScripts({
                        includeSource: false,
                        maxScripts: 250,
                    });
                }
                catch (error) {
                    diagnostics.push(buildToolDiagnostic('flow.find-signature-path', error, { stage: 'noise-scan' }));
                }
                if (normalizedPrimaryKeyword) {
                    const targetedSearch = await progressivelySearchScriptSources(runtime, session, {
                        keyword: args.requestPattern,
                        searchMode: 'substring',
                        maxResults: 10,
                        maxBytes: 20 * 1024 * 1024,
                        indexPolicy: 'deep',
                    });
                    const hitsByScriptId = new Map();
                    for (const match of targetedSearch.matches || []) {
                        if (!match?.scriptId) {
                            continue;
                        }
                        if (!hitsByScriptId.has(match.scriptId)) {
                            hitsByScriptId.set(match.scriptId, []);
                        }
                        hitsByScriptId.get(match.scriptId).push(match);
                    }
                    const matchedScriptIds = Array.from(new Set((targetedSearch.matches || [])
                        .map((match) => match?.scriptId)
                        .filter((scriptId) => typeof scriptId === 'string'))).slice(0, 6);
                    for (const scriptId of matchedScriptIds) {
                        try {
                            const sourcePayload = await resolveScriptSource(session, { scriptId });
                            if (sourcePayload?.source) {
                                scripts.push({
                                    scriptId: sourcePayload.scriptId,
                                    url: sourcePayload.scriptUrl,
                                    source: sourcePayload.source,
                                    sourceLength: sourcePayload.source.length,
                                    requestPatternHits: hitsByScriptId.get(scriptId) || [],
                                });
                            }
                        }
                        catch (error) {
                            diagnostics.push(buildToolDiagnostic('flow.find-signature-path', error, { scriptId }));
                        }
                    }
                }
                if (scripts.length === 0) {
                    scripts = await session.engine.getScripts({
                        includeSource: true,
                        maxScripts: 40,
                    });
                }
                const rawCandidates = scripts
                    .filter((script) => script.source)
                    .map((script) => collectSignatureCandidate(script, keywords, runtime, diagnostics, {
                    targetField: args.targetField,
                }))
                    .filter(Boolean);
                const exceptionDerivedCandidates = [
                    ...buildExceptionDerivedCandidates(exceptionRecords, args.requestPattern),
                    ...buildPausedStateDerivedCandidates(session.debuggerManager?.getPausedState?.(), args.requestPattern),
                ];
                const coverageBoost = getCoverageBoostMaps(runtime, session.sessionId);
                const hookBoost = getHookEvidenceBoostMaps(runtime, session.sessionId, args.targetField);
                const exactCandidates = normalizedPrimaryKeyword
                    ? [...rawCandidates, ...exceptionDerivedCandidates].filter((candidate) => (candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedPrimaryKeyword)
                        || (candidate.keywordHits || []).some((hit) => hit.keyword === normalizedPrimaryKeyword))
                    : [];
                const targetFieldCandidates = normalizedTargetField
                    ? [...rawCandidates, ...exceptionDerivedCandidates].filter((candidate) => (candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedTargetField)
                        || (candidate.keywordHits || []).some((hit) => hit.keyword === normalizedTargetField)
                        || (candidate.fieldWriteHints || []).length > 0)
                    : [];
                const candidates = ((exactCandidates.length > 0 ? exactCandidates : targetFieldCandidates.length > 0 ? targetFieldCandidates : [...rawCandidates, ...exceptionDerivedCandidates]))
                    .sort((left, right) => scoreSignatureCandidate(right, args.requestPattern, {
                    targetField: args.targetField,
                    fieldRole: args.fieldRole,
                    ...coverageBoost,
                    ...hookBoost,
                }) - scoreSignatureCandidate(left, args.requestPattern, {
                    targetField: args.targetField,
                    fieldRole: args.fieldRole,
                    ...coverageBoost,
                    ...hookBoost,
                }))
                    .slice(0, 10)
                    .map((candidate) => {
                    const suggestBlackboxCommon = hasCommonLibraryNoise(allScriptsForNoise.length > 0 ? allScriptsForNoise : scripts);
                    const observedPausedLocationHints = collectObservedPausedLocationHints(session, candidate, args.requestPattern);
                    const observedExceptionTopFrameHints = collectObservedExceptionTopFrameHints(session, candidate);
                    const exceptionStackBreakpointHints = collectExceptionStackBreakpointHints(exceptionRecords, candidate);
                    const recommendedActions = reorderActions(ensurePreferredValidationActions(buildCandidateDebugPlan(candidate, args.requestPattern, exceptionHints, observedPausedLocationHints, exceptionStackBreakpointHints, observedExceptionTopFrameHints, {
                        suggestBlackboxCommon,
                    }), args.preferredValidation), args.preferredValidation, args.fieldRole);
                    return {
                        ...candidate,
                        score: scoreSignatureCandidate(candidate, args.requestPattern, {
                            targetField: args.targetField,
                            fieldRole: args.fieldRole,
                            ...coverageBoost,
                            ...hookBoost,
                        }),
                        recommendedActions,
                        preferredAction: recommendedActions[0] || null,
                        lineNumberBase: 'zero-based',
                        targetField: typeof args.targetField === 'string' ? args.targetField : undefined,
                        fieldRole: typeof args.fieldRole === 'string' ? args.fieldRole : undefined,
                        recommendedHookDescription: typeof args.targetField === 'string' && args.targetField.length > 0
                            ? `自动追踪 ${args.targetField} 生成并捕获返回值`
                            : candidate.objectPaths?.[0]
                            ? `自动破解 ${candidate.objectPaths[0]} 加密并捕获返回值`
                            : candidate.rankedFunctions?.[0]?.name
                                ? `自动破解 ${candidate.rankedFunctions[0].name} 签名并捕获返回值`
                                : '自动破解签名加密并捕获返回值',
                    };
                });
                const evidence = runtime.evidence.create('signature-path', 'Potential signature path candidates identified', candidates, session.sessionId);
                return successResponse('Potential signature path candidates identified', candidates, {
                    sessionId: session.sessionId,
                    evidenceIds: [evidence.id],
                    diagnostics,
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
            targetField: {
                type: 'string',
            },
            fieldRole: {
                type: 'string',
                enum: ['explicit', 'derived', 'final-signature'],
            },
            preferredValidation: {
                type: 'array',
                items: {
                    type: 'string',
                },
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
                const snapshot = await session.engine.collectNetwork({
                    url: typeof args.urlPattern === 'string' ? args.urlPattern : undefined,
                    method: typeof args.method === 'string' ? args.method : undefined,
                    requestId: typeof args.requestId === 'string' ? args.requestId : undefined,
                    limit: 50,
                });
                const correlation = await buildTraceCorrelation(session, runtime, args, snapshot);
                const recommendedActions = correlation.recommendedActions;
                const guidance = buildTraceGuidance(args, snapshot);
                const tracePayload = {
                    ...snapshot,
                    candidateScripts: correlation.candidateScripts,
                    candidateFunctions: correlation.candidateFunctions,
                    candidateObjectPaths: correlation.candidateObjectPaths,
                    payloadAssemblyHints: correlation.payloadAssemblyHints,
                    finalWriteHints: correlation.finalWriteHints,
                    finalPayloadHints: correlation.finalPayloadHints,
                    recommendedHookCandidates: correlation.recommendedHookCandidates,
                    recommendedActions,
                    guidance,
                };
                const evidence = runtime.evidence.create('request-trace', 'Filtered request trace generated', tracePayload, session.sessionId);
                const payload = args.responseMode === 'compact' ? buildCompactTracePayload(tracePayload) : tracePayload;
                const externalized = maybeExternalize(runtime.artifacts, 'request-trace', 'Filtered request trace', payload, session.sessionId);
                return successResponse('Request trace generated', externalized.data, {
                    sessionId: session.sessionId,
                    artifactId: externalized.artifactId,
                    detailId: externalized.detailId,
                    evidenceIds: [evidence.id],
                    diagnostics: correlation.diagnostics,
                    nextActions: guidance.nextStepHints.length > 0
                        ? guidance.nextStepHints
                        : recommendedActions.length > 0
                            ? recommendedActions.map((item) => item.reason).filter(Boolean)
                        : ['Use flow.find-signature-path to turn this request trace into candidate code paths.'],
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
            sourceEvidenceIds: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
            targetField: {
                type: 'string',
            },
            fieldRole: {
                type: 'string',
                enum: ['explicit', 'derived', 'final-signature'],
            },
            preferredHookTypes: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
            injectStrategy: {
                type: 'string',
                enum: ['pre-init', 'runtime', 'delayed', 'auto'],
            },
            validationExpression: {
                type: 'string',
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
                const sourceEvidence = resolveSourceEvidence(runtime, args.sourceEvidenceIds);
                const hookContext = await buildHookContext(runtime, session, String(args.description), {
                    targetField: args.targetField,
                    fieldRole: args.fieldRole,
                });
                hookContext.sourceEvidence = sourceEvidence;
                const candidates = buildHookCandidates(hookContext, args);
                const candidateScores = candidates.map((candidate) => ({
                    target: candidate.target,
                    score: candidate.score,
                }));
                const attempts = [];
                let generated = null;
                let selectedCandidate = null;
                const validationEvidenceIds = [];
                let hitValidationResult = {
                    status: 'pending-runtime-validation',
                    injectStrategy: 'runtime',
                    selectedTargetType: undefined,
                };
                const hasExplicitCompetitionInputs = (typeof args.target === 'object' && args.target)
                    || (Array.isArray(args.candidates) && args.candidates.length > 0);
                const shouldRunCompetition = hasExplicitCompetitionInputs
                    || (args.autoInject === true
                        && candidates.length > 1
                        && (Array.isArray(args.sourceEvidenceIds) && args.sourceEvidenceIds.length > 0
                            || ['derived', 'final-signature'].includes(String(args.fieldRole || ''))));
                if (shouldRunCompetition) {
                    for (const candidate of (typeof args.target === 'object' && args.target
                        ? [{ target: args.target, score: 1, reasoning: ['explicit-target'], verification: ['inspect.function-trace'] }, ...candidates]
                        : candidates)) {
                        const attempt = await session.aiHookGenerator.generateHook({
                            description: String(args.description),
                            target: candidate.target,
                            explicitTarget: true,
                            behavior: args.behavior,
                            condition: args.condition,
                            context: hookContext,
                            sessionId: session.sessionId,
                        });
                        const attemptRecord = {
                            target: candidate.target,
                            success: attempt.success === true,
                            hookId: attempt.hookId,
                        };
                        attempts.push(attemptRecord);
                        if (attempt.success !== true) {
                            continue;
                        }
                        if (args.autoInject === true) {
                            const attemptStrategy = resolveInjectStrategy(typeof args.injectStrategy === 'string' ? args.injectStrategy : 'auto', attempt);
                            const validation = await validateInjectedHookCandidate(runtime, session, attempt, args, attemptStrategy);
                            attemptRecord.validationStatus = validation.status;
                            if (typeof validation.validationEvidenceId === 'string') {
                                validationEvidenceIds.push(validation.validationEvidenceId);
                            }
                            if (validation.status === 'observed-target-field' || validation.status === 'observed-hook' || typeof args.validationExpression !== 'string') {
                                hitValidationResult = validation;
                                generated = attempt;
                                selectedCandidate = candidate;
                                break;
                            }
                            continue;
                        }
                        generated = attempt;
                        selectedCandidate = candidate;
                        break;
                    }
                }
                if (!generated) {
                    generated = await session.aiHookGenerator.generateHook({
                        description: String(args.description),
                        target: args.target,
                        explicitTarget: typeof args.target === 'object' && args.target ? true : false,
                        behavior: args.behavior,
                        condition: args.condition,
                        context: hookContext,
                        sessionId: session.sessionId,
                    });
                    if (!selectedCandidate) {
                        selectedCandidate = candidates.find((candidate) => JSON.stringify(candidate.target) === JSON.stringify(generated?.target)) || candidates[0] || null;
                    }
                }
                const resolvedInjectStrategy = resolveInjectStrategy(typeof args.injectStrategy === 'string' ? args.injectStrategy : 'auto', generated);
                if (args.autoInject === true && generated.success && !attempts.some((attempt) => attempt.hookId === generated.hookId && typeof attempt.validationStatus === 'string')) {
                    hitValidationResult = await validateInjectedHookCandidate(runtime, session, generated, args, resolvedInjectStrategy);
                    if (typeof hitValidationResult.validationEvidenceId === 'string') {
                        validationEvidenceIds.push(hitValidationResult.validationEvidenceId);
                    }
                }
                const recommendedActions = buildHookRecommendedActions(hookContext, sourceEvidence);
                const rejectedCandidates = candidates.filter((candidate) => JSON.stringify(candidate.target) !== JSON.stringify(selectedCandidate?.target));
                const fallbackAttempts = attempts.filter((attempt) => selectedCandidate
                    ? JSON.stringify(attempt.target) !== JSON.stringify(selectedCandidate.target)
                    : true);
                await runtime.storage.recordHookEvent(session.sessionId, {
                    hookId: generated.hookId,
                    eventType: generated.success ? 'flow-hook-generated' : 'flow-hook-failed',
                    summary: generated.strategy?.explanation || String(args.description),
                    payload: {
                        generated,
                        selectedCandidate,
                        candidateScores,
                        rejectedCandidates,
                        fallbackAttempts,
                        hitValidationResult,
                        validationEvidenceIds,
                    },
                    createdAt: Date.now(),
                });
                const evidence = runtime.evidence.create('flow-generate-hook', 'Flow hook generation completed', {
                    generated,
                    selectedCandidate,
                    candidateScores,
                    rejectedCandidates,
                    fallbackAttempts,
                    hitValidationResult,
                    validationEvidenceIds,
                    autoInjected: args.autoInject === true && generated.success,
                    sourceEvidenceIds: Array.isArray(args.sourceEvidenceIds) ? args.sourceEvidenceIds : [],
                    recommendedActions,
                }, session.sessionId);
                return successResponse('Flow hook generation completed', {
                    generated,
                    selectedCandidate,
                    candidateScores,
                    rejectedCandidates,
                    fallbackAttempts,
                    hitValidationResult,
                    validationEvidenceIds,
                    autoInjected: args.autoInject === true && generated.success,
                    sourceEvidenceIds: Array.isArray(args.sourceEvidenceIds) ? args.sourceEvidenceIds : [],
                    recommendedActions,
                }, {
                    sessionId: session.sessionId,
                    evidenceIds: [evidence.id, ...validationEvidenceIds],
                    nextActions: recommendedActions.length > 0
                        ? recommendedActions.map((item) => item.reason).filter(Boolean)
                        : ['Use hook.data after exercising the page to inspect captured records.'],
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
                const fingerprintSummary = await resolveReportFingerprintCandidates(session, runtime);
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
                    fingerprints: fingerprintSummary.fingerprints,
                    debugPlan: buildReportDebugPlan(fingerprintSummary.fingerprints),
                    ...(await buildWorkflowSummaries(session, runtime)),
                };
                const artifact = runtime.artifacts.create('reverse-report', 'Structured reverse report', report, session.sessionId);
                return successResponse('Structured reverse report generated', report, {
                    sessionId: session.sessionId,
                    artifactId: artifact.id,
                    detailId: artifact.id,
                    diagnostics: fingerprintSummary.diagnostics,
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
                const status = buildStatusPayload(session, await session.engine.getStatus());
                return successResponse('Session summary loaded', {
                    session: {
                        sessionId: session.sessionId,
                        engine: session.engineType,
                        createdAt: session.createdAt,
                        lastActivityAt: session.lastActivityAt,
                        health: status.health,
                        recoverable: status.recoverable,
                        recoveryCount: session.recoveryCount || 0,
                        lastFailure: status.lastFailure,
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
                    nextActions: buildRecoveryNextActions(session.sessionId, status).concat([
                        'Use flow.reverse-report for a consolidated snapshot or browser.navigate to continue exploration.',
                    ]),
                });
            };
        },
    },
    ];
}
