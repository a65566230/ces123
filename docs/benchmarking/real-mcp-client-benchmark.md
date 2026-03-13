# Real MCP Client Benchmark

This runbook is for the work that cannot be proven from fixture-only tests: long-session token and context behavior inside real MCP clients such as Claude Desktop, Codex, or other MCP-capable shells.

## Goal

Measure the real tradeoffs between:

- `JSHOOK_TOOL_PROFILE=core`
- `JSHOOK_TOOL_PROFILE=expert`
- `JSHOOK_TOOL_PROFILE=legacy`
- `responseMode="full"`
- `responseMode="compact"`
- optional `mcp2cli` access

The output should answer three questions:

1. How much prompt/context cost does each surface create in the real client?
2. Which response mode is actually better for each high-frequency tool?
3. At what point does the user or agent lose context and need stronger summaries or artifact retrieval?

## What to measure

Per run, capture:

- client name and version
- model name
- surface: `core`, `expert`, or `legacy`
- transport: native MCP or `mcp2cli`
- scenario name
- turn count
- total prompt/input tokens if the client exposes them
- total output tokens if the client exposes them
- number of tool calls
- number of repeated tool-list or help/discovery calls
- whether the task completed successfully
- whether the agent lost context, repeated work, or forgot prior evidence

If the client does not expose token numbers directly, still record:

- prompt or conversation size if available
- serialized tool catalog size from `npm run report:tool-catalog`
- qualitative signs of context pressure

## Standard scenarios

Use the same scenarios across clients.

### Scenario A: Fresh triage

1. Start with `flow.collect-site`
2. Run `flow.reverse-report`
3. Stop after the first checkpoint

### Scenario B: Request tracing

1. Run `flow.collect-site`
2. Run `flow.trace-request`
3. If needed, run `inspect.network`

Run once with `responseMode="full"` and once with `responseMode="compact"`.

### Scenario C: Signature path

1. Run `flow.collect-site`
2. Run `flow.find-signature-path`
3. Run `analyze.crypto` or `analyze.understand`

### Scenario D: Expert debug

1. Run `flow.collect-site`
2. Enable debugging
3. Use `debug.breakpoint`, `debug.watch`, and `debug.xhr`

This scenario is especially important for `core` vs `expert`, because `core` should force the client to stay on the workflow path longer.

## Client matrix

Minimum recommended matrix:

- Claude Desktop + native MCP
- Codex desktop/CLI + native MCP
- one shell-first client using `mcp2cli`

Run each scenario at least:

- once with `JSHOOK_TOOL_PROFILE=core`
- once with `JSHOOK_TOOL_PROFILE=expert`
- once with native MCP
- once with `mcp2cli` if that client supports it

## Repo-side preparation

Before running client benchmarks:

1. Run `npm run lint`
2. Run `npm run typecheck`
3. Run `npm run verify`
4. Run `npm test`
5. Run `npm run report:tool-catalog`
6. Run `npm run benchmark:v2:fixtures`

The last two commands provide the local baseline so the real-client results can be compared against something reproducible.

## Decision rules

Use these rules when reading results:

- choose `core` as the recommended default if it noticeably reduces prompt/context burden without blocking common tasks
- keep `expert` as the recommended default if real users immediately need direct debugger or analysis tools
- only recommend `compact` by default for a tool when it is repeatedly smaller in the real client and does not hurt task completion
- treat `mcp2cli` as a companion layer only if it improves total session efficiency without breaking session-heavy workflows

## Expected deliverables

At the end of a benchmark round, write down:

- the winning default profile
- the winning response mode per tool family
- whether `mcp2cli` is worth official support
- any client-specific caveats

If token numbers are incomplete, say so explicitly and keep the conclusion provisional.
