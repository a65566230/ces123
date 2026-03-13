# mcp2cli Evaluation

This document explains how to test `mcp2cli` against the JSHook Reverse Tool and what decision should come out of that test.

## Why evaluate it

`mcp2cli` may reduce tool-schema overhead in shell-first clients, but it does not automatically solve:

- large tool responses
- session/evidence/report design
- workflow routing quality

So the decision is not “does `mcp2cli` save tokens in theory?” but:

> Does it make this project better for the target clients we care about?

## Test modes

Evaluate these modes:

### Mode 1: Native MCP

Use the MCP server normally with:

- `JSHOOK_TOOL_PROFILE=core`
- `JSHOOK_TOOL_PROFILE=expert`

### Mode 2: mcp2cli over stdio

Point `mcp2cli` at the local server process:

```bash
mcp2cli --mcp-stdio "node dist/index.js" --list
```

For persistent work, prefer session mode if the client/environment supports it.

### Mode 3: mcp2cli plus client workflow

Run the same scenarios from the benchmark runbook through the real client while the client shells out to `mcp2cli`.

## What to verify

### Functional fit

- Does `sessionId` remain usable across the workflow?
- Can the agent still retrieve `artifactId`, `detailId`, and `evidenceIds` reliably?
- Do `flow.*` tools remain the main path?

### Efficiency fit

- Is the client actually paying less context cost over a long session?
- Does the client spend too many extra turns on `--list` / `--help`?

### Operational fit

- Are env vars and auth easy to pass through?
- Does session mode behave well on the target OS?
- Is failure handling understandable to users?

## Go / no-go criteria

Recommend official companion support if all of these are true:

- common workflows still succeed reliably
- session-heavy work is not degraded
- total session overhead is meaningfully lower in the target client
- the support burden is acceptable

Do not recommend it as the default entry if any of these are true:

- agents lose the evidence chain
- session handling is brittle
- the workflow-first design gets replaced by low-level shell discovery churn

## Recommended positioning

Current recommended positioning is:

- native MCP remains the primary supported runtime
- `mcp2cli` is an optional companion for shell-first clients after real-client benchmarking confirms value

## Local validation already completed in this repo

The repository now includes `npm run evaluate:mcp2cli`, which performs a real local stdio validation against `node dist/index.js` and checks:

- tool discovery via `--list`
- help output for `analyze.crypto`
- a real `analyze.crypto` invocation through `mcp2cli`

Current local findings:

- `mcp2cli` works against this server over stdio
- MCP tool names stay dotted rather than converting to kebab-case
- boolean flags behave like normal CLI flags and should not be passed as `--flag=false` in the tested invocation style

This is still not the same as a long-session real-client benchmark, but it removes “basic local interoperability” from the unknown list.
