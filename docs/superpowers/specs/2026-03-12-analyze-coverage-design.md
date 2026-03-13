# Analyze Coverage Design

## Goal

Add a first-class V2 tool, `analyze.coverage`, that turns Playwright precise coverage into reverse-engineering guidance for hot scripts in an active session.

## Scope

This design covers only the first MVP slice:

- session-backed coverage collection
- `action: start | stop | summary`
- script-level hot path summaries
- evidence and artifact output
- reverse-oriented `recommendedActions`

This design does not cover:

- function-level attribution
- heap snapshots
- automatic flow reranking

## Inputs

`analyze.coverage` will require `sessionId` and support:

- `action: 'start' | 'stop' | 'summary'`
- optional `maxScripts` for summary truncation

## Outputs

`start` returns collection state only.

`stop` returns:

- raw script coverage records
- `summary` with hot scripts and aggregate percentages
- `recommendedActions` for top covered scripts
- artifact/evidence references

`summary` returns the latest stored summary without stopping or restarting collection.

## Architecture

The tool will reuse the existing `PerformanceMonitor` precise coverage support. Session lifecycle will own one `PerformanceMonitor` instance per Playwright session so coverage can span multiple tool calls.

`PerformanceMonitor` will keep lightweight state:

- whether coverage is active
- when collection started
- the latest full result
- the latest derived summary

`analyze.coverage` in the V2 analyze tool group will be responsible for:

- validating session access
- starting and stopping collection
- deriving reverse-engineering hints from covered scripts
- externalizing large payloads while preserving inline summary

## Recommended Actions

For the hottest scripts, the tool should emit V2-native follow-up actions such as:

- `inspect.scripts(action: 'source', scriptId)`
- `analyze.rank-functions(scriptId)`

The first MVP will not emit `flow.find-signature-path` automatically because that broadens scope from coverage collection into workflow orchestration.

## Testing

Add integration coverage for:

- start -> exercise runtime -> stop
- summary after stop
- catalog/profile visibility

Add unit coverage for:

- session-owned monitor lifecycle state
- summary derivation if a focused helper is introduced
