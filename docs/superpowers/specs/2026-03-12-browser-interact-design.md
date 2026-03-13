# Browser Interact Design

## Goal

Add a first-class V2 `browser.interact` tool that groups the common page interaction primitives already present in the Playwright controller layer.

## Scope

This MVP covers:

- `click`
- `type`
- `select`
- `hover`
- `scroll`
- `waitForSelector`
- `pressKey`

This MVP does not cover:

- drag-and-drop
- file upload
- multi-step interaction macros

## API Shape

Inputs:

- `sessionId`
- `action`
- action-specific fields such as `selector`, `text`, `values`, `key`, `x`, `y`, `timeout`

Outputs:

- `action`
- concise structured success metadata
- any returned element payload from `waitForSelector`

## Architecture

Reuse `PageController` methods directly. The V2 tool should only validate the grouped action contract and return normalized structured responses.

Keep `browser.interact` as an expert/legacy helper so the core profile remains workflow-first.

## Testing

Integration:

- wait for an existing selector
- type into the basic fixture input
- click the basic fixture button and verify the runtime side effect

Unit:

- catalog presence
- core profile exclusion
