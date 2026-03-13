# Analyze Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class V2 `analyze.coverage` tool that captures Playwright precise coverage and turns it into reverse-oriented hot-script guidance.

**Architecture:** Reuse `PerformanceMonitor` as a session-owned capability, store latest coverage state on the session, and expose a thin V2 analyze blueprint that returns summary, artifacts, evidence, and recommended follow-up actions. Keep the MVP script-level only.

**Tech Stack:** TypeScript, Jest, Playwright-backed V2 runtime, CDP precise coverage, artifact/evidence stores

---

## Chunk 1: Runtime Ownership

### Task 1: Add session-owned performance monitor support

**Files:**
- Modify: `src/server/v2/runtime/SessionLifecycleManager.ts`
- Modify: `src/modules/monitor/PerformanceMonitor.ts`

- [ ] Step 1: Add failing tests that require session-backed `analyze.coverage` lifecycle behavior.
- [ ] Step 2: Run the targeted tests and verify the new assertions fail for the missing tool/state.
- [ ] Step 3: Add one `PerformanceMonitor` per Playwright session and tear it down during session close/recovery.
- [ ] Step 4: Extend `PerformanceMonitor` with stored coverage state for `start`, `stop`, and `summary`.
- [ ] Step 5: Re-run the targeted tests and verify the runtime layer passes.

## Chunk 2: Tool Surface

### Task 2: Add `analyze.coverage`

**Files:**
- Modify: `src/server/v2/tools/analyzeBlueprints.ts`
- Modify: `tests/integration/v2-flow-extended.test.ts`
- Modify: `tests/unit/catalog.test.ts`
- Modify: `tests/unit/tool-profile.test.ts`

- [ ] Step 1: Write failing tests for catalog presence and the `start -> stop -> summary` integration path.
- [ ] Step 2: Run the targeted unit and integration tests and verify they fail because `analyze.coverage` is missing.
- [ ] Step 3: Implement `analyze.coverage(action: 'start' | 'stop' | 'summary')` as an expert/legacy analyze tool.
- [ ] Step 4: Derive hot-script summaries and V2-native `recommendedActions` from the top covered scripts.
- [ ] Step 5: Externalize large raw payloads while preserving inline summary and references.
- [ ] Step 6: Re-run the targeted tests and verify they pass.

## Chunk 3: Verification

### Task 3: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize final coverage-tool behavior and remaining follow-on gaps.
