# V2 Acceptance And Legacy Contraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add representative V2-only acceptance coverage and update migration docs so Legacy contraction decisions are based on current reality.

**Architecture:** Add one new integration test file for the three representative scenarios, extend workflow recommendations only where the acceptance coverage proves a real gap, and update the core migration documents to match the implemented state.

**Tech Stack:** TypeScript, Jest, V2 runtime integration tests, markdown docs

---

## Chunk 1: Acceptance Tests

### Task 1: Add V2-only acceptance scenarios

**Files:**
- Create: `tests/integration/v2-acceptance.test.ts`
- Modify: `src/server/v2/tools/createV2Tools.ts`
- Modify: `src/server/v2/tools/flowBlueprints.ts`

- [ ] Step 1: Write failing tests for explicit-field, derived-field, and high-noise V2-only scenarios.
- [ ] Step 2: Run the targeted tests and verify the missing high-noise recommendation fails correctly.
- [ ] Step 3: Add the minimal workflow recommendation change needed for the high-noise scenario.
- [ ] Step 4: Re-run the targeted tests and verify they pass.

## Chunk 2: Migration Docs

### Task 2: Update migration truth surfaces

**Files:**
- Modify: `docs/plans/v2_workflow_integration_pr_plan.md`
- Modify: `docs/plans/legacy_retirement_strategy.md`
- Modify: `docs/plans/legacy_v2_capability_matrix.md`
- Modify: `docs/plans/auto_reverse_pipeline_enhancement.md`
- Modify: `docs/plans/benchmark_and_acceptance_plan.md`

- [ ] Step 1: Replace stale “missing/unmigrated” statements for capabilities that are now implemented.
- [ ] Step 2: Reframe the remaining work as acceptance and contraction instead of further tool creation.
- [ ] Step 3: Re-read the updated docs for consistency with the current V2 tool surface.

## Chunk 3: Verification

### Task 3: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize readiness for Legacy contraction decisions.
