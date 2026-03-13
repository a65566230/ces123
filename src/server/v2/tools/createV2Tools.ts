// @ts-nocheck

import { compactPayload, errorResponse, maybeExternalize, successResponse } from '../response.js';
import { paginateItems } from '../pagination.js';
import { LLMService } from '../../../services/LLMService.js';
import { CodeAnalyzer } from '../../../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../../../modules/crypto/CryptoDetector.js';
import { ObfuscationAnalysisService } from '../analysis/ObfuscationAnalysisService.js';
import { buildToolBlueprints } from './toolBlueprints.js';
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
    if (session.autoEngine === true && session.engineType !== 'playwright' && ['script-search', 'script-source', 'function-tree', 'debugger'].includes(capability)) {
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
    const mergedHealth = typeof status?.health === 'string' && status.health !== 'ready'
        ? status.health
        : session.health;
    const mergedRecoverable = typeof status?.recoverable === 'boolean'
        ? status.recoverable
        : session.recoverable;
    const mergedLastFailure = status?.lastFailure || session.lastFailure;
    return {
        ...status,
        health: mergedHealth,
        recoverable: mergedRecoverable,
        recoveryCount: session.recoveryCount || 0,
        lastFailure: mergedLastFailure,
        engineCapabilities: session.engineCapabilities,
        siteProfile: session.siteProfile || session.scriptInventory.getSiteProfile(status?.currentUrl),
        engineSelectionReason: session.engineSelectionReason,
    };
}
function buildRecoveryNextActions(sessionId, status) {
    if (!sessionId) {
        return [];
    }
    if (status?.health === 'degraded' && status?.recoverable === true) {
        return [
            `Use browser.recover(sessionId: "${sessionId}") to rebuild the Playwright session from the latest snapshot.`,
            'Inspect browser.status after recovery before resuming the workflow.',
        ];
    }
    if (status?.health === 'closed') {
        return [
            `Launch a fresh browser session or use browser.recover(sessionId: "${sessionId}") if recovery is still possible.`,
        ];
    }
    return [];
}
function enforceRateLimit(runtime, sessionId, toolName) {
    const result = runtime.toolRateLimiter.check(`${sessionId || 'global'}:${toolName}`);
    if (!result.allowed) {
        throw new Error(`rate limit exceeded for ${toolName}; retry after ${result.resetInMs}ms`);
    }
}
async function buildHookContext(runtime, session, description, options = {}) {
    const scripts = await hydrateScriptInventory(session, {
        includeSource: true,
        indexPolicy: 'deep',
        maxScripts: 40,
    });
    const diagnostics = [];
    const signatureCandidates = scripts
        .filter((script) => script.source)
        .map((script) => collectSignatureCandidate(script, [options?.targetField, 'sign', 'signature', 'token', 'nonce', 'timestamp'], runtime, diagnostics, {
        targetField: options?.targetField,
        fieldRole: options?.fieldRole,
    }))
        .filter(Boolean)
        .slice(0, 10);
    return {
        description,
        targetField: options?.targetField,
        fieldRole: options?.fieldRole,
        signatureCandidates,
        siteProfile: session.siteProfile,
        diagnostics,
    };
}
async function hydrateScriptInventory(session, options = {}) {
    const includeSource = options.includeSource === true;
    const indexPolicy = options.indexPolicy || (includeSource ? 'deep' : 'metadata-only');
    const maxScripts = typeof options.maxScripts === 'number' ? options.maxScripts : 250;
    const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : 512 * 1024;
    if (includeSource && session.scriptManager) {
        const metadataScripts = await session.engine.getScripts({
            includeSource: false,
            maxScripts,
        });
        session.scriptInventory.recordScripts(metadataScripts, {
            indexPolicy: 'metadata-only',
        });
        const selectedScripts = trimScriptsForSourceLoading(metadataScripts, maxBytes);
        const loadedScripts = [];
        for (const script of selectedScripts) {
            try {
                const resolved = await session.scriptManager.getScriptSource(script.scriptId, script.url);
                if (resolved?.source) {
                    loadedScripts.push({
                        scriptId: resolved.scriptId,
                        url: resolved.url,
                        source: resolved.source,
                        sourceLength: resolved.sourceLength,
                    });
                }
            }
            catch (_error) {
                // Individual large-script failures must not abort the whole search batch.
            }
        }
        if (loadedScripts.length > 0) {
            session.scriptInventory.recordScripts(loadedScripts, {
                indexPolicy,
            });
        }
    }
    else {
        const scripts = await session.engine.getScripts({
            includeSource,
            maxScripts,
        });
        session.scriptInventory.recordScripts(scripts, {
            indexPolicy,
        });
    }
    session.siteProfile = session.scriptInventory.getSiteProfile(options.currentUrl);
    return session.scriptInventory.list({
        includeSource,
        maxScripts,
    });
}
function findScriptMetadataMatches(scripts, keyword, maxResults = 20) {
    const normalized = String(keyword || '').toLowerCase().trim();
    if (!normalized) {
        return [];
    }
    return scripts
        .filter((script) => String(script.url || '').toLowerCase().includes(normalized) || String(script.scriptId || '').toLowerCase().includes(normalized))
        .slice(0, maxResults)
        .map((script) => ({
        scriptId: script.scriptId,
        url: script.url,
        chunkRef: undefined,
        chunkIndex: undefined,
        context: `metadata match: ${script.url || script.scriptId}`,
        sourceLoaded: typeof script.source === 'string',
    }));
}
function buildProgressiveSourceBatchPlan(maxResults) {
    const requestedResults = typeof maxResults === 'number' && maxResults > 0 ? maxResults : 20;
    const firstBatch = Math.min(24, Math.max(12, requestedResults * 2));
    const plan = [firstBatch, Math.min(48, Math.max(firstBatch * 2, 24)), 80];
  return plan.filter((size, index) => size > 0 && plan.indexOf(size) === index);
}
function trimScriptsForSourceLoading(scripts, maxBytes = 512 * 1024) {
  let remainingBytes = maxBytes;
  return scripts.filter((script) => {
    const sourceLength = typeof script?.sourceLength === 'number' ? script.sourceLength : undefined;
    if (sourceLength === 0) {
      return false;
    }
    if (sourceLength === undefined) {
      return true;
    }
    if (sourceLength > maxBytes) {
      return false;
    }
    if (remainingBytes - sourceLength < 0) {
      return false;
    }
    remainingBytes -= sourceLength;
    return true;
  });
}
function buildToolDiagnostic(tool, error, extra = {}) {
    return {
        tool,
        error: error instanceof Error ? error.message : String(error),
        ...extra,
    };
}
function collectExceptionPauseHints(exceptions, primaryKeyword) {
    const normalizedKeyword = typeof primaryKeyword === 'string' ? primaryKeyword.trim().toLowerCase() : '';
    if (!normalizedKeyword || !Array.isArray(exceptions) || exceptions.length === 0) {
        return [];
    }
    return exceptions
        .filter((item) => String(item?.text || '').toLowerCase().includes(normalizedKeyword))
        .slice(-3)
        .map((item) => ({
        tool: 'debug.breakpoint',
        action: 'setOnException',
        state: 'uncaught',
        url: item.url,
        reason: `Pause on uncaught exceptions mentioning "${primaryKeyword}"`,
        exceptionText: item.text,
        confidence: 'high',
        verification: 'observed-exception',
    }));
}
function collectExceptionStackBreakpointHints(exceptions, candidate) {
    if (!Array.isArray(exceptions) || exceptions.length === 0 || !candidate?.url) {
        return [];
    }
    const hints = [];
    const seen = new Set();
    const escapedUrl = String(candidate.url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\(${escapedUrl}:(\\d+):(\\d+)\\)`, 'g'),
        new RegExp(`${escapedUrl}:(\\d+):(\\d+)`, 'g'),
    ];
    for (const exception of exceptions) {
        const text = String(exception?.text || '');
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const lineNumber = Number(match[1]);
                const columnNumber = Number(match[2]);
                if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
                    continue;
                }
                const key = `${lineNumber}:${columnNumber}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                hints.push({
                    tool: 'debug.breakpoint',
                    action: 'set',
                    url: candidate.url,
                    scriptId: candidate.scriptId,
                    lineNumber: Math.max(0, lineNumber - 1),
                    displayLineNumber: lineNumber,
                    columnNumber: Math.max(0, columnNumber - 1),
                    reason: 'Pause near an exception stack frame already observed on this page',
                    confidence: 'high',
                    verification: 'observed-exception-stack',
                });
                if (hints.length >= 3) {
                    return hints;
                }
            }
        }
    }
    return hints;
}
function buildExceptionDerivedCandidates(exceptions, primaryKeyword) {
    const normalizedKeyword = typeof primaryKeyword === 'string' ? primaryKeyword.trim().toLowerCase() : '';
    if (!normalizedKeyword || !Array.isArray(exceptions) || exceptions.length === 0) {
        return [];
    }
    const candidates = [];
    const seen = new Set();
    const stackFrameRegex = /(https?:\/\/[^\s)]+):(\d+):(\d+)/g;
    for (const exception of exceptions) {
        const text = String(exception?.text || '');
        if (!text.toLowerCase().includes(normalizedKeyword)) {
            continue;
        }
        let match;
        while ((match = stackFrameRegex.exec(text)) !== null) {
            const url = match[1];
            const lineNumber = Number(match[2]);
            const columnNumber = Number(match[3]);
            if (!url || !Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
                continue;
            }
            const key = `${url}:${lineNumber}:${columnNumber}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            candidates.push({
                scriptId: undefined,
                url,
                matches: [primaryKeyword],
                rankedFunctions: [],
                objectPaths: [],
                keywordHits: [],
                requestPatternHits: [{
                        scriptId: undefined,
                        url,
                        line: lineNumber,
                        column: Math.max(0, columnNumber - 1),
                        matchText: primaryKeyword,
                        context: text.slice(0, 2000),
                    }],
                score: 200,
                derivedFrom: 'exception-stack',
            });
            if (candidates.length >= 5) {
                return candidates;
            }
        }
    }
    return candidates;
}
function buildPausedStateDerivedCandidates(pausedState, primaryKeyword) {
    const description = String(pausedState?.data?.description || '');
    if (!description) {
        return [];
    }
    return buildExceptionDerivedCandidates([{
            text: description,
            url: pausedState?.callFrames?.[0]?.url,
        }], primaryKeyword);
}
function buildPausedStateExceptionRecords(pausedState) {
    const description = String(pausedState?.data?.description || '');
    if (!description) {
        return [];
    }
    return [{
            text: description,
            url: pausedState?.callFrames?.[0]?.url,
        }];
}
function isExceptionPauseReason(reason) {
    const normalizedReason = String(reason || '').trim().toLowerCase();
    return normalizedReason === 'exception' || normalizedReason === 'promiserejection';
}
function collectObservedPausedLocationHints(session, candidate, primaryKeyword) {
    const pausedState = session?.debuggerManager?.getPausedState?.();
    const topFrame = pausedState?.callFrames?.[0];
    if (!topFrame?.location || !candidate) {
        return [];
    }
    if (isExceptionPauseReason(pausedState?.reason)) {
        return [];
    }
    const normalizedPrimaryKeyword = typeof primaryKeyword === 'string' ? primaryKeyword.trim().toLowerCase() : '';
    const hasDirectPrimaryHit = normalizedPrimaryKeyword
        && (((candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedPrimaryKeyword))
            || ((candidate.keywordHits || []).some((hit) => hit.keyword === normalizedPrimaryKeyword))
            || ((candidate.requestPatternHits || []).length > 0));
    if (!hasDirectPrimaryHit) {
        return [];
    }
    const sameScriptId = typeof candidate.scriptId === 'string' && topFrame.location.scriptId === candidate.scriptId;
    const sameUrl = typeof candidate.url === 'string' && typeof topFrame.url === 'string' && topFrame.url === candidate.url;
    if (!sameScriptId && !sameUrl) {
        return [];
    }
    return [{
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: topFrame.location.lineNumber,
            displayLineNumber: (topFrame.location.lineNumber || 0) + 1,
            columnNumber: topFrame.location.columnNumber,
            reason: 'Pause again at the observed debugger stop location',
            confidence: 'high',
            verification: 'observed-paused-location',
        }];
}
function collectObservedExceptionTopFrameHints(session, candidate) {
    const pausedState = session?.debuggerManager?.getPausedState?.();
    const topFrame = pausedState?.callFrames?.[0];
    const description = String(pausedState?.data?.description || '');
    if (!topFrame?.location || !candidate?.url || !description.includes(candidate.url)) {
        return [];
    }
    if (isExceptionPauseReason(pausedState?.reason)) {
        return [];
    }
    return [{
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: topFrame.location.lineNumber,
            displayLineNumber: (topFrame.location.lineNumber || 0) + 1,
            columnNumber: topFrame.location.columnNumber,
            reason: 'Pause again at the top frame from an observed exception pause',
            confidence: 'high',
            verification: 'observed-exception-top-frame',
        }];
}
async function runWorkerScriptSearch(runtime, scriptsForWorker, args, extra = {}) {
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
    return {
        ...workerResult,
        ...extra,
    };
}
async function progressivelySearchScriptSources(runtime, session, args) {
    const batchPlan = buildProgressiveSourceBatchPlan(args.maxResults);
    let lastResult = {
        keyword: String(args.keyword || ''),
        searchMode: args.searchMode || 'indexed',
        totalMatches: 0,
        truncated: false,
        executionMode: 'worker',
        matches: [],
        loadStrategy: 'progressive-source-batches',
        sourceBatches: batchPlan,
        loadedScripts: 0,
    };
    for (const batchSize of batchPlan) {
        await hydrateScriptInventory(session, {
            includeSource: true,
            indexPolicy: args.indexPolicy || 'deep',
            maxScripts: batchSize,
            maxBytes: typeof args.maxBytes === 'number' ? args.maxBytes : 512 * 1024,
        });
        const scriptsForWorker = trimScriptsForSourceLoading(session.scriptInventory.list({
            includeSource: true,
            maxScripts: batchSize,
        }).filter((item) => typeof item.source === 'string'), typeof args.maxBytes === 'number' ? args.maxBytes : 512 * 1024);
        if (scriptsForWorker.length === 0) {
            continue;
        }
        const workerResult = await runWorkerScriptSearch(runtime, scriptsForWorker, args, {
            loadStrategy: 'progressive-source-batches',
            sourceBatches: batchPlan,
            loadedScripts: scriptsForWorker.length,
        });
        lastResult = workerResult;
        if ((workerResult.matches || []).length > 0) {
            return workerResult;
        }
    }
    return lastResult;
}
function collectKeywordLineHits(source, keywords, maxHits = 3) {
    const normalizedKeywords = (keywords || [])
        .filter((keyword) => typeof keyword === 'string' && keyword.trim().length > 0)
        .map((keyword) => keyword.trim().toLowerCase());
    if (normalizedKeywords.length === 0 || typeof source !== 'string' || source.length === 0) {
        return [];
    }
    const hits = [];
    const lines = source.split(/\r?\n/);
    for (const keyword of normalizedKeywords) {
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (!lines[lineIndex].toLowerCase().includes(keyword)) {
                continue;
            }
            hits.push({
                keyword,
                lineNumber: lineIndex,
                displayLineNumber: lineIndex + 1,
            });
            break;
        }
        if (hits.length >= maxHits) {
            return hits;
        }
    }
    return hits;
}
function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function collectFieldWriteHints(source, targetField, maxHits = 3) {
    const normalizedTarget = typeof targetField === 'string' ? targetField.trim() : '';
    if (!normalizedTarget || typeof source !== 'string' || source.length === 0) {
        return [];
    }
    const lines = source.split(/\r?\n/);
    const fieldPattern = new RegExp(`(?:\\b${escapeRegExp(normalizedTarget)}\\b\\s*:|\\.${escapeRegExp(normalizedTarget)}\\s*=|\\[['"]${escapeRegExp(normalizedTarget)}['"]\\]\\s*=)`, 'i');
    const hints = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (!fieldPattern.test(lines[lineIndex])) {
            continue;
        }
        hints.push({
            field: normalizedTarget,
            lineNumber: lineIndex,
            displayLineNumber: lineIndex + 1,
            snippet: lines[lineIndex].trim().slice(0, 160),
        });
        if (hints.length >= maxHits) {
            break;
        }
    }
    return hints;
}
function hasRequestHint(value) {
    const text = String(value || '').trim();
    return text.length > 0;
}
function buildCandidateDebugPlan(candidate, requestPattern, exceptionHints = [], observedPausedLocationHints = [], exceptionStackBreakpointHints = [], observedExceptionTopFrameHints = [], options = {}) {
    const plans = [];
    const seen = new Set();
    const normalizedPrimaryKeyword = typeof requestPattern === 'string' ? requestPattern.trim().toLowerCase() : '';
    const hasExactPrimaryEvidence = Boolean(normalizedPrimaryKeyword)
        && ((candidate.requestPatternHits || []).length > 0
            || (candidate.keywordHits || []).some((hit) => hit.keyword === normalizedPrimaryKeyword)
            || (candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedPrimaryKeyword)
            || observedPausedLocationHints.length > 0
            || observedExceptionTopFrameHints.length > 0
            || exceptionStackBreakpointHints.length > 0);
    const pushPlan = (plan) => {
        if (!plan || typeof plan !== 'object') {
            return;
        }
        const key = JSON.stringify([
            plan.tool,
            plan.action,
            plan.url,
            plan.scriptId,
            plan.lineNumber,
            plan.expression,
            plan.urlPattern,
            plan.functionName,
            plan.type,
            plan.state,
        ]);
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        plans.push(plan);
    };
    for (const hint of observedPausedLocationHints) {
        pushPlan(hint);
        if (plans.length >= 2) {
            break;
        }
    }
    for (const hint of observedExceptionTopFrameHints) {
        pushPlan(hint);
        if (plans.length >= 2) {
            break;
        }
    }
    for (const hint of exceptionStackBreakpointHints) {
        pushPlan(hint);
        if (plans.length >= 3) {
            break;
        }
    }
    for (const hint of exceptionHints) {
        pushPlan(hint);
        if (plans.length >= 3) {
            break;
        }
    }
    for (const hit of candidate.requestPatternHits || []) {
        if (!candidate.url) {
            continue;
        }
        pushPlan({
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: Math.max(0, Number(hit.line || 1) - 1),
            displayLineNumber: Number(hit.line || 1),
            columnNumber: typeof hit.column === 'number' ? hit.column : undefined,
            keyword: hit.matchText || requestPattern,
            reason: `Pause near exact request-pattern hit "${hit.matchText || requestPattern}"`,
            confidence: 'medium',
            verification: 'static-source-hit',
        });
        if (plans.length >= 3) {
            break;
        }
    }
    for (const hint of candidate.fieldWriteHints || []) {
        if (!candidate.url) {
            continue;
        }
        pushPlan({
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: hint.lineNumber,
            displayLineNumber: hint.displayLineNumber,
            keyword: hint.field,
            reason: `Pause near final-write hint for field "${hint.field}"`,
            confidence: 'high',
            verification: 'field-write-hit',
        });
        if (plans.length >= 4) {
            break;
        }
    }
    for (const hit of candidate.keywordHits || []) {
        if (!candidate.url) {
            continue;
        }
        if (hasExactPrimaryEvidence && normalizedPrimaryKeyword && hit.keyword !== normalizedPrimaryKeyword) {
            continue;
        }
        pushPlan({
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: hit.lineNumber,
            displayLineNumber: hit.displayLineNumber,
            keyword: hit.keyword,
            reason: `Pause near keyword "${hit.keyword}"`,
            confidence: 'medium',
            verification: 'static-keyword-hit',
        });
        if (plans.length >= 5) {
            break;
        }
    }
    for (const rankedFunction of candidate.rankedFunctions || []) {
        if (!candidate.url || typeof rankedFunction?.line !== 'number' || rankedFunction.line <= 0) {
            continue;
        }
        pushPlan({
            tool: 'debug.breakpoint',
            action: 'set',
            url: candidate.url,
            scriptId: candidate.scriptId,
            lineNumber: Math.max(0, rankedFunction.line - 1),
            displayLineNumber: rankedFunction.line,
            functionName: rankedFunction.name,
            reason: `Pause in likely hot function ${rankedFunction.name}`,
            confidence: 'low',
            verification: 'heuristic-function-rank',
        });
        if (plans.length >= 5) {
            break;
        }
    }
    for (const objectPath of candidate.objectPaths || []) {
        pushPlan({
            tool: 'debug.watch',
            action: 'add',
            expression: objectPath,
            reason: `Watch runtime value for ${objectPath}`,
            confidence: 'low',
            verification: 'static-object-path',
        });
        if (plans.length >= 6) {
            break;
        }
    }
    if (hasRequestHint(requestPattern)) {
        pushPlan({
            tool: 'debug.xhr',
            action: 'set',
            urlPattern: String(requestPattern),
            reason: `Pause on XHR/fetch URLs matching "${requestPattern}"`,
            confidence: 'low',
            verification: 'pattern-derived',
        });
    }
    if (options.suggestBlackboxCommon === true) {
        pushPlan({
            tool: 'debug.blackbox',
            action: 'addCommon',
            reason: 'Blackbox common libraries first to reduce noisy stack frames on this target.',
            confidence: 'low',
            verification: 'noise-reduction',
        });
    }
    const traceTarget = (candidate.objectPaths || [])[0]
        ? String(candidate.objectPaths[0]).replace(/^window\./, '')
        : (candidate.rankedFunctions || []).find((rankedFunction) => typeof rankedFunction?.name === 'string' && rankedFunction.name.length > 0)?.name;
    if (traceTarget) {
        pushPlan({
            tool: 'inspect.function-trace',
            action: 'start',
            functionName: traceTarget,
            captureArgs: true,
            captureReturn: true,
            reason: `Trace runtime calls to ${traceTarget}`,
            confidence: 'low',
            verification: 'runtime-function-trace',
        });
    }
    if (hasRequestHint(requestPattern)) {
        pushPlan({
            tool: 'inspect.interceptor',
            action: 'start',
            type: 'both',
            urlPattern: String(requestPattern),
            reason: `Capture request inputs for URLs matching "${requestPattern}"`,
            confidence: 'low',
            verification: 'runtime-request-interceptor',
        });
    }
    return plans;
}
function scoreSignatureCandidate(candidate, primaryKeyword, options = {}) {
    const normalizedPrimary = typeof primaryKeyword === 'string' ? primaryKeyword.trim().toLowerCase() : '';
    const normalizedTargetField = typeof options?.targetField === 'string' ? options.targetField.trim().toLowerCase() : '';
    const normalizedFieldRole = typeof options?.fieldRole === 'string' ? options.fieldRole.trim().toLowerCase() : '';
    const coverageByScriptId = options?.coverageByScriptId || new Map();
    const coverageByUrl = options?.coverageByUrl || new Map();
    const hookBoostByObjectPath = options?.hookBoostByObjectPath || new Map();
    const hookBoostByFunctionName = options?.hookBoostByFunctionName || new Map();
    let score = 0;
    if (normalizedPrimary) {
        if ((candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedPrimary)) {
            score += 100;
        }
        score += (candidate.keywordHits || []).filter((hit) => hit.keyword === normalizedPrimary).length * 40;
        if (String(candidate.url || '').toLowerCase().includes(normalizedPrimary)) {
            score += 20;
        }
    }
    if (normalizedTargetField) {
        if ((candidate.matches || []).some((item) => String(item).toLowerCase() === normalizedTargetField)) {
            score += 120;
        }
        score += (candidate.keywordHits || []).filter((hit) => hit.keyword === normalizedTargetField).length * 48;
        score += (candidate.fieldWriteHints || []).length * 70;
        if (String(candidate.url || '').toLowerCase().includes(normalizedTargetField)) {
            score += 24;
        }
    }
    if (normalizedFieldRole === 'derived' || normalizedFieldRole === 'final-signature') {
        score += (candidate.fieldWriteHints || []).length * 60;
        score += Math.min((candidate.objectPaths || []).length, 3) * 10;
    }
    const coverageInfo = (candidate?.scriptId && coverageByScriptId.get(candidate.scriptId))
        || (candidate?.url && coverageByUrl.get(candidate.url));
    if (coverageInfo) {
        score += Math.min(Number(coverageInfo.coveragePercentage || 0), 100) * 0.6;
        score += Math.min(Number(coverageInfo.usedBytes || 0), 2000) / 40;
    }
    for (const objectPath of candidate.objectPaths || []) {
        score += Number(hookBoostByObjectPath.get(objectPath) || 0);
    }
    for (const rankedFunction of candidate.rankedFunctions || []) {
        score += Number(hookBoostByFunctionName.get(rankedFunction?.name) || 0);
    }
    score += (candidate.keywordHits || []).length * 12;
    score += (candidate.rankedFunctions || []).length * 4;
    score += Math.min((candidate.objectPaths || []).length, 5);
    return score;
}
function buildReportDebugPlan(fingerprints) {
    const plans = [];
    const seen = new Set();
    for (const fingerprint of fingerprints || []) {
        if (!fingerprint?.url) {
            continue;
        }
        for (const rankedFunction of fingerprint.rankedFunctions || []) {
            if (typeof rankedFunction?.line !== 'number' || rankedFunction.line <= 0) {
                continue;
            }
            const key = `${fingerprint.url}:${rankedFunction.line}:${rankedFunction.name}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            plans.push({
                tool: 'debug.breakpoint',
                action: 'set',
                url: fingerprint.url,
                scriptId: fingerprint.scriptId,
                lineNumber: Math.max(0, rankedFunction.line - 1),
                displayLineNumber: rankedFunction.line,
                functionName: rankedFunction.name,
                reason: `Pause in ranked function ${rankedFunction.name}`,
            });
            break;
        }
        if (plans.length >= 5) {
            break;
        }
    }
    return {
        lineNumberBase: 'zero-based',
        actions: plans,
        nextStep: plans.length > 0
            ? 'Use flow.find-signature-path for target-specific debug.breakpoint/debug.watch/debug.xhr suggestions.'
            : 'Use flow.find-signature-path to build target-specific V2 action suggestions.',
    };
}
function isNoisySignatureObjectPath(objectPath) {
    return /^(window|globalThis|self)\.(navigator|document|location|chrome|history|localStorage|sessionStorage|performance|JSON|Math|console)\b/.test(String(objectPath || ''));
}
function collectSignatureCandidate(script, keywords, runtime, diagnostics, options = {}) {
    const normalizedKeywords = (keywords || []).filter((keyword) => typeof keyword === 'string' && keyword.trim().length > 0);
    const matches = normalizedKeywords.filter((keyword) => script.source.toLowerCase().includes(keyword.toLowerCase()));
    let rankedFunctions = [];
    let objectPaths = [];
    const fieldWriteHints = collectFieldWriteHints(script.source, options?.targetField, 3);
    try {
        rankedFunctions = runtime.functionRanker.rank(script.source).slice(0, 5);
    }
    catch (error) {
        diagnostics.push(buildToolDiagnostic('flow.find-signature-path', error, {
            scriptId: script.scriptId,
            url: script.url,
            stage: 'rank-functions',
        }));
    }
    try {
        objectPaths = Array.from(String(script.source).matchAll(/window\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g))
            .map((match) => `window.${match[1]}.${match[2]}`)
            .filter((objectPath) => !isNoisySignatureObjectPath(objectPath));
    }
    catch (error) {
        diagnostics.push(buildToolDiagnostic('flow.find-signature-path', error, {
            scriptId: script.scriptId,
            url: script.url,
            stage: 'object-path-scan',
        }));
    }
    if (matches.length === 0 && rankedFunctions.length === 0 && objectPaths.length === 0 && fieldWriteHints.length === 0) {
        return null;
    }
    return {
        scriptId: script.scriptId,
        url: script.url,
        matches,
        rankedFunctions,
        objectPaths,
        keywordHits: collectKeywordLineHits(script.source, matches, 3),
        requestPatternHits: Array.isArray(script.requestPatternHits) ? script.requestPatternHits : [],
        fieldWriteHints,
    };
}
async function resolveReportFingerprintCandidates(session, runtime) {
    const manifestScripts = await hydrateScriptInventory(session, {
        includeSource: false,
        indexPolicy: 'metadata-only',
        maxScripts: 20,
    });
    const candidates = manifestScripts
        .filter((script) => typeof script.url === 'string' && script.url.length > 0)
        .sort((left, right) => (left.sourceLength || 0) - (right.sourceLength || 0))
        .slice(0, 4);
    const resolved = [];
    const diagnostics = [];
    for (const candidate of candidates) {
        try {
            const sourcePayload = await resolveScriptSource(session, {
                scriptId: candidate.scriptId,
                url: candidate.url,
            });
            if (sourcePayload?.source) {
                resolved.push({
                    scriptId: candidate.scriptId,
                    url: candidate.url,
                    fingerprint: runtime.bundleFingerprints.fingerprint(sourcePayload.source),
                    rankedFunctions: runtime.functionRanker.rank(sourcePayload.source).slice(0, 3),
                });
            }
        }
        catch (error) {
            diagnostics.push(buildToolDiagnostic('flow.reverse-report', error, {
                scriptId: candidate.scriptId,
                url: candidate.url,
            }));
        }
    }
    return {
        fingerprints: resolved,
        diagnostics,
    };
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
function requirePlaywrightFeatures(session, capability) {
    if (!session.pageController || !session.domInspector || !session.consoleMonitor) {
        return `${capability} currently requires an active Playwright-backed session`;
    }
    return null;
}
const DEFAULT_V2_PROFILES = ['core', 'expert', 'legacy'];
function normalizeProfiles(profiles) {
    return Array.isArray(profiles) && profiles.length > 0 ? profiles : DEFAULT_V2_PROFILES;
}
function matchesToolProfile(blueprint, profile = 'expert') {
    const targetProfile = profile === 'legacy' ? 'legacy' : profile;
    return normalizeProfiles(blueprint.profiles).includes(targetProfile);
}
function createStandaloneLLMService(runtime) {
    return new LLMService(runtime.config.llm, undefined, {
        storage: runtime.storage,
        llmCache: runtime.config.llmCache,
    });
}
async function ensureDebugCapabilities(session) {
    if (!session?.debuggerManager || !session?.runtimeInspector) {
        throw new Error('Debugging requires a Playwright-backed session');
    }
    await session.debuggerManager.init();
    await session.runtimeInspector.init();
    if (!session.debuggerManager._watchManager
        || !session.debuggerManager._xhrManager
        || !session.debuggerManager._eventManager
        || !session.debuggerManager._blackboxManager) {
        await session.debuggerManager.initAdvancedFeatures(session.runtimeInspector);
    }
}
async function evaluateWatchesInGlobalContext(session, watchManager) {
    const results = [];
    const watches = watchManager.getAllWatches().filter((watch) => watch.enabled !== false);
    for (const watch of watches) {
        try {
            const value = await session.runtimeInspector.evaluateGlobal(watch.expression);
            const valueChanged = !watchManager.deepEqual(value, watch.lastValue);
            if (valueChanged) {
                watch.valueHistory.push({
                    value,
                    timestamp: Date.now(),
                });
                if (watch.valueHistory.length > 100) {
                    watch.valueHistory.shift();
                }
            }
            watch.lastValue = value;
            watch.lastError = null;
            results.push({
                watchId: watch.id,
                name: watch.name,
                expression: watch.expression,
                value,
                error: null,
                valueChanged,
                timestamp: Date.now(),
            });
        }
        catch (error) {
            watch.lastError = error;
            results.push({
                watchId: watch.id,
                name: watch.name,
                expression: watch.expression,
                value: null,
                error: error instanceof Error ? error.message : String(error),
                valueChanged: false,
                timestamp: Date.now(),
            });
        }
    }
    return results;
}
const blueprints = buildToolBlueprints({
    compactPayload,
    errorResponse,
    maybeExternalize,
    successResponse,
    paginateItems,
    LLMService,
    CodeAnalyzer,
    CryptoDetector,
    ObfuscationAnalysisService,
    sessionSchema,
    getSession,
    ensureSessionCapability,
    normalizeBudgets,
    buildStatusPayload,
    buildRecoveryNextActions,
    enforceRateLimit,
    buildHookContext,
    hydrateScriptInventory,
    findScriptMetadataMatches,
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
    requirePlaywrightFeatures,
    createStandaloneLLMService,
    ensureDebugCapabilities,
    evaluateWatchesInGlobalContext,
});
export function getV2ToolCatalog(profile = 'expert') {
    return blueprints
        .filter((blueprint) => matchesToolProfile(blueprint, profile))
        .map(({ name, group, lifecycle, description, inputSchema }) => ({
        name,
        group,
        lifecycle,
        description,
        inputSchema,
    }));
}
export const V2_TOOL_CATALOG = getV2ToolCatalog('expert');
export function createV2Tools(runtime, profile = runtime?.options?.toolProfile || 'expert') {
    return blueprints
        .filter((blueprint) => matchesToolProfile(blueprint, profile))
        .map((blueprint) => ({
        name: blueprint.name,
        description: blueprint.description,
        inputSchema: blueprint.inputSchema,
        group: blueprint.group,
        lifecycle: blueprint.lifecycle,
        execute: blueprint.createHandler(runtime),
    }));
}
//# sourceMappingURL=createV2Tools.js.map
