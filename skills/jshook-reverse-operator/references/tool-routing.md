# Tool routing

Use this guide after the skill triggers and before choosing expert tools.

## Default order

1. Prefer `flow.*`.
2. If the workflow result is too broad, move to the matching grouped tool family.
3. Use legacy names only when compatibility is required and `ENABLE_LEGACY_TOOLS=true`.

## Task to tool map

| Task | Primary tool | Common follow-up | Expert fallback |
| --- | --- | --- | --- |
| Start a fresh investigation | `flow.collect-site` with `engine="auto"` | `flow.reverse-report` | `browser.navigate`, `inspect.scripts`, `inspect.network` |
| Continue prior work | `flow.resume-session` | `flow.reverse-report` | `browser.status` |
| Find request path | `flow.trace-request` | `inspect.network`, `inspect.interceptor` | `debug.breakpoint` or `debug.xhr` if a breakpoint is needed |
| Rank signing logic | `flow.find-signature-path` | `inspect.function-trace`, `analyze.bundle-fingerprint` | `inspect.scripts`, `analyze.rank-functions` |
| Generate a hook | `flow.generate-hook` | `hook.inject`, `hook.data` | `hook.generate` |
| Understand suspicious code | `analyze.understand` | `analyze.crypto` | `inspect.scripts`, `flow.reverse-report` |
| Detect crypto usage | `analyze.crypto` | `flow.find-signature-path` | `inspect.scripts`, `analyze.understand` |
| Find hot executed scripts | `analyze.coverage` | `inspect.scripts`, `analyze.rank-functions` | `flow.find-signature-path` |
| Interact with the page directly | `browser.interact` | `browser.status` | legacy page interaction tools only for compatibility |
| Manage cookies or web storage | `browser.storage` | `browser.status` | legacy storage tools only for compatibility |
| Capture the current page | `browser.capture` | `browser.status` | legacy screenshot tools only for compatibility |
| Apply anti-detection setup | `browser.stealth` | `browser.status` | legacy stealth tools only for compatibility |
| Detect or wait on captcha challenges | `browser.captcha` | `browser.status` | legacy captcha tools only for compatibility |
| Produce a report | `flow.reverse-report` | report handoff to the user | `inspect.*` or `analyze.*` to fill gaps |
| Inspect source maps | `analyze.source-map` | `analyze.script-diff` | `inspect.scripts` |
| Compare bundles | `analyze.script-diff` | `analyze.bundle-fingerprint` | `inspect.scripts` |
| Detect obfuscation | `analyze.obfuscation` | `analyze.deobfuscate` | `inspect.scripts`, `hook.*` |
| Recover from browser instability | `browser.recover` | `browser.status` | relaunch only if recovery fails |
| Manage session state | `browser.status` or `browser.close` | `flow.resume-session` | `browser.*` |

## When to prefer expert tools immediately

Start with grouped tools instead of `flow.*` when the user explicitly asks for:

- a DOM selector result
- a raw script list or source payload
- a runtime expression evaluation
- a breakpoint, pause, resume, or watch expression
- XHR, event-listener, or blackbox debugger controls
- a direct hook injection/export action

Prefer a Playwright session recovery before deep expert tools when the current session was created with `engine="auto"` and the task now requires:

- `debug.*`
- `inspect.scripts` function-tree extraction
- CDP-specific runtime behavior

## Notes on v2 outputs

Every v2 tool returns the same top-level envelope:

- `ok`
- `summary`
- `data`
- `detailId`
- `evidenceIds`
- `diagnostics`
- `nextActions`

Keep `detailId` and `evidenceIds` when summarizing or chaining work.

Additional v2.1 fields often present in browser and report flows:

- `health`
- `recoverable`
- `recoveryCount`
- `lastFailure`
- `engineCapabilities`
- `siteProfile`

## Legacy routing

Legacy flat tool names are no longer the default interface. Use them only when:

- the user refers to an older workflow by name
- a downstream environment still expects the legacy catalog
- the MCP server is running with `ENABLE_LEGACY_TOOLS=true`
