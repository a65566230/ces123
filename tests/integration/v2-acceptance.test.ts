import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2-only acceptance scenarios', () => {
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

  test('accepts a songmid-style explicit-field path through V2-only workflow recommendations', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'vendor-react',
        url: 'https://example.test/vendor/react.production.min.js',
        source: 'function useState(){return 1;}',
        sourceLength: 32,
      },
      {
        scriptId: 'songmid-script',
        url: 'https://example.test/app-songmid.js',
        source: [
          'function buildSongRequest(songmid) {',
          '  const payload = { songmid, nonce: "fixture" };',
          '  return fetch("/api/songmid", { method: "POST", body: JSON.stringify(payload) });',
          '}',
          'window.music.send = buildSongRequest;',
        ].join('\n'),
        sourceLength: 220,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'songmid',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; recommendedActions?: Array<{ tool?: string; action?: string; functionName?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('songmid-script');
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.breakpoint' && item.action === 'set')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'inspect.function-trace' && item.action === 'start')).toBe(true);
  });

  test('accepts a vkey-style derived-field path through V2-only workflow recommendations', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'noise-script',
        url: 'https://example.test/noise.js',
        source: 'function token(){ return Date.now().toString(); }',
        sourceLength: 48,
      },
      {
        scriptId: 'vkey-script',
        url: 'https://example.test/app-vkey.js',
        source: [
          'function deriveVkey(seed) {',
          '  const mixed = seed + "::derived";',
          '  return btoa(mixed).slice(0, 12);',
          '}',
          'function sendVkey(seed) {',
          '  const payload = { vkey: deriveVkey(seed), nonce: seed };',
          '  return fetch("/api/vkey", { method: "POST", body: JSON.stringify(payload) });',
          '}',
          'window.auth.send = sendVkey;',
        ].join('\n'),
        sourceLength: 320,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'vkey',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; recommendedActions?: Array<{ tool?: string; action?: string; type?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('vkey-script');
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'inspect.function-trace' && item.action === 'start')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'inspect.interceptor' && item.action === 'start' && item.type === 'both')).toBe(true);
  });

  test('prioritizes field-aware validation order for final-signature targets', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'vendor-noise',
        url: 'https://example.test/vendor/runtime.js',
        source: 'function runtime(){ return 1; }',
        sourceLength: 32,
      },
      {
        scriptId: 'target-script',
        url: 'https://example.test/final-vkey.js',
        source: [
          'function finalizePayload(seed) {',
          '  const payload = { nonce: seed, vkey: btoa(seed + "::final") };',
          '  return fetch("/api/vkey", { method: "POST", body: JSON.stringify(payload) });',
          '}',
          'window.auth.finalize = finalizePayload;',
        ].join('\n'),
        sourceLength: 240,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: '/api/vkey',
      targetField: 'vkey',
      fieldRole: 'final-signature',
      preferredValidation: ['inspect.function-trace', 'inspect.interceptor', 'debug.blackbox'],
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; recommendedActions?: Array<{ tool?: string; action?: string }> }>)[0];
    const recommendedActions = firstCandidate?.recommendedActions || [];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect(recommendedActions[0]?.tool).toBe('inspect.function-trace');
    expect(recommendedActions[1]?.tool).toBe('inspect.interceptor');
    expect(recommendedActions.some((item) => item.tool === 'debug.blackbox')).toBe(true);
  });

  test('accepts a high-noise target by recommending blackbox along with dynamic validation actions', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'react-vendor',
        url: 'https://example.test/vendor/react.production.min.js',
        source: 'function useState(){return 1;}',
        sourceLength: 32,
      },
      {
        scriptId: 'lodash-vendor',
        url: 'https://example.test/vendor/lodash.min.js',
        source: 'function debounce(){return 1;}',
        sourceLength: 34,
      },
      {
        scriptId: 'analytics-vendor',
        url: 'https://example.test/vendor/analytics.bundle.min.js',
        source: 'function track(){return "noise";}',
        sourceLength: 38,
      },
      {
        scriptId: 'target-script',
        url: 'https://example.test/app-noise.js',
        source: [
          'function finalizeSignature(input) {',
          '  const payload = { signature: input + "-sig", nonce: input };',
          '  return fetch("/api/signature", { method: "POST", body: JSON.stringify(payload) });',
          '}',
          'window.signing.send = finalizeSignature;',
        ].join('\n'),
        sourceLength: 220,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'signature',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; recommendedActions?: Array<{ tool?: string; action?: string }> }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'debug.blackbox' && item.action === 'addCommon')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'inspect.function-trace' && item.action === 'start')).toBe(true);
    expect(firstCandidate?.recommendedActions?.some((item) => item.tool === 'inspect.interceptor' && item.action === 'start')).toBe(true);
  });

  test('promotes hot scripts when coverage evidence exists for the session', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    runtime.evidence.create('coverage-analysis', 'Coverage analysis completed', {
      summary: {
        hotScripts: [
          {
            scriptId: 'hot-script',
            url: 'https://example.test/hot.js',
            usedBytes: 512,
            coveragePercentage: 88,
          },
        ],
      },
    }, sessionId);

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'cold-script',
        url: 'https://example.test/cold.js',
        source: 'function sendToken(){ return fetch("/api/token"); }',
        sourceLength: 48,
      },
      {
        scriptId: 'hot-script',
        url: 'https://example.test/hot.js',
        source: 'function sendToken(){ return fetch("/api/token"); }',
        sourceLength: 48,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'token',
      targetField: 'token',
      fieldRole: 'derived',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; score?: number }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('hot-script');
    expect(typeof firstCandidate?.score).toBe('number');
  });

  test('promotes candidates when prior hook evidence observed the target field on a matching object path', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    runtime.evidence.create('hook-data', 'Captured hook data loaded', {
      hookId: 'evd-hook-1',
      metadata: {
        target: 'window.auth.send',
      },
      summary: {
        targetField: 'vkey',
        targetFieldObserved: true,
        rerankHint: 'promote-candidate',
      },
    }, sessionId);

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'other-script',
        url: 'https://example.test/other.js',
        source: [
          'window.misc.emit = function(seed) {',
          '  const payload = { vkey: seed };',
          '  return payload;',
          '};',
        ].join('\n'),
        sourceLength: 120,
      },
      {
        scriptId: 'target-script',
        url: 'https://example.test/auth.js',
        source: [
          'window.auth.send = function(seed) {',
          '  const payload = { vkey: btoa(seed), nonce: seed };',
          '  return fetch("/api/vkey", { method: "POST", body: JSON.stringify(payload) });',
          '};',
        ].join('\n'),
        sourceLength: 180,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'vkey',
      targetField: 'vkey',
      fieldRole: 'derived',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; score?: number }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect(typeof firstCandidate?.score).toBe('number');
  });

  test('filters environment object-path noise before surfacing signature candidates', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();

    session!.engine.getScripts = jest.fn(async () => ([
      {
        scriptId: 'target-script',
        url: 'https://example.test/mtop-auth.js',
        source: [
          'window.navigator.webdriver = false;',
          'window.navigator.userAgent = "mock";',
          'window.auth.send = function(payload) {',
          '  payload.sign = btoa(payload.nonce);',
          '  return fetch("/api/mtop", { method: "POST", body: JSON.stringify(payload) });',
          '};',
        ].join('\n'),
        sourceLength: 220,
      },
    ])) as never;

    const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
      sessionId,
      requestPattern: 'mtop',
      targetField: 'sign',
      fieldRole: 'final-signature',
    }));

    const firstCandidate = (result.data as Array<{ scriptId?: string; objectPaths?: string[] }>)[0];

    expect(result.ok).toBe(true);
    expect(firstCandidate?.scriptId).toBe('target-script');
    expect((firstCandidate?.objectPaths || []).some((item) => item === 'window.auth.send')).toBe(true);
    expect((firstCandidate?.objectPaths || []).some((item) => item.startsWith('window.navigator.'))).toBe(false);
  });
});
