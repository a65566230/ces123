# PR Plan: V2 Dynamic Workflow Integration and Legacy Retirement Alignment

## Summary

This PR plan consolidates the current audited planning documents into one implementation-ready baseline for the V2 upgrade work.

The goal is not to add duplicate V2 tool names. The goal is to:

- keep V2 as the only forward path
- wire existing expert tools into the workflow-first surface
- preserve reverse-engineering depth while shrinking Legacy to compatibility-only
- defer truly missing capabilities until code-backed implementation work begins

## Verified Baseline

The current repository already exposes these V2 expert tools:

- `debug.xhr`
- `debug.event`
- `debug.blackbox`
- `debug.watch`
- `debug.breakpoint`
- `inspect.dom(action: 'all'/'text'/'xpath'/'viewport')`
- `inspect.scripts(action: 'function-tree')`

The current repository now exposes these as first-class V2 tools:

- `inspect.function-trace`
- `inspect.interceptor`
- `analyze.coverage`
- `browser.interact`
- `browser.capture`
- `browser.storage`
- `browser.stealth`
- `browser.captcha`

The current workflow gap is not missing debug catalog entries. The current workflow gap is that `flow.find-signature-path` still emits Legacy-style action hints such as `watch_add` and `xhr_breakpoint_set` instead of normalized V2 `debug.*` suggestions.

## Scope

This implementation track should cover:

- normalizing all planning and execution targets around existing V2 tool names
- moving P0 priority from catalog expansion to workflow integration
- treating `inspect.function-trace`, `inspect.interceptor`, and the follow-on browser/coverage capabilities as completed migration targets
- defining Legacy deletion gates around V2-only workflow completeness instead of raw tool count

This implementation track should not cover:

- removing Legacy immediately
- inventing duplicate APIs like `debug.xhr-breakpoint`
- claiming tracer/interceptor already exist before code proves it
- expanding page/storage/capture capabilities ahead of workflow-critical validation work

## Proposed Changes

### 1. Workflow normalization

- Update `flow.find-signature-path` to emit V2-native recommendations such as `debug.watch`, `debug.xhr`, and `debug.blackbox`.
- Update `flow.trace-request` to consume and recommend `debug.xhr` and `debug.event` directly.
- Update `flow.generate-hook` planning to consume V2-native debug recommendations and evidence IDs rather than Legacy action names.

### 2. Dynamic validation integration

- Treat `debug.xhr`, `debug.event`, and `debug.blackbox` as existing expert entrypoints that now need workflow and evidence integration.
- Add evidence-friendly result summaries so workflow tools can rerank candidates based on dynamic hits.
- Keep Legacy aliases during migration, but stop treating them as the design center.

### 3. Completed capability migration

- `inspect.function-trace` is now a V2 first-class capability for function-level runtime validation.
- `inspect.interceptor` is now a V2 first-class capability for request payload and final-write correlation.
- `analyze.coverage`, `browser.interact`, `browser.capture`, `browser.storage`, `browser.stealth`, and `browser.captcha` have landed as follow-on tracks after the workflow-critical work.

### 4. Legacy retirement alignment

- Retire Legacy only after V2-only workflows can complete key `songmid` and `vkey` style investigations.
- Use capability and workflow gates, not catalog size, to decide when Legacy aliases can be deprecated or removed.
- Keep bridge compatibility until the workflow-first path proves stable on representative samples.

## Suggested PR Breakdown

### PR 1: Workflow recommendation normalization

- Replace Legacy-style debug suggestions emitted from `flow.find-signature-path`.
- Normalize request-trace recommendation objects to V2 tool names.
- Update tests that assert workflow recommendation payloads.

### PR 2: Dynamic validation feedback into workflows

- Feed `debug.xhr`, `debug.event`, and `debug.blackbox` outputs into `flow.*` evidence chains.
- Add structured next-step and evidence summaries for workflow reranking.
- Verify V2-only expert flow behavior in integration tests.

### PR 3: Missing validation tools

- Add `inspect.function-trace`.
- Add `inspect.interceptor`.
- Connect both tools to `flow.find-signature-path`, `flow.trace-request`, and `flow.generate-hook`.

### PR 4: Legacy contraction

- Mark Legacy aliases as compatibility-only where V2 equivalence is proven.
- Re-run benchmark scenarios for `songmid`, `vkey`, and at least one high-noise target.
- Update retirement guidance only after V2-only workflow acceptance passes.

## Acceptance Criteria

- No planning or workflow output proposes duplicate APIs for already-existing V2 expert tools.
- `flow.find-signature-path` recommends V2-native debug actions instead of `watch_add` or `xhr_breakpoint_set`.
- `flow.trace-request` and `flow.generate-hook` can consume dynamic validation results through V2-native tool references.
- `inspect.function-trace` and `inspect.interceptor` are implemented and should no longer be tracked as missing.
- Legacy retirement decisions reference V2-only workflow pass criteria, not tool-count heuristics.

## Validation Plan

- Use the current V2 catalog, README, unit catalog tests, and integration flow tests as the documentation truth source.
- Validate at three levels:
  - tool presence
  - workflow consumption
  - V2-only scenario pass rate
- Run benchmark comparisons in three stages:
  - current V2 catalog baseline
  - after workflow integration
- after tracer/interceptor and follow-on browser/coverage tools land

## Risks

- If workflow outputs remain Legacy-shaped, agents will keep drifting back to compatibility paths even when V2 tools already exist.
- If tracer/interceptor are treated as already implemented, rollout and retirement gates will become misleading.
- If page/storage/capture work jumps ahead of workflow validation integration, reverse-engineering quality may not improve even though surface area grows.

## Current Decision

Proceed with workflow integration first.

Treat the existing V2 expert debug catalog as available.

Treat Legacy contraction and V2-only acceptance as the next decision gate, not further tool-surface expansion.
