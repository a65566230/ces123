---
name: jshook-reverse-quickstart
description: Lightweight workflow-first entrypoint for common JSHook reverse-engineering tasks. Use it when the goal is to triage a site, trace a request, find signing logic, generate a hook, or resume a session without dropping into expert tooling too early.
---

# JSHook Reverse Quickstart

## Overview

Use this skill when the task is a common JSHook workflow and the user does not need deep debugger control up front. Prefer the highest-level workflow that can answer the question, keep the evidence chain intact, and only escalate to `$jshook-reverse-operator` when the workflow surface is too coarse.

## Defaults

- Start from `flow.collect-site` for fresh work.
- Resume prior work with `flow.resume-session`.
- Prefer workflow tools over grouped expert tools.
- When using `inspect.scripts`, `inspect.network`, or `flow.trace-request`, prefer `responseMode="compact"` first.
- Keep `sessionId`, `artifactId`, `detailId`, and `evidenceIds` in notes and summaries.

## Fast routing

- first-pass site triage -> `flow.collect-site`
- request formation or network focus -> `flow.trace-request`
- signature, token, or crypto focus -> `flow.find-signature-path`
- generate a reusable observation hook -> `flow.generate-hook`
- checkpoint or handoff summary -> `flow.reverse-report`
- continue an existing session -> `flow.resume-session`

## Escalation rules

Escalate from this skill to `$jshook-reverse-operator` when the user explicitly needs:

- `debug.breakpoint`, `debug.watch`, `debug.xhr`, `debug.event`, `debug.blackbox`, `inspect.function-trace`, or `inspect.interceptor`
- direct `inspect.scripts` function-tree work
- manual `hook.generate` or `hook.inject`
- multi-step expert debugging beyond the default workflows

## Reporting contract

For quickstart tasks, keep the response short but evidence-backed:

- user goal
- current session or artifact ids
- key finding
- next suggested action

Read [`references/tool-routing.md`](./references/tool-routing.md) for the short intent map and [`references/playbooks.md`](./references/playbooks.md) for lightweight playbooks.
