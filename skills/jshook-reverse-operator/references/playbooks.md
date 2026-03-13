# Playbooks

Use these playbooks when a task is broad enough that you need a repeatable sequence.

## Fresh site triage

Goal: build a first-pass picture of an unfamiliar target.

1. Call `flow.collect-site` with `engine="auto"` and `collectionStrategy="manifest"` unless the user already knows they need deeper collection.
2. Review the returned `sessionId`, `artifactId`, `evidenceIds`, `manifest`, and `siteProfile`.
3. Call `flow.reverse-report` with `focus="overview"`.
4. If the report points to a likely script or request path, branch into one of the playbooks below.

## Large-site triage

Goal: keep large investigations stable and searchable without flooding the context window.

1. Start with `flow.collect-site` using `collectionStrategy="manifest"`.
2. Review `siteProfile.totalScripts`, `manifest.usage`, and browser `health`.
3. Use `inspect.scripts` with `searchMode="indexed"` before pulling full source.
4. Retrieve chunks or source only for hot scripts instead of loading everything.
5. Checkpoint with `flow.reverse-report` before going deeper.

## Browser recovery

Goal: recover a useful session after a disconnect, page close, or degraded browser state.

1. Check `browser.status` for `health`, `recoverable`, and `lastFailure`.
2. Call `browser.recover`.
3. Re-check `browser.status`.
4. Resume with the narrowest next step, usually `flow.reverse-report` or `inspect.scripts`.
5. Start a fresh session only if recovery fails repeatedly.

## Request tracing

Goal: understand how a request is formed and where it is sent.

1. Start with `flow.trace-request`.
2. If the returned network evidence is enough, summarize it.
3. If not, inspect raw traffic with `inspect.network`.
4. If runtime correlation is needed, use `debug.breakpoint`, `debug.watch`, or `debug.xhr` around the relevant request path.

## Signature path discovery

Goal: rank likely signing or token generation code.

1. Start with `flow.find-signature-path`.
2. Inspect the top candidate script or function.
3. Use `analyze.bundle-fingerprint`, `analyze.source-map`, or `analyze.script-diff` if the bundle needs more context.
4. If direct observation is better than static reading, generate a hook with `flow.generate-hook`.

## Heavy deobfuscation

Goal: move from detection to staged cleanup without overcommitting to deep VM work too early.

1. Start with `analyze.obfuscation`.
2. Review detected techniques, static passes, and whether the sample is a VM candidate.
3. Run `analyze.deobfuscate`.
4. Escalate to hooks or runtime tracing only when the staged result still leaves critical unknowns.
5. Preserve `evidenceIds` and summarize what is fact versus inference.

## Hook workflow

Goal: observe arguments, return values, or side effects around a target API or function.

1. Generate the hook with `flow.generate-hook`.
2. Inject or export with `hook.*` if the workflow tool does not finish the job.
3. Reproduce the behavior in the page.
4. Retrieve captured data with `hook.data`.
5. Add the important observations to the report with evidence references.

## Reverse report

Goal: deliver a clear handoff or checkpoint summary.

1. Call `flow.reverse-report`.
2. If the report is missing key detail, fill the gaps with the smallest grouped tool needed.
3. Preserve the evidence chain in the final response.
4. End with next actions that match the current investigation state.

## Resume and continue

Goal: continue work without losing context.

1. Call `flow.resume-session`.
2. Restate what is already known from artifacts and evidence.
3. Call `flow.reverse-report` for a current snapshot.
4. Continue with the narrowest playbook that matches the user's next question.
