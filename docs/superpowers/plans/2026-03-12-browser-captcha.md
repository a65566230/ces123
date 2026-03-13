# Browser Captcha Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grouped V2 `browser.captcha` tool for captcha detection, waiting, and session-scoped config.

**Architecture:** Reuse `AICaptchaDetector` and store lightweight captcha config on each session. Expose the legacy detect/wait/config semantics through one grouped V2 browser tool.

**Tech Stack:** TypeScript, Jest, Playwright-backed V2 runtime

---

## Chunk 1: V2 Tool Surface

### Task 1: Add `browser.captcha`

**Files:**
- Modify: `src/server/v2/tools/browserBlueprints.ts`
- Modify: `tests/integration/v2-flow-extended.test.ts`
- Modify: `tests/unit/catalog.test.ts`
- Modify: `tests/unit/tool-profile.test.ts`

- [ ] Step 1: Write failing unit and integration expectations for `browser.captcha`.
- [ ] Step 2: Run the targeted tests and verify they fail because the tool is missing.
- [ ] Step 3: Implement grouped captcha detect/wait/config actions.
- [ ] Step 4: Re-run the targeted tests and verify they pass.

## Chunk 2: Verification

### Task 2: Run full validation

**Files:**
- Modify if needed based on failures surfaced by validation

- [ ] Step 1: Run `npm run test:unit`.
- [ ] Step 2: Run `npm run test:integration`.
- [ ] Step 3: Run `npm run typecheck`.
- [ ] Step 4: Run `npm run verify`.
- [ ] Step 5: Summarize the completed `browser.captcha` capability and remaining roadmap state.
