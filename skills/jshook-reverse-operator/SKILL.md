---
name: jshook-reverse-operator
description: Operate the JSHook Reverse Tool v2 MCP server for authorized JavaScript reverse-engineering and debugging work. Use this skill when a task involves collecting a site snapshot, tracing a request path, finding signing logic, generating hooks, resuming a prior investigation, or writing a structured reverse report from `sessionId`, `artifactId`, and `evidenceId` data.
---

# JSHook Reverse Operator

## Overview

Use this skill when the user wants workflow-first operation of the JSHook Reverse Tool v2 MCP server. Prefer `flow.*` tools, preserve the session and evidence chain, and only drop to expert tools when the workflow surface is not precise enough.

## Operating rules

- Stay within authorized research and debugging use cases.
- Start from the user's goal, not from the lowest-level tool.
- Prefer `flow.*` as the first tool choice.
- Default to `engine="auto"` for fresh site triage unless the user explicitly requests a browser engine.
- Treat browser instability, large sites, and heavy obfuscation as routing signals that can change the tool path.
- Keep track of `sessionId`, `artifactId`, and `evidenceId` in your notes and final answer.
- Reuse an existing session with `flow.resume-session` when the user already has session context.
- Use legacy flat tool names only when the user explicitly needs backward compatibility or `ENABLE_LEGACY_TOOLS=true`.

## Workflow decision tree

### Fresh investigation

Use `flow.collect-site` when the user says things like:

- "analyze this page"
- "open the site and see what scripts matter"
- "start a reverse pass"

Then choose the next workflow:

- request path or API focus -> `flow.trace-request`
- signing or crypto focus -> `flow.find-signature-path`
- hook generation -> `flow.generate-hook`
- consolidated summary -> `flow.reverse-report`

Engine routing for fresh work:

- default triage -> `engine="auto"` so the server can prefer Playwright first
- if the task becomes debugger-heavy, CDP-heavy, or function-tree focused -> recover or relaunch into Puppeteer
- if the browser becomes degraded -> use `browser.recover` before restarting the investigation

### Existing investigation

Use `flow.resume-session` when the user provides an existing `sessionId` or asks to continue earlier work. After resuming, prefer `flow.reverse-report` before going deeper so you can restate the current evidence chain.

### Expert fallback

Drop to grouped expert tools only when the workflows are too coarse:

- DOM or runtime details -> `inspect.*`
- breakpoints or watches -> `debug.*`
- source maps, diff, or fingerprints -> `analyze.*`
- direct hook lifecycle control -> `hook.*`
- session navigation or browser state -> `browser.*`

Read [`references/tool-routing.md`](./references/tool-routing.md) when you need detailed routing guidance.

## Reporting contract

When the user asks for findings, produce a structured reverse report with:

- scope and target summary
- session metadata
- key scripts or bundles
- network findings
- evidence-backed hypotheses
- unresolved gaps
- recommended next actions

If you want a stable scaffold, run [`scripts/render_reverse_report.py`](./scripts/render_reverse_report.py) and fill in the sections instead of inventing a format from scratch.

## References

- Read [`references/tool-routing.md`](./references/tool-routing.md) when deciding which tool family to call.
- Read [`references/playbooks.md`](./references/playbooks.md) when executing a full workflow end to end.
