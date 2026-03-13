# Browser Storage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a V2 `browser.storage` tool that groups cookies, localStorage, and sessionStorage into one direct browser helper.

**Architecture:** Extend `PageController` with generic storage helpers, then expose a thin `browser.storage` blueprint that routes by `action + target`. Keep the tool expert-only so the core profile stays workflow-first.

**Tech Stack:** TypeScript, Jest, Playwright-backed V2 runtime

---

## Chunk 1: Storage Helpers

### Task 1: Extend page storage primitives

**Files:**
- Modify: `src/modules/collector/PageController.ts`

- [ ] Step 1: Write failing tests that require grouped storage behavior through the V2 surface.
- [ ] Step 2: Run the targeted tests and verify they fail because `browser.storage` is missing.
- [ ] Step 3: Add `getStorage`, `setStorageEntries`, and `clearStorage` helpers for local/session storage.
- [ ] Step 4: Keep cookie methods unchanged except for any small adapter needs.
- [ ] Step 5: Re-run the targeted tests and verify helper-backed behavior is available.

## Chunk 2: V2 Tool Surface

### Task 2: Add `browser.storage`

**Files:**
- Modify: `src/server/v2/tools/browserBlueprints.ts`
- Modify: `tests/integration/v2-flow-extended.test.ts`
- Modify: `tests/unit/catalog.test.ts`
- Modify: `tests/unit/tool-profile.test.ts`

- [ ] Step 1: Add failing unit and integration expectations for `browser.storage`.
- [ ] Step 2: Run the targeted tests and confirm the tool is missing.
- [ ] Step 3: Implement `browser.storage(action, target)` with grouped cookie/local/session support.
- [ ] Step 4: Return concise structured payloads for reads, writes, and clears.
- [ ] Step 5: Re-run the targeted tests and verify they pass.

## Chunk 3: Verification

### Task 3: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize the completed `browser.storage` capability and next subproject.
