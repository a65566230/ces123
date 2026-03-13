import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 live hardening behaviors', () => {
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let runtime: ToolRuntimeContext;
  let executor: ToolExecutor;

  beforeAll(async () => {
    fixture = await startFixtureServer(path.resolve(process.cwd(), 'tests/fixtures'));
    const config = createTestConfig();
    runtime = new ToolRuntimeContext(config, resolveRuntimeOptions(config));
    executor = new ToolExecutor(new ToolRegistry(createV2Tools(runtime)), runtime);
  });

  afterAll(async () => {
    await runtime.close();
    await fixture.close();
  });

  test('progressively loads source batches during script search', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    const scripts = Array.from({ length: 48 }, (_, index) => ({
      scriptId: `script-${index}`,
      url: `https://example.test/${index}.js`,
      source: index === 0 ? 'const webSign = "needle"; function mark(){ return webSign; }' : `const filler${index} = ${index};`,
      sourceLength: index === 0 ? 58 : 24,
    }));

    const getScripts = jest.fn(async (options?: { includeSource?: boolean; maxScripts?: number }) => {
      return scripts.map(({ scriptId, url, sourceLength }) => ({
        scriptId,
        url,
        sourceLength,
      }));
    });
    const getScriptSource = jest.fn(async (scriptId?: string) => scripts.find((script) => script.scriptId === scriptId) || null);

    session!.engine.getScripts = getScripts as never;
    session!.scriptManager.getScriptSource = getScriptSource as never;
    jest.spyOn(runtime.storage, 'searchScriptChunks').mockResolvedValue({
      total: 0,
      items: [],
    } as never);

    const search = parseToolResponse(
      await executor.execute('inspect.scripts', {
        sessionId,
        action: 'search',
        keyword: 'webSign',
        searchMode: 'indexed',
        indexPolicy: 'deep',
        maxResults: 12,
        maxBytes: 1024,
      }),
    );

    expect(search.ok).toBe(true);
    expect((search.data as { totalMatches: number }).totalMatches).toBeGreaterThan(0);

    const metadataCalls = getScripts.mock.calls
      .map(([options]) => options as { includeSource?: boolean; maxScripts?: number })
      .filter((options) => options?.includeSource !== true);

    expect(metadataCalls.some((options) => (options?.maxScripts ?? Number.MAX_SAFE_INTEGER) <= 24)).toBe(true);
    expect(getScriptSource).toHaveBeenCalled();
    expect(getScriptSource.mock.calls.length).toBeLessThanOrEqual(scripts.length);
  });

  test('keeps signature-path analysis alive when one candidate script fails ranking', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'broken-script',
        url: 'https://example.test/broken.js',
        source: 'function brokenSigner(){ return "BROKEN_sign"; }',
        sourceLength: 48,
      },
      {
        scriptId: 'healthy-script',
        url: 'https://example.test/healthy.js',
        source: 'function healthySigner(){ return "signature-token"; }',
        sourceLength: 54,
      },
    ])) as never;

    const rankSpy = jest.spyOn(runtime.functionRanker, 'rank').mockImplementation((source: string) => {
      if (String(source).includes('BROKEN_sign')) {
        throw new Error('ranking exploded');
      }

      return [
        {
          name: 'healthySigner',
          line: 1,
          score: 9,
          reasons: ['request-signing-keywords'],
          preview: 'function healthySigner(){ return "signature-token"; }',
        },
      ];
    });

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'signature',
      }),
    );

    rankSpy.mockRestore();

    expect(result.ok).toBe(true);
    expect((result.data as Array<{ scriptId: string }>)[0]?.scriptId).toBe('healthy-script');
  });

  test('returns actionable breakpoint recommendations for top signature candidates', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'candidate-script',
        url: 'https://example.test/app.js',
        source: `
          function createSignature(payload) {
            const token = payload.nonce + '-sig';
            return token;
          }
          window.api.sign = createSignature;
        `,
        sourceLength: 160,
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'signature',
      }),
    );

    const firstCandidate = (result.data as Array<{ recommendedActions?: Array<{ tool: string; action?: string; lineNumber?: number }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.breakpoint' && item.action === 'set')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.watch' && item.action === 'add')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.xhr' && item.action === 'set')).toBe(true);
  });

  test('adds pause-on-exception fallback when recent exceptions mention the request pattern', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'candidate-script',
        url: 'https://example.test/app.js',
        source: 'const marker = "chatDebugTokenizer";',
        sourceLength: 40,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => ([
      {
        text: 'Policy "chatDebugTokenizer" disallowed.',
        url: 'https://example.test/app.js',
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ recommendedActions?: Array<{ tool: string; action?: string; state?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.breakpoint' && item.action === 'setOnException' && item.state === 'uncaught')).toBe(true);
  });

  test('derives a precise breakpoint from an observed exception stack frame', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/target.js',
        source: 'const marker = "chatDebugTokenizer";',
        sourceLength: 40,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => ([
      {
        text: 'TypeError: fail\\n    at boot (https://example.test/target.js:3087:17)',
        url: 'https://example.test/target.js',
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ recommendedActions?: Array<{ verification?: string; lineNumber?: number; columnNumber?: number }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.verification === 'observed-exception-stack' && item.lineNumber === 3086 && item.columnNumber === 16)).toBe(true);
  });

  test('builds a fallback candidate from exception stacks when scripts are not yet hydrated', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'inline-script',
        url: '',
        source: 'function bootstrap(){ return 1; }',
        sourceLength: 32,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => ([
      {
        text: 'TypeError: Policy \"chatDebugTokenizer\" disallowed.\\n    at boot (https://example.test/main.js:3087:17)',
        url: 'https://example.test/main.js',
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ url?: string; derivedFrom?: string; preferredAction?: { verification?: string } }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.url).toBe('https://example.test/main.js');
    expect(firstCandidate?.derivedFrom).toBe('exception-stack');
    expect(firstCandidate?.preferredAction?.verification).toBe('observed-exception-stack');
  });

  test('builds a fallback candidate from paused-state exception descriptions when console exceptions are unavailable', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'inline-script',
        url: '',
        source: 'function bootstrap(){ return 1; }',
        sourceLength: 32,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => []) as never;
    session!.debuggerManager.getPausedState = jest.fn(() => ({
      data: {
        description: 'TypeError: Policy \"chatDebugTokenizer\" disallowed.\\n    at boot (https://example.test/main.js:3087:17)',
      },
      callFrames: [
        {
          url: '',
          location: {
            scriptId: 'inline-script',
            lineNumber: 1,
            columnNumber: 61,
          },
        },
      ],
    })) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ url?: string; derivedFrom?: string; recommendedActions?: Array<{ verification?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.url).toBe('https://example.test/main.js');
    expect(firstCandidate?.derivedFrom).toBe('exception-stack');
    expect(firstCandidate?.recommendedActions?.some((item) => item.verification === 'observed-exception-stack')).toBe(true);
  });

  test('prefers the top frame of an observed exception pause when it matches the target script', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/main.js',
        source: 'const marker = "chatDebugTokenizer";',
        sourceLength: 40,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => []) as never;
    session!.debuggerManager.getPausedState = jest.fn(() => ({
      data: {
        description: 'TypeError: Policy fail\\n    at boot (https://example.test/main.js:3087:17)',
      },
      callFrames: [
        {
          url: '',
          location: {
            scriptId: 'some-runtime-frame',
            lineNumber: 405,
            columnNumber: 74888,
          },
        },
      ],
    })) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ preferredAction?: { verification?: string; lineNumber?: number; columnNumber?: number } }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.preferredAction?.verification).toBe('observed-exception-top-frame');
    expect(firstCandidate?.preferredAction?.lineNumber).toBe(405);
    expect(firstCandidate?.preferredAction?.columnNumber).toBe(74888);
  });

  test('prefers exception-stack breakpoints over the current paused location for promise rejections', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/main.js',
        source: 'const marker = "chatDebugTokenizer";',
        sourceLength: 40,
      },
    ])) as never;
    session!.consoleMonitor.getExceptions = jest.fn(() => []) as never;
    session!.debuggerManager.getPausedState = jest.fn(() => ({
      reason: 'promiseRejection',
      data: {
        description: [
          'Canceled: Canceled',
          '    at Og (https://example.test/main.js:489:23480)',
          '    at https://example.test/main.js:3087:17',
        ].join('\n'),
      },
      callFrames: [
        {
          url: '',
          location: {
            scriptId: 'target-script',
            lineNumber: 405,
            columnNumber: 74888,
          },
        },
      ],
    })) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ preferredAction?: { verification?: string; lineNumber?: number; columnNumber?: number } }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.preferredAction?.verification).toBe('observed-exception-stack');
    expect(firstCandidate?.preferredAction?.lineNumber).toBe(488);
    expect(firstCandidate?.preferredAction?.columnNumber).toBe(23479);
  });

  test('prefers an observed paused location over heuristic breakpoints when one is available', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/target.js',
        source: 'const marker = "chatDebugTokenizer";',
        sourceLength: 40,
      },
    ])) as never;
    session!.debuggerManager.getPausedState = jest.fn(() => ({
      callFrames: [
        {
          url: 'https://example.test/target.js',
          location: {
            scriptId: 'target-script',
            lineNumber: 404,
            columnNumber: 74888,
          },
        },
      ],
    })) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ preferredAction?: { verification?: string; lineNumber?: number } }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.preferredAction?.verification).toBe('observed-paused-location');
    expect(firstCandidate?.preferredAction?.lineNumber).toBe(404);
  });

  test('prioritizes exact request-pattern hits when ranking signature candidates', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'generic-script',
        url: 'https://example.test/generic.js',
        source: 'function signer(){ const token = nonce + timestamp; return token; }',
        sourceLength: 72,
      },
      {
        scriptId: 'target-script',
        url: 'https://example.test/target.js',
        source: ['function boot(){ return 1; }', 'const marker = "chatDebugTokenizer";', 'window.tt.createPolicy("chatDebugTokenizer");'].join('\n'),
        sourceLength: 120,
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ scriptId: string; recommendedActions?: Array<{ keyword?: string; lineNumber?: number }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect(firstCandidate?.recommendedActions?.[0]?.keyword?.toLowerCase()).toBe('chatdebugtokenizer');
    expect(firstCandidate?.recommendedActions?.[0]?.lineNumber).toBe(1);
    expect(typeof firstCandidate?.recommendedActions?.[0]?.columnNumber).toBe('number');
  });

  test('keeps exact keyword-hit candidates even when function ranking fails on that script', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/target.js',
        source: ['const marker = "chatDebugTokenizer";', 'window.tt.createPolicy("chatDebugTokenizer");'].join('\n'),
        sourceLength: 96,
      },
    ])) as never;

    const rankSpy = jest.spyOn(runtime.functionRanker, 'rank').mockImplementation(() => {
      throw new Error('parser exploded');
    });

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    rankSpy.mockRestore();

    const firstCandidate = (result.data as Array<{ scriptId: string; rankedFunctions?: unknown[]; recommendedActions?: Array<{ keyword?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect(firstCandidate?.rankedFunctions || []).toHaveLength(0);
    expect(firstCandidate?.recommendedActions?.[0]?.keyword?.toLowerCase()).toBe('chatdebugtokenizer');
  });

  test('drops generic keyword breakpoint noise when exact request-pattern evidence already exists', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/target.js',
        source: [
          'const marker = "chatDebugTokenizer";',
          'const sign = true;',
          'window.tt.createPolicy("chatDebugTokenizer");',
        ].join('\n'),
        sourceLength: 96,
      },
    ])) as never;

    const result = parseToolResponse(
      await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: 'chatDebugTokenizer',
      }),
    );

    const firstCandidate = (result.data as Array<{ recommendedActions?: Array<{ verification?: string; keyword?: string }> }>)[0];
    const staticKeywordBreakpoints = (firstCandidate?.recommendedActions || []).filter((item) => item.verification === 'static-keyword-hit');

    expect(result.ok).toBe(true);
    expect(staticKeywordBreakpoints.some((item) => item.keyword === 'sign')).toBe(false);
  });

  test('restores network monitoring after browser recovery', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const recover = parseToolResponse(await executor.execute('browser.recover', { sessionId }));
    expect(recover.ok).toBe(true);
    expect(((recover.data as { status: { network: { enabled: boolean } } }).status.network || {}).enabled).toBe(true);

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html?recovered=1`,
      enableNetworkCapture: true,
    });

    const network = parseToolResponse(await executor.execute('inspect.network', { sessionId, limit: 10 }));
    expect(((network.data as { stats: { totalRequests: number } }).stats || {}).totalRequests).toBeGreaterThan(0);
  });
});
