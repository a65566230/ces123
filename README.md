# JSHook Reverse Tool v2

Structured MCP tooling for authorized JavaScript reverse engineering, browser debugging, hook generation, and evidence-driven analysis.

Version 2 is a breaking upgrade focused on three goals:

- productized stability for build, test, package, and release
- deeper reverse-engineering support with source maps, script diffing, fingerprints, and hook workflows
- better agent ergonomics through workflow-first tools and a paired Codex skill

## What changed in v2

- Thin `V2MCPServer` with a layered runtime: tool registry, tool executor, session lifecycle, and capability modules.
- Workflow-first tool surface grouped into `browser.*`, `inspect.*`, `debug.*`, `analyze.*`, `hook.*`, and `flow.*`.
- Dual browser engine abstraction with Puppeteer and Playwright adapters behind a shared `BrowserEngine` interface.
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
- Paired Codex skill at [`skills/jshook-reverse-operator`](./skills/jshook-reverse-operator) for repeatable agent workflows.

## Default workflow entrypoints

Use these first. Drop to expert tools only when the workflow tools are not specific enough.

- `flow.collect-site`: launch or reuse a session, navigate, and collect the first-pass snapshot
- `flow.find-signature-path`: rank likely signing and crypto paths
- `flow.trace-request`: correlate captured network activity with the request path under investigation
- `flow.generate-hook`: turn a target primitive into a reusable hook template
- `flow.reverse-report`: produce a structured summary of the current session and evidence chain
- `flow.resume-session`: restore context from an existing session

## Tool groups

- `browser.*`: session lifecycle, navigation, status
- `inspect.*`: DOM, scripts, network, console, runtime state
- `debug.*`: breakpoints, pause/resume, watches, runtime inspection
- `analyze.*`: source maps, script diff, bundle fingerprints, ranked functions
- `hook.*`: template generation, injection, export, and captured data retrieval
- `flow.*`: high-level investigation playbooks for agents

Legacy flat tool names remain available only when `ENABLE_LEGACY_TOOLS=true`.

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
        "BROWSER_ENGINE": "puppeteer"
      }
    }
  }
}
```

For source installs, swap the command to `node` and point `args` at `dist/index.js`.

## Install the Codex skill

The paired skill lives in [`skills/jshook-reverse-operator`](./skills/jshook-reverse-operator).

Use one of these approaches:

1. Install the folder with your Codex skill installer.
2. Copy the folder into `$CODEX_HOME/skills/jshook-reverse-operator`.
3. Reference the repo path directly if your environment supports repo-backed skill installs.

The skill does not duplicate MCP code. It teaches routing and reporting:

- classify the task
- prefer `flow.*`
- fall back to expert tools only when necessary
- return a structured reverse report with evidence and next actions

## Environment

Start from [`.env.example`](./.env.example). The most important settings are:

- `DEFAULT_LLM_PROVIDER`
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- `BROWSER_ENGINE`
- `ENABLE_LEGACY_TOOLS`
- `PLAYWRIGHT_EXECUTABLE_PATH` when Playwright cannot auto-resolve Chromium

## Development

```bash
npm install
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
npm run verify:manifest
npm run verify:skill
npm run package:smoke
npm run check
```

## Test strategy

- unit tests for envelopes, tool catalog, and analysis helpers
- integration tests for Puppeteer and Playwright flows
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
