# Field-Aware Reverse Optimization Design

## Goal

Increase reverse-engineering precision and automatic hook precision by making V2 workflows field-aware and by turning hook capture results into reranking signals.

## Scope

This iteration covers:

- `flow.find-signature-path` input support for:
  - `targetField`
  - `fieldRole`
  - `preferredValidation`
- field-aware candidate scoring
- field-aware validation-action ordering
- `hook.data` input support for `targetField`
- `hook.data` summary quality signals:
  - `targetFieldObserved`
  - `fieldWriteObserved`
  - `requestCorrelationObserved`
  - `finalPayloadCorrelationObserved`
  - `bestHitSummary`
  - `rerankHint`

This iteration does not cover:

- full request-to-function correlation inside `flow.trace-request`
- automatic multi-candidate hook competition
- live-site benchmark automation

## Architecture

### `flow.find-signature-path`

Add field-aware inputs and use them in two places:

1. Candidate discovery and scoring
2. Validation-plan ordering

For derived/final-signature fields, the workflow should prioritize final-write-adjacent hints and dynamic validation tools such as:

- `inspect.function-trace`
- `inspect.interceptor`
- `debug.blackbox`

### `hook.data`

When `targetField` is provided, analyze captured records structurally rather than returning only raw record counts. The output should provide a lightweight quality summary that downstream workflows can use to decide whether to promote or reject the current hook target.

## Testing

Integration:

- a `vkey`-style field-aware ranking test that confirms preferred validation ordering
- a `hook.data(targetField)` test that confirms rerank hints and field observation summary

Unit:

- no new isolated unit harness is required if the behavior is fully covered through existing integration surfaces
