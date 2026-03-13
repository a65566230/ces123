# Browser Interact Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grouped V2 `browser.interact` tool for common page interactions.

**Architecture:** Reuse existing `PageController` methods and expose them through a grouped `action` contract in `browserBlueprints.ts`.

**Tech Stack:** TypeScript, Jest, Playwright-backed V2 runtime

---

## Chunk 1: V2 Tool Surface

### Task 1: Add `browser.interact`

**Files:**
- Modify: `src/server/v2/tools/browserBlueprints.ts`
- Modify: `tests/integration/v2-flow-extended.test.ts`
- Modify: `tests/unit/catalog.test.ts`
- Modify: `tests/unit/tool-profile.test.ts`

- [ ] Step 1: Write failing unit and integration expectations for `browser.interact`.
- [ ] Step 2: Run the targeted tests and verify they fail because the tool is missing.
- [ ] Step 3: Implement grouped interaction routing for the MVP actions.
- [ ] Step 4: Return concise structured metadata per action.
- [ ] Step 5: Re-run the targeted tests and verify they pass.

## Chunk 2: Verification

### Task 2: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize the completed `browser.interact` capability and next subproject.
