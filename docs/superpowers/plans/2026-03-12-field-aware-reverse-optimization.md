# Field-Aware Reverse Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve V2 reverse and automatic hook precision by making workflow ranking field-aware and by converting hook capture data into reranking signals.

**Architecture:** Extend `flow.find-signature-path` with field-aware inputs and validation ordering, then extend `hook.data` with target-field quality analysis. Keep the implementation heuristic and lightweight so it improves precision without destabilizing the current workflow path.

**Tech Stack:** TypeScript, Jest, V2 workflow tools, artifact/evidence summaries

---

## Chunk 1: Field-Aware Workflow Ranking

### Task 1: Extend `flow.find-signature-path`

**Files:**
- Modify: `src/server/v2/tools/createV2Tools.ts`
- Modify: `src/server/v2/tools/flowBlueprints.ts`
- Modify: `tests/integration/v2-acceptance.test.ts`

- [ ] Step 1: Write a failing acceptance test for `targetField`, `fieldRole`, and `preferredValidation`.
- [ ] Step 2: Run the targeted test and verify it fails for the missing field-aware behavior.
- [ ] Step 3: Implement field-aware discovery keywords, scoring, and validation-action ordering.
- [ ] Step 4: Re-run the targeted test and verify it passes.

## Chunk 2: Hook Quality Feedback

### Task 2: Extend `hook.data`

**Files:**
- Modify: `src/server/v2/tools/hookBlueprints.ts`
- Modify: `tests/integration/v2-flow-extended.test.ts`

- [ ] Step 1: Write a failing integration test for `hook.data(targetField)` quality summary.
- [ ] Step 2: Run the targeted test and verify it fails for the missing summary fields.
- [ ] Step 3: Implement target-field analysis and `rerankHint` generation.
- [ ] Step 4: Re-run the targeted test and verify it passes.

## Chunk 3: Verification

### Task 3: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize the precision gains and remaining optimization tracks.
