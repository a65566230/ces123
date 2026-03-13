# Browser Storage Design

## Goal

Add a first-class V2 `browser.storage` tool that groups cookie, localStorage, and sessionStorage operations behind one consistent session-backed API.

## Scope

This MVP covers:

- `action: get | set | clear`
- `target: cookies | local | session`
- multiple-cookie writes
- multi-entry local/session writes
- Playwright-backed sessions only

This MVP does not cover:

- IndexedDB
- per-key delete
- export/import files
- storage workflow automation

## API Shape

Inputs:

- `sessionId`
- `action: 'get' | 'set' | 'clear'`
- `target: 'cookies' | 'local' | 'session'`
- `cookies?: Array<object>` for cookie writes
- `entries?: Record<string, string>` for local/session writes

Outputs:

- `target`
- `action`
- `count`
- `cookies` for cookie reads
- `entries` for local/session reads
- `cleared` for clear actions

## Architecture

Reuse `PageController` as the main execution surface instead of duplicating raw Playwright calls in the V2 tool blueprint.

Add generic helpers in `PageController` for:

- `getStorage(kind)`
- `setStorageEntries(kind, entries)`
- `clearStorage(kind)`

Keep cookies on the existing `setCookies/getCookies/clearCookies` paths.

Expose `browser.storage` from the V2 browser tool group as an expert/legacy helper, keeping the core profile workflow-first.

## Testing

Integration:

- set/get/clear cookies
- set/get/clear localStorage
- set/get/clear sessionStorage

Unit:

- catalog presence
- core profile exclusion
