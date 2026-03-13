# Quickstart playbooks

## Fresh page triage

1. Run `flow.collect-site`.
2. Keep the returned `sessionId`, `artifactId`, and `evidenceIds`.
3. Run `flow.reverse-report`.
4. Continue with the narrowest matching workflow.

## Request-first workflow

1. Start with `flow.trace-request`.
2. If more detail is needed, run `inspect.network` with `responseMode="compact"`.
3. Escalate to `$jshook-reverse-operator` if debugger control is required.

## Signature-first workflow

1. Start with `flow.find-signature-path`.
2. Inspect the top candidate.
3. Use `analyze.crypto` or `analyze.understand` only if the workflow result still leaves key unknowns.
4. Generate a hook with `flow.generate-hook` if direct observation is better than more static reading.

## Resume and handoff

1. Run `flow.resume-session`.
2. Run `flow.reverse-report`.
3. Return the current finding with ids and the next action.
