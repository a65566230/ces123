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
| Find request path | `flow.trace-request` | `inspect.network` | `debug.*` if a breakpoint is needed |
| Rank signing logic | `flow.find-signature-path` | `analyze.bundle-fingerprint` | `inspect.scripts`, `analyze.function-rank` |
| Generate a hook | `flow.generate-hook` | `hook.inject`, `hook.get-data` | `hook.template`, `hook.export` |
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
- a direct hook injection/export action

Prefer a Puppeteer-backed recovery before deep expert tools when the current session was created with `engine="auto"` and the task now requires:

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
