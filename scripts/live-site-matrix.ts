import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { config as dotenvConfig } from 'dotenv';
import { pathToFileURL } from 'url';

type RuntimeMode = 'source' | 'dist';
type SurfaceMode = 'v2' | 'legacy' | 'all';

type MatrixEntry = {
  tool: string;
  ok: boolean;
  durationMs: number;
  args?: Record<string, unknown>;
  summary?: string;
  error?: string;
};

type MatrixSummary = {
  targetUrl: string;
  surface: SurfaceMode;
  runtimeMode: RuntimeMode;
  startedAt: string;
  finishedAt: string;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  entries: MatrixEntry[];
};

type MatrixOptions = {
  url: string;
  runtimeMode: RuntimeMode;
  surface: SurfaceMode;
  repeat: number;
  outputDir?: string;
  toolPattern?: string;
  toolTimeoutMs: number;
};

type LoadedServer = {
  close: () => Promise<void>;
  executor: {
    execute: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  };
  registry: {
    listTools: () => Array<{ name: string }>;
  };
};

type MatrixContext = {
  options: MatrixOptions;
  server: LoadedServer;
  toolNames: Set<string>;
  outputDir: string;
  state: {
    sessionId?: string;
    artifactId?: string;
    evidenceId?: string;
    hookId?: string;
    legacyReady?: boolean;
    legacyDebuggerEnabled?: boolean;
    legacySavedSessionPath?: string;
    legacyDetailId?: string;
    legacyScriptTarget?: {
      scriptId?: string;
      url?: string;
      functionName?: string;
      lineNumber?: number;
    };
    legacyNetworkRequestId?: string;
    legacyScriptsPrimed?: boolean;
    legacyWatchId?: string;
    legacyXHRBreakpointId?: string;
    legacyEventBreakpointId?: string;
  };
};

const MATRIX_MARKER = 'JSHOOK_MATRIX_MARKER';
const LEGACY_DEBUG_SCRIPT = [
  `function matrixHarnessBreakpoint(value) { const payload = { value, marker: "${MATRIX_MARKER}" }; return payload.value + 1; }`,
  'function matrixHarnessHelper() { return "matrix"; }',
  '//# sourceURL=matrix-harness.js',
].join('\n');

const HARNESS_INSTALL_EXPRESSION = `(() => {
  if (window.__jshookTestHarness) {
    return { ready: true, marker: window.__jshookTestHarness.marker };
  }
  const root = document.createElement('div');
  root.id = 'jshook-test-root';
  root.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483647;padding:12px;background:#fff;border:1px solid #222;color:#111;';
  const button = document.createElement('button');
  button.id = 'jshook-test-button';
  button.type = 'button';
  button.textContent = 'JSHook Action';
  const input = document.createElement('input');
  input.id = 'jshook-test-input';
  const select = document.createElement('select');
  select.id = 'jshook-test-select';
  const alphaOption = document.createElement('option');
  alphaOption.value = 'alpha';
  alphaOption.textContent = 'alpha';
  const betaOption = document.createElement('option');
  betaOption.value = 'beta';
  betaOption.textContent = 'beta';
  select.append(alphaOption, betaOption);
  const hover = document.createElement('div');
  hover.id = 'jshook-test-hover';
  hover.textContent = 'hover target';
  root.append(button, input, select, hover);
  document.body.appendChild(root);
  try {
    const script = document.createElement('script');
    script.id = 'jshook-test-script';
    script.textContent = ${JSON.stringify(LEGACY_DEBUG_SCRIPT)};
    document.body.appendChild(script);
  } catch (_error) {
    // Trusted Types or CSP can block inline script injection on hardened sites.
  }
  window.__jshookTestHarness = {
    marker: '${MATRIX_MARKER}',
    state: { buttonClicks: 0, typedValue: '', selectedValue: 'alpha', hovered: false },
    ping() { return 'pong'; },
    multiply(a, b) { return a * b; },
    breakpointTarget(value) { const frame = { value, nested: { ok: true } }; return frame.value + 1; },
    triggerFetch() { return fetch(location.href, { credentials: 'same-origin' }).then((response) => response.status); }
  };
  button.addEventListener('click', () => { window.__jshookTestHarness.state.buttonClicks += 1; console.log('matrix click'); });
  input.addEventListener('input', (event) => { window.__jshookTestHarness.state.typedValue = event.target.value; });
  select.addEventListener('change', (event) => { window.__jshookTestHarness.state.selectedValue = event.target.value; });
  hover.addEventListener('mouseenter', () => { window.__jshookTestHarness.state.hovered = true; });
  return { ready: true, marker: window.__jshookTestHarness.marker };
})()`;

export function classifyToolSurface(toolName: string): 'v2' | 'legacy' {
  return toolName.includes('.') ? 'v2' : 'legacy';
}

export function renderMarkdownSummary(summary: MatrixSummary): string {
  const lines = [
    '# Live Site Matrix',
    '',
    `- Target: ${summary.targetUrl}`,
    `- Surface: ${summary.surface}`,
    `- Runtime: ${summary.runtimeMode}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Total: ${summary.totals.total}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    `- Skipped: ${summary.totals.skipped}`,
    '',
    '| Tool | Status | Duration (ms) | Notes |',
    '| --- | --- | ---: | --- |',
  ];

  for (const entry of summary.entries) {
    lines.push(`| ${entry.tool} | ${entry.ok ? 'PASS' : 'FAIL'} | ${entry.durationMs} | ${entry.error || entry.summary || ''} |`);
  }

  return lines.join('\n');
}

function resolveRepoRoot() {
  return process.cwd();
}

function resolveSharedEnvPath(repoRoot: string) {
  const worktreeMarker = `${path.sep}.worktrees${path.sep}`;
  if (repoRoot.includes(worktreeMarker)) {
    return path.join(repoRoot.split(worktreeMarker)[0], '.env');
  }
  return path.join(repoRoot, '.env');
}

function parseArgs(argv: string[]): MatrixOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }
    const [key, inlineValue] = item.split('=');
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      index += 1;
    }
  }

  return {
    url: values.get('--url') || 'https://www.douyin.com/jingxuan',
    runtimeMode: (values.get('--runtime') as RuntimeMode) || 'source',
    surface: (values.get('--surface') as SurfaceMode) || 'all',
    repeat: Math.max(1, Number(values.get('--repeat') || 1)),
    outputDir: values.get('--output-dir') || undefined,
    toolPattern: values.get('--tool-pattern') || undefined,
    toolTimeoutMs: Math.max(1000, Number(values.get('--tool-timeout-ms') || 20000)),
  };
}

async function loadServer(repoRoot: string, runtimeMode: RuntimeMode): Promise<LoadedServer> {
  const serverEntry = runtimeMode === 'dist'
    ? path.join(repoRoot, 'dist', 'server', 'V2MCPServer.js')
    : path.join(repoRoot, 'src', 'server', 'V2MCPServer.ts');
  const configEntry = runtimeMode === 'dist'
    ? path.join(repoRoot, 'dist', 'utils', 'config.js')
    : path.join(repoRoot, 'src', 'utils', 'config.ts');

  const [{ V2MCPServer }, { getConfig }] = await Promise.all([
    import(pathToFileURL(serverEntry).href),
    import(pathToFileURL(configEntry).href),
  ]);

  return new V2MCPServer(getConfig()) as LoadedServer;
}

function parseToolPayload(response: { content: Array<{ type: string; text: string }> }) {
  const text = response.content.find((item) => item.type === 'text')?.text;
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { rawText: text };
  }
}

function normalizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      summary: undefined,
      error: 'Empty tool payload',
    };
  }
  if (typeof payload.ok === 'boolean') {
    return {
      ok: payload.ok,
      summary: typeof payload.summary === 'string' ? payload.summary : undefined,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    };
  }
  if (typeof payload.success === 'boolean') {
    return {
      ok: payload.success,
      summary: typeof payload.message === 'string' ? payload.message : undefined,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    };
  }
  return {
    ok: true,
    summary: typeof payload.message === 'string' ? payload.message : undefined,
    error: undefined,
  };
}

async function executeTool(ctx: MatrixContext, name: string, args: Record<string, unknown> = {}) {
  return parseToolPayload(await ctx.server.executor.execute(name, args));
}

async function ensureV2Session(ctx: MatrixContext) {
  if (ctx.state.sessionId) {
    return ctx.state.sessionId;
  }
  const launch = await executeTool(ctx, 'browser.launch', { engine: 'auto', label: 'douyin-live-matrix' });
  ctx.state.sessionId = launch.sessionId as string;
  return ctx.state.sessionId!;
}

async function ensureV2Collected(ctx: MatrixContext) {
  const sessionId = await ensureV2Session(ctx);
  if (!ctx.state.artifactId) {
    const collect = await executeTool(ctx, 'flow.collect-site', {
      sessionId,
      url: ctx.options.url,
      waitProfile: 'interactive',
      collectionStrategy: 'manifest',
    });
    ctx.state.artifactId = collect.artifactId as string;
    if (Array.isArray(collect.evidenceIds) && collect.evidenceIds.length > 0) {
      ctx.state.evidenceId = collect.evidenceIds[0] as string;
    }
  }
  await executeTool(ctx, 'inspect.runtime', {
    sessionId,
    expression: HARNESS_INSTALL_EXPRESSION,
  });
  return sessionId;
}

async function ensureLegacyReady(ctx: MatrixContext) {
  if (ctx.state.legacyReady) {
    return;
  }
  if (!ctx.toolNames.has('browser_launch')) {
    return;
  }
  await executeTool(ctx, 'browser_launch', {});
  if (ctx.toolNames.has('network_enable')) {
    await executeTool(ctx, 'network_enable', {});
  }
  await executeTool(ctx, 'page_navigate', {
    url: ctx.options.url,
    waitUntil: 'domcontentloaded',
    enableNetworkMonitoring: true,
  });
  const injectResult = await executeTool(ctx, 'page_evaluate', { code: HARNESS_INSTALL_EXPRESSION });
  if (!injectResult || Object.keys(injectResult).length === 0) {
    await executeTool(ctx, 'page_inject_script', { script: HARNESS_INSTALL_EXPRESSION });
  }
  ctx.state.legacyReady = true;
}

async function ensureLegacyHarness(ctx: MatrixContext) {
  await ensureLegacyReady(ctx);
  await executeTool(ctx, 'page_evaluate', { code: HARNESS_INSTALL_EXPRESSION });
}

function isLegacyDebuggerTool(tool: string) {
  return tool.startsWith('debugger_')
    || tool.startsWith('breakpoint_')
    || tool.startsWith('watch_')
    || tool.startsWith('xhr_breakpoint_')
    || tool.startsWith('event_breakpoint_')
    || tool.startsWith('blackbox_')
    || ['get_call_stack', 'get_object_properties', 'get_scope_variables_enhanced', 'search_in_scripts', 'extract_function_tree', 'get_all_scripts', 'get_script_source'].includes(tool);
}

function needsLegacyPausedState(tool: string) {
  return [
    'debugger_evaluate',
    'get_call_stack',
    'get_scope_variables_enhanced',
    'get_object_properties',
    'debugger_step_into',
    'debugger_step_out',
    'debugger_step_over',
    'debugger_resume',
    'debugger_wait_for_paused',
  ].includes(tool);
}

async function ensureLegacyDebugger(ctx: MatrixContext) {
  if (!ctx.state.legacyDebuggerEnabled) {
    const enabled = await executeTool(ctx, 'debugger_enable', {});
    ctx.state.legacyDebuggerEnabled = enabled?.success === true;
  }
}

async function ensureLegacyPausedState(ctx: MatrixContext) {
  await ensureLegacyDebugger(ctx);
  const waitTimeout = Math.min(Math.max(ctx.options.toolTimeoutMs, 5000), 15000);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await executeTool(ctx, 'debugger_pause', {});
    const paused = await executeTool(ctx, 'debugger_wait_for_paused', { timeout: waitTimeout });
    if (paused?.paused === true) {
      return;
    }
  }
  throw new Error('Unable to enter paused state');
}

async function ensureLegacyHookData(ctx: MatrixContext) {
  await ensureLegacyHarness(ctx);
  if (!ctx.state.hookId) {
    ctx.state.hookId = 'legacy-matrix-hook';
    await executeTool(ctx, 'ai_hook_inject', {
      hookId: ctx.state.hookId,
      code: `(() => {
        const hookId = '${ctx.state.hookId}';
        window.__aiHooks = window.__aiHooks || {};
        window.__aiHookMetadata = window.__aiHookMetadata || {};
        window.__aiHooks[hookId] = window.__aiHooks[hookId] || [];
        window.__aiHookMetadata[hookId] = { enabled: true, source: '${MATRIX_MARKER}' };
        const original = window.__jshookTestHarness.multiply.bind(window.__jshookTestHarness);
        window.__jshookTestHarness.multiply = function (...args) {
          const result = original(...args);
          window.__aiHooks[hookId].push({ args, result });
          return result;
        };
      })();`,
      method: 'evaluate',
    });
  }
  await executeTool(ctx, 'page_evaluate', { code: 'window.__jshookTestHarness.multiply(2, 21)' });
}

async function ensureLegacyDetailId(ctx: MatrixContext) {
  if (ctx.state.legacyDetailId) {
    return ctx.state.legacyDetailId;
  }
  const payload = await executeTool(ctx, 'page_evaluate', {
    code: 'Array.from({ length: 4000 }, (_, index) => `detail-${index}`)',
    autoSummarize: true,
    maxSize: 256,
  });
  const detailId = ((payload.result as { detailId?: string })?.detailId) || (((payload.result as { result?: { detailId?: string } })?.result || {}).detailId);
  ctx.state.legacyDetailId = detailId as string | undefined;
  return ctx.state.legacyDetailId;
}

function extractLegacyScriptSource(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  return typeof payload.content === 'string'
    ? payload.content
    : typeof payload?.script?.source === 'string'
      ? payload.script.source
      : typeof payload?.source === 'string'
        ? payload.source
        : undefined;
}

async function ensureLegacyScriptTarget(ctx: MatrixContext) {
  if (ctx.state.legacyScriptTarget?.scriptId && ctx.state.legacyScriptTarget?.functionName) {
    return ctx.state.legacyScriptTarget;
  }

  await ensureLegacyDebugger(ctx);
  const scriptsPayload = await executeTool(ctx, 'get_all_scripts', { includeSource: false });
  const scripts = Array.isArray(scriptsPayload.scripts) ? scriptsPayload.scripts as Array<{ scriptId?: string; url?: string }> : [];
  const orderedScripts = [
    ...scripts.filter((item) => typeof item?.url === 'string' && item.url.includes('matrix-harness.js')),
    ...scripts.filter((item) => typeof item?.url === 'string' && item.url.includes('framework')),
    ...scripts.filter((item) => typeof item?.url === 'string' && item.url.includes('client-entry')),
    ...scripts,
  ];
  for (const script of orderedScripts) {
    if (!script?.scriptId) {
      continue;
    }
    const previewPayload = await executeTool(ctx, 'get_script_source', {
      scriptId: script.scriptId,
      preview: true,
      maxLines: 40,
    });
    const source = extractLegacyScriptSource(previewPayload);
    if (!source) {
      continue;
    }
    const functionMatch = source.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!functionMatch?.[1]) {
      continue;
    }
    const lineIndex = source.split(/\r?\n/).findIndex((line) => line.includes(`function ${functionMatch[1]}`));
    ctx.state.legacyScriptTarget = {
      scriptId: script.scriptId,
      url: script.url,
      functionName: functionMatch[1],
      lineNumber: Math.max(0, lineIndex),
    };
    return ctx.state.legacyScriptTarget;
  }

  ctx.state.legacyScriptTarget = {
    scriptId: scripts[0]?.scriptId,
    url: scripts[0]?.url,
    functionName: undefined,
    lineNumber: 0,
  };
  return ctx.state.legacyScriptTarget;
}

async function ensureLegacyNetworkResponseRequestId(ctx: MatrixContext) {
  if (ctx.state.legacyNetworkRequestId) {
    return ctx.state.legacyNetworkRequestId;
  }

  const resolveFromRequests = async (limit: number, urlFilter?: string) => {
    const candidatePayloads = [
      await executeTool(ctx, 'network_get_requests', { limit, url: urlFilter || '/jingxuan' }),
      await executeTool(ctx, 'network_get_requests', { limit }),
    ];
    const requests = candidatePayloads.flatMap((payload) => (
      Array.isArray(payload.requests)
        ? payload.requests as Array<{ requestId?: string; url?: string }>
        : []
    ));
    const preferred = requests.filter((item) => typeof item.url === 'string' && (item.url.includes('.js') || item.url.includes('.json') || item.url.includes('/jingxuan')));
    for (const request of [...preferred, ...requests]) {
      if (!request?.requestId) {
        continue;
      }
      const bodyPayload = await executeTool(ctx, 'network_get_response_body', { requestId: request.requestId, returnSummary: true });
      if (bodyPayload?.success === true) {
        return request.requestId;
      }
    }
    return preferred.find((item) => item?.requestId)?.requestId || requests.find((item) => item?.requestId)?.requestId;
  };

  let requestId = await resolveFromRequests(5);
  if (!requestId) {
    await ensureLegacyHarness(ctx);
    const probeToken = `jshook_network_probe=${Date.now()}`;
    await executeTool(ctx, 'page_evaluate', {
      code: `fetch(\`\${location.origin}\${location.pathname}?${probeToken}\`, { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.status)`,
    });
    requestId = await resolveFromRequests(5, probeToken);
    if (!requestId) {
      await executeTool(ctx, 'page_evaluate', { code: 'window.__jshookTestHarness.triggerFetch()' });
      requestId = await resolveFromRequests(5);
    }
  }
  ctx.state.legacyNetworkRequestId = requestId;
  return ctx.state.legacyNetworkRequestId;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveLegacyNetworkResponseBody(ctx: MatrixContext) {
  const tryRequestId = async (requestId?: string) => {
    if (!requestId) {
      return undefined;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const payload = await executeTool(ctx, 'network_get_response_body', { requestId, returnSummary: true });
      if (payload?.success === true) {
        return {
          args: { requestId, returnSummary: true },
          payload,
        };
      }
      await delay(500);
    }
    return undefined;
  };

  const currentRequestId = await ensureLegacyNetworkResponseRequestId(ctx);
  const currentResult = await tryRequestId(currentRequestId);
  if (currentResult) {
    return currentResult;
  }

  await ensureLegacyHarness(ctx);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const probeToken = `jshook_network_probe=${Date.now()}_${attempt}`;
    await executeTool(ctx, 'page_evaluate', {
      code: `fetch(\`\${location.origin}/ttwid/check/?${probeToken}\`, { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.status)`,
    });
    await delay(1000);
    const requestsPayload = await executeTool(ctx, 'network_get_requests', { limit: 5, url: probeToken });
    const requests = Array.isArray(requestsPayload.requests)
      ? requestsPayload.requests as Array<{ requestId?: string }>
      : [];
    for (const request of requests) {
      const resolved = await tryRequestId(request.requestId);
      if (resolved) {
        ctx.state.legacyNetworkRequestId = request.requestId;
        return resolved;
      }
    }
  }

  return {
    args: { requestId: currentRequestId, returnSummary: true },
    payload: await executeTool(ctx, 'network_get_response_body', { requestId: currentRequestId, returnSummary: true }),
  };
}

async function ensureLegacyObjectId(ctx: MatrixContext) {
  await ensureLegacyPausedState(ctx);
  const scopePayload = await executeTool(ctx, 'get_scope_variables_enhanced', {
    includeObjectProperties: false,
    maxDepth: 0,
    skipErrors: true,
  });
  const variables = Array.isArray(scopePayload.variables)
    ? scopePayload.variables as Array<{ objectId?: string }>
    : [];
  const seen = new Set<string>();
  const candidates = variables
    .map((entry) => entry?.objectId)
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
  return candidates;
}

async function ensureLegacyScriptsPrimed(ctx: MatrixContext) {
  if (ctx.state.legacyScriptsPrimed) {
    return;
  }
  await ensureLegacyDebugger(ctx);
  await executeTool(ctx, 'page_navigate', {
    url: ctx.options.url,
    waitUntil: 'domcontentloaded',
    enableNetworkMonitoring: true,
  });
  ctx.state.legacyReady = false;
  ctx.state.legacyScriptsPrimed = true;
}

async function resetLegacyBrowser(ctx: MatrixContext) {
  await executeTool(ctx, 'browser_close', {});
  ctx.state.legacyReady = false;
  ctx.state.legacyDebuggerEnabled = false;
  ctx.state.legacyScriptsPrimed = false;
  ctx.state.legacyScriptTarget = undefined;
  ctx.state.legacyNetworkRequestId = undefined;
}

async function ensureLegacyHistory(ctx: MatrixContext) {
  await ensureLegacyReady(ctx);
  await executeTool(ctx, 'page_navigate', {
    url: `${ctx.options.url}?jshook_matrix=history`,
    waitUntil: 'domcontentloaded',
    enableNetworkMonitoring: true,
  });
}

function buildEntry(tool: string, durationMs: number, payload: Record<string, unknown>, args: Record<string, unknown>): MatrixEntry {
  const normalized = normalizePayload(payload);
  return {
    tool,
    ok: normalized.ok,
    durationMs,
    args,
    summary: normalized.summary,
    error: normalized.error,
  };
}

async function runV2Scenario(ctx: MatrixContext, tool: string): Promise<MatrixEntry> {
  const started = Date.now();
  const sessionId = tool === 'browser.launch' ? undefined : await ensureV2Collected(ctx);
  let args: Record<string, unknown>;

  switch (tool) {
    case 'browser.launch':
      args = { engine: 'auto', label: 'douyin-live-matrix' };
      break;
    case 'browser.status':
      args = { sessionId };
      break;
    case 'browser.recover':
      args = { sessionId, reason: 'live-site-matrix' };
      break;
    case 'browser.close':
      args = { sessionId };
      break;
    case 'browser.navigate':
      args = { sessionId, url: ctx.options.url, waitProfile: 'interactive', enableNetworkCapture: true };
      break;
    case 'inspect.dom':
      args = { sessionId, action: 'query', selector: '#jshook-test-root' };
      break;
    case 'inspect.scripts':
      args = { sessionId, action: 'search', keyword: 'client-entry', maxResults: 5 };
      break;
    case 'inspect.network':
      args = { sessionId, limit: 10 };
      break;
    case 'inspect.runtime':
      args = { sessionId, expression: 'window.__jshookTestHarness.ping()' };
      break;
    case 'inspect.artifact':
      args = { artifactId: ctx.state.artifactId };
      break;
    case 'inspect.evidence':
      args = { evidenceId: ctx.state.evidenceId };
      break;
    case 'debug.control':
      args = { sessionId, action: 'enable' };
      break;
    case 'debug.evaluate':
      args = { sessionId, expression: 'window.__jshookTestHarness.multiply(6, 7)' };
      break;
    case 'analyze.bundle-fingerprint':
      args = { code: 'function sign(){ return "token"; }' };
      break;
    case 'analyze.source-map':
      args = { code: 'console.log("source map");\n//# sourceMappingURL=app.js.map', url: 'https://example.test/app.js' };
      break;
    case 'analyze.script-diff':
      args = { leftCode: 'const a = 1;', rightCode: 'const a = 2;' };
      break;
    case 'analyze.rank-functions':
      args = { code: 'function signToken(){ return fetch("/api"); }' };
      break;
    case 'analyze.obfuscation':
    case 'analyze.deobfuscate':
      args = { code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}', includeExplanation: false };
      break;
    case 'hook.generate':
      args = { sessionId, description: 'Hook window.__jshookTestHarness.multiply and capture args/return values' };
      break;
    case 'hook.inject':
      ctx.state.hookId = 'v2-matrix-hook';
      args = {
        sessionId,
        code: `(() => {
          const hookId = '${ctx.state.hookId}';
          window.__aiHooks = window.__aiHooks || {};
          window.__aiHookMetadata = window.__aiHookMetadata || {};
          window.__aiHooks[hookId] = [];
          window.__aiHookMetadata[hookId] = { enabled: true, source: '${MATRIX_MARKER}' };
          if (!window.__jshookTestHarness || typeof window.__jshookTestHarness.multiply !== 'function') {
            return;
          }
          const original = window.__jshookTestHarness.multiply.bind(window.__jshookTestHarness);
          window.__jshookTestHarness.multiply = function (...args) {
            const result = original(...args);
            window.__aiHooks[hookId].push({ args, result });
            return result;
          };
        })();`,
      };
      break;
    case 'hook.data':
      await executeTool(ctx, 'inspect.runtime', { sessionId, expression: 'window.__jshookTestHarness.multiply(3, 9)' });
      args = { sessionId, hookId: ctx.state.hookId || 'v2-matrix-hook' };
      break;
    case 'flow.collect-site':
      args = { sessionId, url: ctx.options.url, waitProfile: 'interactive', collectionStrategy: 'manifest' };
      break;
    case 'flow.find-signature-path':
      args = { sessionId, requestPattern: 'aweme' };
      break;
    case 'flow.trace-request':
      args = { sessionId, urlPattern: 'check_qrconnect' };
      break;
    case 'flow.generate-hook':
      args = { sessionId, description: '自动破解 window.__jshookTestHarness.multiply 并捕获返回值' };
      break;
    case 'flow.reverse-report':
      args = { sessionId, focus: 'overview' };
      break;
    case 'flow.resume-session':
      args = { sessionId };
      break;
    default:
      throw new Error(`Unhandled V2 tool scenario: ${tool}`);
  }

  const payload = await executeTool(ctx, tool, args);
  if (tool === 'browser.launch' && typeof payload.sessionId === 'string') {
    ctx.state.sessionId = payload.sessionId;
  }
  if (tool === 'flow.collect-site') {
    if (typeof payload.artifactId === 'string') {
      ctx.state.artifactId = payload.artifactId;
    }
    if (Array.isArray(payload.evidenceIds) && payload.evidenceIds.length > 0) {
      ctx.state.evidenceId = payload.evidenceIds[0] as string;
    }
  }
  return buildEntry(tool, Date.now() - started, payload, args);
}

async function runLegacyScenario(ctx: MatrixContext, tool: string): Promise<MatrixEntry> {
  const started = Date.now();
  if (['console_execute', 'console_get_logs', 'performance_get_metrics', 'performance_start_coverage', 'performance_stop_coverage', 'performance_take_heap_snapshot', 'page_back', 'page_forward', 'page_reload'].includes(tool)) {
    ctx.state.legacyReady = false;
  }
  if (tool === 'page_back') {
    await resetLegacyBrowser(ctx);
    await ensureLegacyHistory(ctx);
  } else if (tool === 'page_forward') {
    await resetLegacyBrowser(ctx);
    await ensureLegacyHistory(ctx);
    await executeTool(ctx, 'page_back', {});
  } else if (tool === 'page_reload') {
    await resetLegacyBrowser(ctx);
    await ensureLegacyReady(ctx);
  } else {
    await ensureLegacyReady(ctx);
  }
  if (isLegacyDebuggerTool(tool)) {
    await ensureLegacyDebugger(ctx);
  }
  if (['search_in_scripts', 'extract_function_tree', 'get_all_scripts', 'get_script_source', 'breakpoint_set', 'breakpoint_remove'].includes(tool)) {
    await ensureLegacyScriptsPrimed(ctx);
  }
  if ([
    'page_click',
    'page_type',
    'page_select',
    'page_hover',
    'page_wait_for_selector',
    'page_evaluate',
    'dom_query_selector',
    'dom_query_all',
    'dom_find_clickable',
    'dom_get_computed_style',
    'dom_find_by_text',
    'dom_get_xpath',
    'dom_is_in_viewport',
    'console_execute',
    'search_in_scripts',
    'extract_function_tree',
    'get_all_scripts',
    'get_script_source',
    'ai_hook_inject',
    'ai_hook_get_data',
  ].includes(tool)) {
    await ensureLegacyHarness(ctx);
  }
  if (needsLegacyPausedState(tool)) {
    await ensureLegacyPausedState(ctx);
  }
  if (['ai_hook_get_data', 'ai_hook_export', 'ai_hook_toggle', 'ai_hook_clear'].includes(tool)) {
    await ensureLegacyHookData(ctx);
  }
  let args: Record<string, unknown> = {};
  let directPayload: Record<string, unknown> | undefined;

  switch (tool) {
    case 'collect_code':
      args = {
        url: ctx.options.url,
        smartMode: 'summary',
        includeDynamic: false,
        maxTotalSize: 65536,
        maxFileSize: 64,
        priorities: ['client-entry'],
      };
      break;
    case 'search_in_scripts':
      args = { keyword: 'client-entry', maxMatches: 10, returnSummary: true };
      break;
    case 'extract_function_tree':
      {
        const target = await ensureLegacyScriptTarget(ctx);
        if (!target?.scriptId) {
          const rawScripts = await executeTool(ctx, 'get_all_scripts', { includeSource: false });
          const firstScript = Array.isArray(rawScripts.scripts) ? rawScripts.scripts.find((item) => item?.scriptId) : undefined;
          if (firstScript?.scriptId) {
            ctx.state.legacyScriptTarget = {
              ...ctx.state.legacyScriptTarget,
              scriptId: firstScript.scriptId,
              url: firstScript.url,
            };
          }
        }
        args = { scriptId: ctx.state.legacyScriptTarget?.scriptId, functionName: ctx.state.legacyScriptTarget?.functionName || 'anonymous', maxDepth: 1 };
      }
      break;
    case 'deobfuscate':
    case 'detect_obfuscation':
    case 'advanced_deobfuscate':
      args = { code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}' };
      break;
    case 'understand_code':
      args = { code: 'function ping(){ return "pong"; }', focus: 'structure' };
      break;
    case 'detect_crypto':
      args = { code: 'crypto.subtle.digest("SHA-256", data);' };
      break;
    case 'manage_hooks':
      args = { action: 'list' };
      break;
    case 'page_navigate':
      args = { url: ctx.options.url, waitUntil: 'domcontentloaded', enableNetworkMonitoring: true };
      break;
    case 'dom_query_selector':
      args = { selector: '#jshook-test-root' };
      break;
    case 'dom_query_all':
      args = { selector: '#jshook-test-root *', limit: 10 };
      break;
    case 'dom_get_structure':
      args = { maxDepth: 2, includeText: false };
      break;
    case 'dom_find_clickable':
      args = { filterText: 'JSHook Action' };
      break;
    case 'page_click':
      args = { selector: '#jshook-test-button' };
      break;
    case 'page_type':
      args = { selector: '#jshook-test-input', text: 'matrix-typed' };
      break;
    case 'page_select':
      args = { selector: '#jshook-test-select', values: ['beta'] };
      break;
    case 'page_hover':
      args = { selector: '#jshook-test-hover' };
      break;
    case 'page_scroll':
      args = { x: 0, y: 240 };
      break;
    case 'page_wait_for_selector':
      args = { selector: '#jshook-test-button', timeout: 10000 };
      break;
    case 'page_evaluate':
      args = { code: 'window.__jshookTestHarness.ping()' };
      break;
    case 'page_screenshot':
      args = { path: path.join(ctx.outputDir, 'legacy-page.png'), type: 'png', fullPage: false };
      break;
    case 'get_all_scripts':
      args = { includeSource: false };
      break;
    case 'get_script_source':
      {
        const target = await ensureLegacyScriptTarget(ctx);
        if (!target?.scriptId) {
          const rawScripts = await executeTool(ctx, 'get_all_scripts', { includeSource: false });
          const firstScript = Array.isArray(rawScripts.scripts) ? rawScripts.scripts.find((item) => item?.scriptId) : undefined;
          if (firstScript?.scriptId) {
            ctx.state.legacyScriptTarget = {
              ...ctx.state.legacyScriptTarget,
              scriptId: firstScript.scriptId,
              url: firstScript.url,
            };
          }
        }
        args = { scriptId: ctx.state.legacyScriptTarget?.scriptId, preview: true, maxLines: 20 };
      }
      break;
    case 'console_get_logs':
      args = { limit: 20 };
      break;
    case 'console_execute':
      args = { expression: 'window.__jshookTestHarness.multiply(4, 5)' };
      break;
    case 'dom_get_computed_style':
      args = { selector: '#jshook-test-button' };
      break;
    case 'dom_find_by_text':
      args = { text: 'JSHook Action' };
      break;
    case 'dom_get_xpath':
      args = { selector: '#jshook-test-button' };
      break;
    case 'dom_is_in_viewport':
      args = { selector: '#jshook-test-button' };
      break;
    case 'page_inject_script':
      args = { script: HARNESS_INSTALL_EXPRESSION };
      break;
    case 'page_set_cookies':
      args = { cookies: [{ name: 'jshook_matrix', value: '1', domain: 'www.douyin.com', path: '/' }] };
      break;
    case 'page_set_viewport':
      args = { width: 1280, height: 800 };
      break;
    case 'page_emulate_device':
      args = { device: 'iPhone' };
      break;
    case 'page_set_local_storage':
      args = { key: 'jshook-matrix', value: '1' };
      break;
    case 'page_press_key':
      args = { key: 'Escape' };
      break;
    case 'page_back':
      args = {};
      break;
    case 'page_forward':
      args = {};
      break;
    case 'page_reload':
      args = {};
      break;
    case 'captcha_config':
      args = { autoDetectCaptcha: true, autoSwitchHeadless: false, captchaTimeout: 1000 };
      break;
    case 'captcha_wait':
      args = { timeout: 50 };
      break;
    case 'stealth_set_user_agent':
      args = { platform: 'windows' };
      break;
    case 'network_get_requests':
      args = { limit: 10 };
      break;
    case 'network_get_response_body':
      {
        const resolved = await resolveLegacyNetworkResponseBody(ctx);
        args = resolved.args;
        directPayload = resolved.payload;
      }
      break;
    case 'console_inject_function_tracer':
      args = { functionName: 'window.__jshookTestHarness.multiply' };
      break;
    case 'ai_hook_generate':
      args = { description: 'Hook window.__jshookTestHarness.multiply and capture args' };
      break;
    case 'ai_hook_inject':
      ctx.state.hookId = 'legacy-matrix-hook';
      args = {
        hookId: ctx.state.hookId,
        code: `(() => {
          const hookId = '${ctx.state.hookId}';
          window.__aiHooks = window.__aiHooks || {};
          window.__aiHookMetadata = window.__aiHookMetadata || {};
          window.__aiHooks[hookId] = window.__aiHooks[hookId] || [];
          window.__aiHookMetadata[hookId] = { enabled: true, source: '${MATRIX_MARKER}' };
        })();`,
        method: 'evaluate',
      };
      break;
    case 'ai_hook_get_data':
      args = { hookId: ctx.state.hookId || 'legacy-matrix-hook' };
      break;
    case 'ai_hook_clear':
      args = { hookId: ctx.state.hookId || 'legacy-matrix-hook' };
      break;
    case 'ai_hook_toggle':
      args = { hookId: ctx.state.hookId || 'legacy-matrix-hook', enabled: true };
      break;
    case 'ai_hook_export':
      args = { hookId: ctx.state.hookId || 'legacy-matrix-hook', format: 'json' };
      break;
    case 'breakpoint_set':
      {
        const target = await ensureLegacyScriptTarget(ctx);
        args = { scriptId: target?.scriptId, lineNumber: target?.lineNumber ?? 0 };
      }
      break;
    case 'breakpoint_remove':
      {
        const existing = await executeTool(ctx, 'breakpoint_list', {});
        let breakpointId = Array.isArray(existing.breakpoints) && existing.breakpoints[0]
          ? (existing.breakpoints[0] as { breakpointId?: string }).breakpointId
          : undefined;
        if (!breakpointId) {
          const target = await ensureLegacyScriptTarget(ctx);
          await executeTool(ctx, 'breakpoint_set', { scriptId: target?.scriptId, lineNumber: target?.lineNumber ?? 0 });
          const created = await executeTool(ctx, 'breakpoint_list', {});
          breakpointId = Array.isArray(created.breakpoints) && created.breakpoints[0]
            ? (created.breakpoints[0] as { breakpointId?: string }).breakpointId
            : undefined;
        }
        args = { breakpointId };
      }
      break;
    case 'debugger_evaluate':
    case 'debugger_evaluate_global':
      args = { expression: 'window.__jshookTestHarness.multiply(6, 7)' };
      break;
    case 'get_object_properties':
      {
        const objectIds = await ensureLegacyObjectId(ctx);
        for (const objectId of objectIds) {
          const candidate = await executeTool(ctx, 'get_object_properties', { objectId });
          if (candidate?.success === true) {
            directPayload = candidate;
            args = { objectId };
            break;
          }
        }
        if (!directPayload) {
          args = { objectId: objectIds[0] };
        }
      }
      break;
    case 'debugger_load_session':
      args = { filePath: ctx.state.legacySavedSessionPath || path.join(ctx.outputDir, 'legacy-debug-session.json') };
      break;
    case 'breakpoint_set_on_exception':
      args = { state: 'uncaught' };
      break;
    case 'watch_add':
      args = { expression: 'window.__jshookTestHarness.state.buttonClicks', name: 'buttonClicks' };
      break;
    case 'watch_remove':
      args = { watchId: ctx.state.legacyWatchId };
      break;
    case 'xhr_breakpoint_set':
      args = { urlPattern: 'jingxuan' };
      break;
    case 'xhr_breakpoint_remove':
      args = { breakpointId: ctx.state.legacyXHRBreakpointId };
      break;
    case 'event_breakpoint_set':
      args = { eventName: 'listener:click' };
      break;
    case 'event_breakpoint_set_category':
      args = { category: 'mouse' };
      break;
    case 'event_breakpoint_remove':
      args = { breakpointId: ctx.state.legacyEventBreakpointId };
      break;
    case 'blackbox_add':
      args = { urlPattern: 'runtime' };
      break;
    case 'smart_cache_cleanup':
      args = { targetSize: 1024 * 1024 };
      break;
    case 'get_detailed_data':
      args = { detailId: await ensureLegacyDetailId(ctx) };
      break;
    default:
      args = {};
      break;
  }
  const payload = directPayload || await executeTool(ctx, tool, args);
  if (tool === 'debugger_disable' || tool === 'browser_close') {
    ctx.state.legacyDebuggerEnabled = false;
    ctx.state.legacyReady = false;
    ctx.state.legacyScriptsPrimed = false;
  }
  if (tool === 'debugger_save_session' && payload.filePath) {
    ctx.state.legacySavedSessionPath = payload.filePath as string;
  }
  if (tool === 'get_all_scripts' && Array.isArray(payload.scripts) && payload.scripts.length > 0) {
    const firstScript = payload.scripts.find((item) => item && item.scriptId) || payload.scripts[0];
    ctx.state.legacyScriptTarget = {
      scriptId: firstScript?.scriptId as string | undefined,
      url: firstScript?.url as string | undefined,
      functionName: ctx.state.legacyScriptTarget?.functionName,
      lineNumber: 0,
    };
  }
  if (tool === 'get_script_source') {
    const source = extractLegacyScriptSource(payload);
    if (source) {
      const match = source.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (match?.[1]) {
        const lineNumber = source.split(/\r?\n/).findIndex((line) => line.includes(`function ${match[1]}`));
        ctx.state.legacyScriptTarget = {
          ...ctx.state.legacyScriptTarget,
          functionName: match[1],
          lineNumber: Math.max(0, lineNumber),
        };
      }
    }
  }
  if (tool === 'watch_add' && payload.watchId) {
    ctx.state.legacyWatchId = payload.watchId as string;
  }
  if (tool === 'network_get_requests' && Array.isArray(payload.requests) && payload.requests.length > 0) {
    const preferred = payload.requests.find((item) => typeof item?.url === 'string' && item.url.includes('.js')) || payload.requests[0];
    ctx.state.legacyNetworkRequestId = preferred?.requestId as string | undefined;
  }
  if (tool === 'xhr_breakpoint_set' && payload.breakpointId) {
    ctx.state.legacyXHRBreakpointId = payload.breakpointId as string;
  }
  if (tool === 'event_breakpoint_set' && payload.breakpointId) {
    ctx.state.legacyEventBreakpointId = payload.breakpointId as string;
  }
  if (['browser_launch', 'page_navigate', 'page_reload', 'page_back', 'page_forward', 'page_emulate_device', 'collect_code'].includes(tool)) {
    ctx.state.legacyReady = false;
    ctx.state.legacyScriptsPrimed = false;
  }
  return buildEntry(tool, Date.now() - started, payload, args);
}

function ensureOutputDirectory(repoRoot: string, requestedDir?: string) {
  const baseDir = requestedDir || path.join(repoRoot, '.cache', 'live-site-matrix');
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

async function tryReadMatrixSummary(summaryPath: string) {
  if (!fs.existsSync(summaryPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as MatrixSummary;
  } catch {
    return undefined;
  }
}

async function runMatrixSubprocess(options: MatrixOptions, surface: Exclude<SurfaceMode, 'all'>, outputDir: string) {
  const repoRoot = resolveRepoRoot();
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    'tsx',
    'scripts/live-site-matrix.ts',
    '--surface',
    surface,
    '--runtime',
    options.runtimeMode,
    '--url',
    options.url,
    '--repeat',
    String(options.repeat),
    '--tool-timeout-ms',
    String(options.toolTimeoutMs),
    '--output-dir',
    outputDir,
  ];
  if (options.toolPattern) {
    args.push('--tool-pattern', options.toolPattern);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'ignore',
      shell: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const summaryPath = path.join(outputDir, `latest-${surface}-${options.runtimeMode}.json`);
      if (code === 0) {
        resolve();
        return;
      }
      void (async () => {
        await delay(1000);
        const summary = await tryReadMatrixSummary(summaryPath);
        if (summary && summary.totals.failed === 0) {
          resolve();
          return;
        }
        reject(new Error(`Subprocess for surface ${surface} exited with code ${code ?? 'unknown'}`));
      })();
    });
  });

  const summaryPath = path.join(outputDir, `latest-${surface}-${options.runtimeMode}.json`);
  return JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as MatrixSummary;
}

function shouldIsolateLegacyTool(tool: string) {
  return [
    'detect_crypto',
    'detect_obfuscation',
    'deobfuscate',
    'advanced_deobfuscate',
    'understand_code',
    'get_collection_stats',
    'get_cache_stats',
    'get_token_budget_stats',
    'manual_token_cleanup',
    'reset_token_budget',
    'smart_cache_cleanup',
  ].includes(tool);
}

async function runLegacyIsolatedScenario(ctx: MatrixContext, tool: string): Promise<MatrixEntry> {
  const repoRoot = resolveRepoRoot();
  const server = await loadServer(repoRoot, ctx.options.runtimeMode);
  const toolNames = new Set(server.registry.listTools().map((item) => item.name));
  const isolatedCtx: MatrixContext = {
    options: ctx.options,
    server,
    toolNames,
    outputDir: ctx.outputDir,
    state: {},
  };
  const started = Date.now();
  try {
    let args: Record<string, unknown> = {};
    switch (tool) {
      case 'deobfuscate':
      case 'detect_obfuscation':
      case 'advanced_deobfuscate':
        args = { code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}' };
        break;
      case 'understand_code':
        args = { code: 'function ping(){ return "pong"; }', focus: 'structure' };
        break;
      case 'detect_crypto':
        args = { code: 'crypto.subtle.digest("SHA-256", data);' };
        break;
      case 'smart_cache_cleanup':
        args = { targetSize: 1024 * 1024 };
        break;
      default:
        args = {};
        break;
    }
    const payload = await executeTool(isolatedCtx, tool, args);
    return buildEntry(tool, Date.now() - started, payload, args);
  } finally {
    await server.close();
  }
}

async function runTool(ctx: MatrixContext, tool: string) {
  if (classifyToolSurface(tool) === 'v2') {
    return runV2Scenario(ctx, tool);
  }
  if (shouldIsolateLegacyTool(tool)) {
    return runLegacyIsolatedScenario(ctx, tool);
  }
  return runLegacyScenario(ctx, tool);
}

async function runToolWithTimeout(ctx: MatrixContext, tool: string) {
  const timeoutMs = ['get_all_scripts', 'get_script_source', 'search_in_scripts', 'extract_function_tree'].includes(tool)
    ? Math.max(ctx.options.toolTimeoutMs, 60000)
    : ['performance_get_metrics', 'performance_start_coverage', 'performance_stop_coverage', 'performance_take_heap_snapshot'].includes(tool)
    ? Math.max(ctx.options.toolTimeoutMs, 60000)
    : ['page_back', 'page_forward', 'page_reload', 'page_press_key'].includes(tool)
    ? Math.max(ctx.options.toolTimeoutMs, 60000)
    : tool === 'collect_code'
    ? Math.max(ctx.options.toolTimeoutMs, 150000)
    : ['advanced_deobfuscate', 'understand_code', 'detect_crypto'].includes(tool)
      ? Math.max(ctx.options.toolTimeoutMs, 45000)
    : ctx.options.toolTimeoutMs;
  return Promise.race([
    runTool(ctx, tool),
    new Promise<MatrixEntry>((resolve) => {
      setTimeout(() => {
        resolve({
          tool,
          ok: false,
          durationMs: timeoutMs,
          error: `Tool timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    }),
  ]);
}

function buildSummary(options: MatrixOptions, startedAt: string, entries: MatrixEntry[]): MatrixSummary {
  return {
    targetUrl: options.url,
    surface: options.surface,
    runtimeMode: options.runtimeMode,
    startedAt,
    finishedAt: new Date().toISOString(),
    totals: {
      total: entries.length,
      passed: entries.filter((entry) => entry.ok).length,
      failed: entries.filter((entry) => !entry.ok).length,
      skipped: entries.filter((entry) => entry.summary === 'SKIPPED').length,
    },
    entries,
  };
}

function writeSummaryFiles(outputDir: string, fileStem: string, summary: MatrixSummary) {
  const jsonPath = path.join(outputDir, `${fileStem}.json`);
  const markdownPath = path.join(outputDir, `${fileStem}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(markdownPath, renderMarkdownSummary(summary) + os.EOL);
  return { jsonPath, markdownPath };
}

function orderTools(toolNames: string[], surface: SurfaceMode) {
  const v2Order = [
    'browser.launch',
    'browser.status',
    'flow.collect-site',
    'browser.navigate',
    'inspect.runtime',
    'inspect.dom',
    'inspect.scripts',
    'inspect.network',
    'inspect.artifact',
    'inspect.evidence',
    'debug.control',
    'debug.evaluate',
    'analyze.bundle-fingerprint',
    'analyze.source-map',
    'analyze.script-diff',
    'analyze.rank-functions',
    'analyze.obfuscation',
    'analyze.deobfuscate',
    'hook.generate',
    'hook.inject',
    'hook.data',
    'flow.find-signature-path',
    'flow.trace-request',
    'flow.generate-hook',
    'flow.reverse-report',
    'flow.resume-session',
    'browser.recover',
    'browser.close',
  ];
  const legacyOrder = [
    'browser_launch',
    'browser_status',
    'network_enable',
    'network_get_status',
    'network_get_stats',
    'page_navigate',
    'console_enable',
    'console_get_logs',
    'console_get_exceptions',
    'console_execute',
    'console_inject_script_monitor',
    'console_inject_xhr_interceptor',
    'console_inject_fetch_interceptor',
    'console_inject_function_tracer',
    'stealth_inject',
    'stealth_set_user_agent',
    'captcha_config',
    'captcha_detect',
    'captcha_wait',
    'dom_query_selector',
    'dom_query_all',
    'dom_get_structure',
    'dom_find_clickable',
    'dom_find_by_text',
    'dom_get_computed_style',
    'dom_get_xpath',
    'dom_is_in_viewport',
    'page_wait_for_selector',
    'page_click',
    'page_type',
    'page_select',
    'page_hover',
    'page_evaluate',
    'get_detailed_data',
    'page_inject_script',
    'page_get_all_links',
    'page_get_cookies',
    'page_get_local_storage',
    'page_get_performance',
    'page_set_cookies',
    'page_set_local_storage',
    'page_set_viewport',
    'page_emulate_device',
    'page_press_key',
    'page_scroll',
    'page_screenshot',
    'performance_get_metrics',
    'performance_start_coverage',
    'performance_stop_coverage',
    'performance_take_heap_snapshot',
    'ai_hook_generate',
    'ai_hook_inject',
    'ai_hook_get_data',
    'ai_hook_list',
    'ai_hook_export',
    'ai_hook_toggle',
    'ai_hook_clear',
    'manage_hooks',
    'debugger_enable',
    'get_all_scripts',
    'get_script_source',
    'search_in_scripts',
    'extract_function_tree',
    'network_get_requests',
    'network_get_response_body',
    'breakpoint_set',
    'breakpoint_list',
    'debugger_pause',
    'debugger_wait_for_paused',
    'debugger_evaluate',
    'debugger_evaluate_global',
    'get_call_stack',
    'get_scope_variables_enhanced',
    'get_object_properties',
    'watch_add',
    'watch_list',
    'watch_evaluate_all',
    'watch_remove',
    'watch_clear_all',
    'xhr_breakpoint_set',
    'xhr_breakpoint_list',
    'xhr_breakpoint_remove',
    'event_breakpoint_set',
    'event_breakpoint_list',
    'event_breakpoint_set_category',
    'event_breakpoint_remove',
    'blackbox_add',
    'blackbox_add_common',
    'blackbox_list',
    'breakpoint_set_on_exception',
    'breakpoint_remove',
    'debugger_get_paused_state',
    'debugger_step_into',
    'debugger_step_over',
    'debugger_step_out',
    'debugger_resume',
    'debugger_save_session',
    'debugger_export_session',
    'debugger_list_sessions',
    'debugger_load_session',
    'debugger_disable',
    'detect_crypto',
    'detect_obfuscation',
    'deobfuscate',
    'advanced_deobfuscate',
    'understand_code',
    'get_collection_stats',
    'get_cache_stats',
    'get_token_budget_stats',
    'manual_token_cleanup',
    'reset_token_budget',
    'smart_cache_cleanup',
    'page_back',
    'page_forward',
    'page_reload',
    'page_clear_cookies',
    'clear_all_caches',
    'collect_code',
    'clear_collected_data',
    'network_disable',
  ];

  const legacyImportantTail = ['browser_close'];
  const ordered = [...toolNames].sort((left, right) => {
    if (classifyToolSurface(left) === 'v2' && classifyToolSurface(right) === 'v2') {
      const leftIndex = v2Order.indexOf(left);
      const rightIndex = v2Order.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
      }
    }
    if (surface !== 'v2' && classifyToolSurface(left) === 'legacy' && classifyToolSurface(right) === 'legacy') {
      const leftIndex = legacyOrder.indexOf(left);
      const rightIndex = legacyOrder.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
      }
      const leftTail = legacyImportantTail.includes(left);
      const rightTail = legacyImportantTail.includes(right);
      if (leftTail !== rightTail) {
        return leftTail ? 1 : -1;
      }
    }
    return left.localeCompare(right);
  });

  return ordered;
}

function getLegacyGroup(tool: string) {
  if ([
    'browser_launch',
    'browser_status',
    'network_enable',
    'network_get_status',
    'network_get_stats',
    'page_navigate',
    'console_enable',
    'console_get_logs',
    'console_get_exceptions',
    'console_execute',
    'console_inject_script_monitor',
    'console_inject_xhr_interceptor',
    'console_inject_fetch_interceptor',
    'console_inject_function_tracer',
    'stealth_inject',
    'stealth_set_user_agent',
    'captcha_config',
    'captcha_detect',
    'captcha_wait',
    'dom_query_selector',
    'dom_query_all',
    'dom_get_structure',
    'dom_find_clickable',
    'dom_find_by_text',
    'dom_get_computed_style',
    'dom_get_xpath',
    'dom_is_in_viewport',
    'page_wait_for_selector',
    'page_click',
    'page_type',
    'page_select',
    'page_hover',
    'page_evaluate',
    'get_detailed_data',
    'page_inject_script',
    'page_get_all_links',
    'page_get_cookies',
    'page_get_local_storage',
    'page_get_performance',
    'page_set_cookies',
    'page_set_local_storage',
    'page_set_viewport',
  ].includes(tool)) {
    return 'basic';
  }

  if ([
    'page_emulate_device',
    'page_press_key',
    'page_scroll',
    'page_screenshot',
  ].includes(tool)) {
    return 'interaction';
  }

  if ([
    'performance_get_metrics',
    'performance_start_coverage',
    'performance_stop_coverage',
    'performance_take_heap_snapshot',
  ].includes(tool)) {
    return 'performance';
  }

  if ([
    'ai_hook_generate',
    'ai_hook_inject',
    'ai_hook_get_data',
    'ai_hook_list',
    'ai_hook_export',
    'ai_hook_toggle',
    'ai_hook_clear',
    'manage_hooks',
  ].includes(tool)) {
    return 'hooks';
  }

  if ([
    'debugger_enable',
    'get_all_scripts',
    'get_script_source',
    'search_in_scripts',
    'extract_function_tree',
    'network_get_requests',
    'network_get_response_body',
    'breakpoint_set',
    'breakpoint_list',
    'debugger_pause',
    'debugger_wait_for_paused',
    'debugger_evaluate',
    'debugger_evaluate_global',
    'get_call_stack',
    'get_scope_variables_enhanced',
    'get_object_properties',
    'watch_add',
    'watch_list',
    'watch_evaluate_all',
    'watch_remove',
    'watch_clear_all',
    'xhr_breakpoint_set',
    'xhr_breakpoint_list',
    'xhr_breakpoint_remove',
    'event_breakpoint_set',
    'event_breakpoint_list',
    'event_breakpoint_set_category',
    'event_breakpoint_remove',
    'blackbox_add',
    'blackbox_add_common',
    'blackbox_list',
    'breakpoint_set_on_exception',
    'breakpoint_remove',
    'debugger_get_paused_state',
    'debugger_step_into',
    'debugger_step_over',
    'debugger_step_out',
    'debugger_resume',
    'debugger_save_session',
    'debugger_export_session',
    'debugger_list_sessions',
    'debugger_load_session',
    'debugger_disable',
  ].includes(tool)) {
    return 'debugger';
  }

  if (shouldIsolateLegacyTool(tool)) {
    return 'analysis';
  }

  return 'cleanup';
}

function splitLegacyToolGroups(tools: string[]) {
  const groups: Array<{ name: string; tools: string[] }> = [];
  for (const tool of tools) {
    const groupName = getLegacyGroup(tool);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.name !== groupName) {
      groups.push({ name: groupName, tools: [tool] });
      continue;
    }
    lastGroup.tools.push(tool);
  }
  return groups;
}

async function runLiveSiteMatrixSingleSurface(options: MatrixOptions) {
  const repoRoot = resolveRepoRoot();
  dotenvConfig({ path: resolveSharedEnvPath(repoRoot), override: false });
  process.env.ENABLE_LEGACY_TOOLS = options.surface === 'v2' ? 'false' : 'true';
  const outputDir = ensureOutputDirectory(repoRoot, options.outputDir);
  const bootstrapServer = await loadServer(repoRoot, options.runtimeMode);
  const toolNames = new Set(bootstrapServer.registry.listTools().map((tool) => tool.name));
  const startedAt = new Date().toISOString();
  const entries: MatrixEntry[] = [];
  const timestamp = startedAt.replace(/[:.]/g, '-');
  let bootstrapClosed = false;

  try {
    const filteredTools = orderTools(
      Array.from(toolNames).filter((tool) => {
        if (options.surface !== 'all' && classifyToolSurface(tool) !== options.surface) {
          return false;
        }
        if (options.toolPattern) {
          return tool.includes(options.toolPattern);
        }
        return true;
      }),
      options.surface,
    );

    if (options.surface === 'legacy' && !options.toolPattern) {
      const groups = splitLegacyToolGroups(filteredTools);
      for (let iteration = 0; iteration < options.repeat; iteration += 1) {
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const activeServer = groupIndex === 0
            ? bootstrapServer
            : await loadServer(repoRoot, options.runtimeMode);
          const activeToolNames = new Set(activeServer.registry.listTools().map((tool) => tool.name));
          const ctx: MatrixContext = {
            options,
            server: activeServer,
            toolNames: activeToolNames,
            outputDir,
            state: {},
          };
          try {
            for (const tool of groups[groupIndex]!.tools) {
              const entry = await runToolWithTimeout(ctx, tool);
              entries.push(options.repeat > 1 ? { ...entry, tool: `${entry.tool}#${iteration + 1}` } : entry);
              writeSummaryFiles(outputDir, `latest-${options.surface}-${options.runtimeMode}`, buildSummary(options, startedAt, entries));
            }
          } finally {
            await activeServer.close();
            if (groupIndex === 0) {
              bootstrapClosed = true;
            }
          }
        }
      }
    } else {
      const ctx: MatrixContext = {
        options,
        server: bootstrapServer,
        toolNames,
        outputDir,
        state: {},
      };
      for (let iteration = 0; iteration < options.repeat; iteration += 1) {
        for (const tool of filteredTools) {
          const entry = await runToolWithTimeout(ctx, tool);
          entries.push(options.repeat > 1 ? { ...entry, tool: `${entry.tool}#${iteration + 1}` } : entry);
          writeSummaryFiles(outputDir, `latest-${options.surface}-${options.runtimeMode}`, buildSummary(options, startedAt, entries));
        }
      }
    }
  } finally {
    if (!bootstrapClosed) {
      await bootstrapServer.close();
    }
  }

  const summary = buildSummary(options, startedAt, entries);
  const { jsonPath, markdownPath } = writeSummaryFiles(outputDir, `${timestamp}-${options.surface}-${options.runtimeMode}`, summary);
  return { summary, jsonPath, markdownPath };
}

export async function runLiveSiteMatrix(options: MatrixOptions) {
  if (options.surface !== 'all') {
    return runLiveSiteMatrixSingleSurface(options);
  }

  const outputDir = ensureOutputDirectory(resolveRepoRoot(), options.outputDir);
  const v2Summary = await runMatrixSubprocess(options, 'v2', outputDir);
  const legacySummary = await runMatrixSubprocess(options, 'legacy', outputDir);

  const startedAt = [v2Summary.startedAt, legacySummary.startedAt].sort()[0] || new Date().toISOString();
  const entries = orderTools(
    [...v2Summary.entries.map((entry) => entry.tool), ...legacySummary.entries.map((entry) => entry.tool)],
    'all',
  ).map((tool) => (
    v2Summary.entries.find((entry) => entry.tool === tool)
    || legacySummary.entries.find((entry) => entry.tool === tool)
  )).filter((entry): entry is MatrixEntry => Boolean(entry));

  const summary = buildSummary(options, startedAt, entries);
  const timestamp = startedAt.replace(/[:.]/g, '-');
  const { jsonPath, markdownPath } = writeSummaryFiles(outputDir, `${timestamp}-${options.surface}-${options.runtimeMode}`, summary);
  writeSummaryFiles(outputDir, `latest-${options.surface}-${options.runtimeMode}`, summary);
  return { summary, jsonPath, markdownPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { summary, jsonPath, markdownPath } = await runLiveSiteMatrix(options);
  process.stdout.write(`${renderMarkdownSummary(summary)}\n\nJSON: ${jsonPath}\nMarkdown: ${markdownPath}\n`);
  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

const executedDirectly = Boolean(process.argv[1] && /live-site-matrix\.(ts|js)$/i.test(path.basename(process.argv[1])));

if (executedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
