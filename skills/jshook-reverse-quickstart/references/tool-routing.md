# Quickstart routing

Use this map when the goal is clear and you want the shortest path through the workflow tools.

## Intent to tool map

| Intent | Primary tool | Common follow-up |
| --- | --- | --- |
| Open a site and inspect what matters | `flow.collect-site` | `flow.reverse-report` |
| Continue a prior session | `flow.resume-session` | `flow.reverse-report` |
| Understand a request path | `flow.trace-request` | `inspect.network` with `responseMode="compact"` |
| Find likely signing logic | `flow.find-signature-path` | `analyze.crypto` or `analyze.understand` |
| Generate an observation hook | `flow.generate-hook` | `hook.data` |
| Get a concise checkpoint | `flow.reverse-report` | hand the result to the user |

## Compact-first rule

When you need grouped expert tools, prefer compact payloads first:

- `inspect.scripts` with `responseMode="compact"`
- `inspect.network` with `responseMode="compact"`
- `flow.trace-request` with `responseMode="compact"`

## Escalate to operator

Switch to `$jshook-reverse-operator` if you need:

- `debug.breakpoint`
- `debug.watch`
- `debug.xhr`
- `debug.event`
- `debug.blackbox`
- `hook.generate` or `hook.inject`
