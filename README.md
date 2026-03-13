# JSHook Reverse Tool v2 (a65566230 fork)

Structured MCP tooling for authorized JavaScript reverse engineering, browser debugging, hook generation, and evidence-driven analysis.

This repository is the `a65566230/ces123` fork and ships a Playwright-only v2 runtime.

Version 2 is a breaking upgrade focused on three goals:

- productized stability for build, test, package, and release
- deeper reverse-engineering support with source maps, script diffing, fingerprints, and hook workflows
- better agent ergonomics through workflow-first tools and a paired Codex skill

## What changed in v2

- Thin `V2MCPServer` with a layered runtime: tool registry, tool executor, session lifecycle, and capability modules.
- Workflow-first tool surface grouped into `browser.*`, `inspect.*`, `debug.*`, `analyze.*`, `hook.*`, and `flow.*`.
- A Playwright-backed browser pool with workflow-first runtime compatibility layers.
- Structured response envelope for every v2 tool:

```json
{
  "ok": true,
  "summary": "Human-readable status",
  "data": {},
  "detailId": "artifact_xxx",
  "evidenceIds": ["evidence_xxx"],
  "diagnostics": [],
  "nextActions": []
}
```

- Stable entity model across workflows: `sessionId`, `artifactId`, and `evidenceId`.
- Local fixture-driven tests so CI never depends on live third-party sites.
- Paired Codex skills at [`skills/jshook-reverse-quickstart`](./skills/jshook-reverse-quickstart) and [`skills/jshook-reverse-operator`](./skills/jshook-reverse-operator) for lightweight and expert agent workflows.

## Default workflow entrypoints

Use these first. Drop to expert tools only when the workflow tools are not specific enough.

- `flow.collect-site`: launch or reuse a session, navigate, and collect the first-pass snapshot
- `flow.find-signature-path`: rank likely signing and crypto paths
- `flow.trace-request`: correlate captured network activity with the request path under investigation
- `flow.generate-hook`: turn a target primitive into a reusable hook template
- `flow.reverse-report`: produce a structured summary of the current session and evidence chain
- `flow.resume-session`: restore context from an existing session

## Tool groups

- `browser.*`: session lifecycle, navigation, status, grouped page interactions, grouped page storage, page capture, stealth, and captcha reachability helpers
- `inspect.*`: DOM, scripts, network, runtime state, function tracing, and request interception
- `debug.*`: `debug.control`, `debug.breakpoint`, `debug.watch`, `debug.xhr`, `debug.event`, `debug.blackbox`, and `debug.evaluate`
- `analyze.*`: source maps, script diff, bundle fingerprints, ranked functions, code understanding, crypto analysis, coverage analysis, and deobfuscation
- `hook.*`: template generation, injection, and captured data retrieval
- `flow.*`: high-level investigation playbooks for agents

Legacy flat tool names remain available only when `ENABLE_LEGACY_TOOLS=true`.
Treat those aliases as compatibility-only shims; new workflow guidance and response payloads now target grouped v2 tools such as `debug.*` and `inspect.*`.

## Capability surfaces

- Default compatibility surface: `JSHOOK_TOOL_PROFILE=expert`, which keeps the full v2 catalog available, including the direct debug expert helpers.
- Compact surface: `JSHOOK_TOOL_PROFILE=core`, which keeps the workflow-first tools and hides direct expert helpers such as `browser.interact`, `browser.storage`, `browser.capture`, `browser.stealth`, `browser.captcha`, `debug.breakpoint`, `debug.watch`, `debug.xhr`, `debug.event`, `debug.blackbox`, `inspect.function-trace`, `inspect.interceptor`, `analyze.*`, and `hook.*`.
- Legacy compatibility surface: `JSHOOK_TOOL_PROFILE=legacy` or `ENABLE_LEGACY_TOOLS=true`, which enables the legacy flat aliases in addition to the full v2 surface.
- Code-present but not default-v2: some modules still exist in the repository without a first-class v2 tool entrypoint. Treat those as implementation inventory, not as guaranteed default surface area.

## Response shaping

- `inspect.scripts`, `inspect.network`, and `flow.trace-request` accept `responseMode="compact"` to turn repeated object arrays into a columnar table shape before artifact externalization.
- The default remains `responseMode="full"` for compatibility.

## Install the MCP server

### Option 1: `npx`

```bash
npx -y jshook-reverse-tool
```

### Option 2: global install

```bash
npm install -g jshook-reverse-tool
jshook-reverse-tool
```

### Option 3: run from source

```bash
npm install
npm run build
node dist/index.js
```

## MCP client config

Example `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "jshook-reverse-tool"],
      "env": {
        "DEFAULT_LLM_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-...",
        "PLAYWRIGHT_EXECUTABLE_PATH": "/path/to/chrome-or-edge"
      }
    }
  }
}
```

For source installs, swap the command to `node` and point `args` at `dist/index.js`.

## Install the Codex skill

The paired skills live in:

- [`skills/jshook-reverse-quickstart`](./skills/jshook-reverse-quickstart) for common workflow-first investigations
- [`skills/jshook-reverse-operator`](./skills/jshook-reverse-operator) for deeper expert routing and reporting

Use one of these approaches:

1. Install the folder with your Codex skill installer.
2. Copy the folder into `$CODEX_HOME/skills/jshook-reverse-operator`.
3. Reference the repo path directly if your environment supports repo-backed skill installs.

The skills do not duplicate MCP code. They teach routing and reporting:

- `jshook-reverse-quickstart`: quick intent routing, compact-first grouped tools, and escalation to the operator skill
- `jshook-reverse-operator`: full workflow routing, expert fallback paths, and structured reverse reports with evidence and next actions

Recommended default: start with `jshook-reverse-quickstart`, then escalate to `jshook-reverse-operator` only when the workflow-first surface is not enough.

## Environment

Start from [`.env.example`](./.env.example). The most important settings are:

- `DEFAULT_LLM_PROVIDER`
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- `OPENAI_BASE_URL` for custom OpenAI-compatible gateways such as `https://ai.changyou.club/v1`
- `OPENAI_WIRE_API=responses` when using the GPT-5.4 custom profile
- `ENABLE_LEGACY_TOOLS`
- `JSHOOK_TOOL_PROFILE`
- `PLAYWRIGHT_EXECUTABLE_PATH` when Playwright cannot auto-resolve Chromium

## Development

```bash
npm install
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
npm run report:tool-catalog
npm run benchmark:v2:fixtures
npm run evaluate:mcp2cli
npm run summarize:real-benchmarks
npm run verify:manifest
npm run verify:skill
npm run package:smoke
npm run check
```

`npm run benchmark:v2:fixtures` uses the local fixture site to compare `full` vs `compact` response sizes for a few high-frequency tools. Treat the output as empirical guidance, not as a universal guarantee: some payloads shrink in compact mode and some do not.

For the next evaluation layer, see:

- [`docs/benchmarking/real-mcp-client-benchmark.md`](./docs/benchmarking/real-mcp-client-benchmark.md)
- [`docs/integrations/mcp2cli-evaluation.md`](./docs/integrations/mcp2cli-evaluation.md)
- [`docs/skills/default-entrypoint.md`](./docs/skills/default-entrypoint.md)
- [`docs/plans/STATUS.md`](./docs/plans/STATUS.md) for the current effective planning and analysis surface

Real-client benchmark JSON data can be stored in [`benchmarks/real-clients`](./benchmarks/real-clients), then aggregated with `npm run summarize:real-benchmarks`.

## Test strategy

- unit tests for envelopes, tool catalog, and analysis helpers
- integration tests for Playwright-backed flows
- local fixtures for:
  - basic pages
  - source-map bundles
  - diagnostic and environment-probing samples
- package and manifest smoke tests
- skill structure validation

## Repository layout

```text
src/server/V2MCPServer.ts              Thin MCP server bootstrap
src/server/v2/                         v2 runtime, tools, analysis, browser adapters
tests/fixtures/                        Local pages used by integration tests
skills/jshook-reverse-operator/        Paired Codex skill
scripts/                               Verification and packaging helpers
```

## Responsible use

This project is for authorized research, debugging, and reverse-engineering workflows. The v2 design intentionally focuses on diagnostics, evidence capture, and reproducible analysis rather than site-specific bypass logic.
