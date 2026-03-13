# Browser Capture Design

## Goal

Add a first-class V2 `browser.capture` tool that consolidates screenshot capture behind the grouped browser surface.

## Scope

This MVP covers:

- `action: screenshot`
- optional output path
- png/jpeg selection
- optional jpeg quality
- optional full-page capture

This MVP does not cover:

- PDF export
- DOM snapshots
- HAR export
- video capture

## API Shape

Inputs:

- `sessionId`
- `action: 'screenshot'`
- `path?: string`
- `type?: 'png' | 'jpeg'`
- `quality?: number`
- `fullPage?: boolean`

Outputs:

- `action`
- `path`
- `type`
- `fullPage`
- `sizeBytes`

## Architecture

Reuse `PageController.screenshot()` as the execution primitive. The V2 tool should stay thin and only validate inputs, invoke the controller, and return structured metadata.

Keep `browser.capture` as an expert/legacy helper so the core profile remains workflow-first.

## Testing

Integration:

- take a screenshot to an explicit file path
- verify file exists and reported byte size is non-zero

Unit:

- catalog presence
- core profile exclusion
