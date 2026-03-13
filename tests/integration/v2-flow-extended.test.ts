import fs from 'fs/promises';
import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 extended Playwright flow', () => {
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

  test('collects a site snapshot and builds a reverse report', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const collect = parseToolResponse(await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    }));
    expect(collect.ok).toBe(true);
    expect(collect.sessionId).toBe(sessionId);
    expect(collect.artifactId).toBeDefined();

    const dom = parseToolResponse(await executor.execute('inspect.dom', {
      sessionId,
      action: 'query',
      selector: '#action',
    }));
    expect((dom.data as { found: boolean }).found).toBe(true);

    const report = parseToolResponse(await executor.execute('flow.reverse-report', {
      sessionId,
      focus: 'overview',
    }));
    expect(report.ok).toBe(true);
    expect((report.data as { session: { sessionId: string } }).session.sessionId).toBe(sessionId);
    expect(Array.isArray(((report.data as { debugPlan?: { actions?: unknown[] } }).debugPlan || {}).actions)).toBe(true);
  });

  test('resolves a source map from a captured script', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/sourcemap/index.html`,
    });

    const scripts = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
      includeSource: true,
    }));
    const bundle = (scripts.data as Array<{ scriptId: string; url: string }>).find((item) => item.url.includes('bundle.min.js'));
    expect(bundle).toBeDefined();

    const sourceMap = parseToolResponse(await executor.execute('analyze.source-map', {
      sessionId,
      scriptId: bundle!.scriptId,
    }));
    expect((sourceMap.data as { hasSourceMap: boolean }).hasSourceMap).toBe(true);
    expect(((sourceMap.data as { sources?: string[] }).sources || []).length).toBeGreaterThan(0);
  });

  test('supports manifest-first collection, indexed script search, recovery, and obfuscation analysis', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const collect = parseToolResponse(
      await executor.execute('flow.collect-site', {
        sessionId,
        url: `${fixture.origin}/basic/index.html`,
        collectionStrategy: 'manifest',
        waitProfile: 'interactive',
        budgets: {
          maxScripts: 20,
          maxBytes: 65_536,
          maxRequests: 30,
        },
      })
    );

    expect(collect.ok).toBe(true);
    expect((collect.data as { manifest: { scripts: unknown[] } }).manifest.scripts.length).toBeGreaterThan(0);
    expect((collect.data as { siteProfile: { totalScripts: number } }).siteProfile.totalScripts).toBeGreaterThan(0);

    const search = parseToolResponse(
      await executor.execute('inspect.scripts', {
        sessionId,
        action: 'search',
        keyword: 'fetch',
        searchMode: 'indexed',
        indexPolicy: 'deep',
        maxResults: 10,
        maxBytes: 4_096,
      })
    );

    expect((search.data as { searchMode: string }).searchMode).toBe('indexed');
    expect((search.data as { executionMode: string }).executionMode).toBe('worker');
    expect(((search.data as { matches: Array<{ chunkRef: string }> }).matches || [])[0]?.chunkRef).toBeDefined();

    const obfuscation = parseToolResponse(
      await executor.execute('analyze.obfuscation', {
        code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}',
      })
    );
    expect(((obfuscation.data as { detected: { types: string[] } }).detected.types || [])).toContain('javascript-obfuscator');

    const deobfuscation = parseToolResponse(
      await executor.execute('analyze.deobfuscate', {
        code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}',
      })
    );
    expect(((deobfuscation.data as { pipelineStages: string[] }).pipelineStages || []).slice(0, 3)).toEqual([
      'detect',
      'normalize',
      'static-passes',
    ]);
    expect((deobfuscation.data as { cached?: boolean }).cached).toBe(false);

    const deobfuscationCached = parseToolResponse(
      await executor.execute('analyze.deobfuscate', {
        code: 'var _0xabc=["token"];function signer(){return _0xabc[0];}',
      })
    );
    expect((deobfuscationCached.data as { cached?: boolean }).cached).toBe(true);

    const recover = parseToolResponse(await executor.execute('browser.recover', { sessionId }));
    expect(recover.ok).toBe(true);
    expect((recover.data as { recoveryCount: number }).recoveryCount).toBeGreaterThanOrEqual(1);
  });

  test('surfaces degraded engine health through browser.status after a runtime failure is recorded', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();
    session!.engine.markFailure('browser-disconnected', new Error('Playwright browser disconnected'), true);

    const status = parseToolResponse(await executor.execute('browser.status', { sessionId }));

    expect(status.ok).toBe(true);
    expect((status.data as { health?: string }).health).toBe('degraded');
    expect((status.data as { recoverable?: boolean }).recoverable).toBe(true);
    expect(((status.data as { lastFailure?: { code?: string } }).lastFailure || {}).code).toBe('browser-disconnected');
    expect(((status.nextActions as string[]) || []).some((item) => item.includes('browser.recover'))).toBe(true);
  });

  test('supports natural-language hook generation for decrypt/signature workflows', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const generated = parseToolResponse(
      await executor.execute('flow.generate-hook', {
        sessionId,
        description: '自动破解 basicFixture.sign 加密并捕获返回值',
      }),
    );

    expect(generated.ok).toBe(true);
    expect(((generated.data as { generated: { success: boolean } }).generated || {}).success).toBe(true);
    expect(((generated.data as { generated: { strategy?: { source?: string } } }).generated.strategy || {}).source).toBe('rag');
    expect(((generated.data as { generated: { generatedCode: string } }).generated || {}).generatedCode).toContain('__aiHooks');
  });

  test('supports paginated script search and exposes runtime monitor stats', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const search = parseToolResponse(
      await executor.execute('inspect.scripts', {
        sessionId,
        action: 'search',
        keyword: 'window',
        page: 1,
        pageSize: 1,
      }),
    );

    expect((search.data as { page: { pageSize: number; hasMore: boolean } }).page.pageSize).toBe(1);
    expect(typeof (search.data as { page: { hasMore: boolean } }).page.hasMore).toBe('boolean');

    const status = parseToolResponse(await executor.execute('browser.status', { sessionId }));
    expect((status.data as { runtimeMonitor: { memory: { rss: number } } }).runtimeMonitor.memory.rss).toBeGreaterThan(0);
  });

  test('supports direct code understanding and crypto analysis entrypoints', async () => {
    const code = `
      function buildSignature(input) {
        const payload = JSON.stringify(input);
        return CryptoJS.MD5(payload).toString();
      }
    `;

    const understand = parseToolResponse(
      await executor.execute('analyze.understand', {
        code,
        focus: 'security',
      }),
    );
    expect(understand.ok).toBe(true);
    expect(((understand.data as { structure: { functions: Array<unknown> } }).structure.functions || []).length).toBeGreaterThan(0);

    const crypto = parseToolResponse(
      await executor.execute('analyze.crypto', {
        code,
        useAI: false,
      }),
    );
    expect(crypto.ok).toBe(true);
    expect(((crypto.data as { algorithms: Array<{ name: string }> }).algorithms || []).some((item) => item.name.toUpperCase().includes('MD5'))).toBe(true);
  });

  test('supports session-backed analyze.coverage lifecycle for hot scripts', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const started = parseToolResponse(await executor.execute('analyze.coverage', {
      sessionId,
      action: 'start',
    }));

    expect(started.ok).toBe(true);
    expect(((started.data as { active?: boolean }).active)).toBe(true);

    await executor.execute('inspect.runtime', {
      sessionId,
      expression: `
        Promise.all([
          Promise.resolve(window.basicFixture.sign({ nonce: 'coverage-a' })),
          Promise.resolve(window.basicFixture.sign({ nonce: 'coverage-b' })),
          fetch('/api/sign', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nonce: 'coverage-nonce' }),
          }).then((response) => response.json())
        ])
      `,
    });

    const stopped = parseToolResponse(await executor.execute('analyze.coverage', {
      sessionId,
      action: 'stop',
      maxScripts: 3,
    }));

    expect(stopped.ok).toBe(true);
    expect(((stopped.data as { summary?: { totalScripts?: number } }).summary || {}).totalScripts).toBeGreaterThan(0);
    expect((((stopped.data as { summary?: { hotScripts?: Array<{ url?: string }> } }).summary || {}).hotScripts || []).some((item) => String(item.url || '').includes('/basic/app.js'))).toBe(true);
    expect((((stopped.data as { recommendedActions?: Array<{ tool: string; action?: string; scriptId?: string; url?: string }> }).recommendedActions || []).some((item) => item.tool === 'inspect.scripts' && item.action === 'source' && (typeof item.scriptId === 'string' || typeof item.url === 'string')))).toBe(true);
    expect((((stopped.data as { recommendedActions?: Array<{ tool: string; scriptId?: string; url?: string }> }).recommendedActions || []).some((item) => item.tool === 'analyze.rank-functions' && (typeof item.scriptId === 'string' || typeof item.url === 'string')))).toBe(true);

    const summary = parseToolResponse(await executor.execute('analyze.coverage', {
      sessionId,
      action: 'summary',
      maxScripts: 2,
    }));

    expect(summary.ok).toBe(true);
    expect(((summary.data as { active?: boolean }).active)).toBe(false);
    expect((((summary.data as { summary?: { hotScripts?: Array<{ url?: string }> } }).summary || {}).hotScripts || []).length).toBeGreaterThan(0);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports grouped browser.storage actions for cookies, localStorage, and sessionStorage', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const setCookies = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'set',
      target: 'cookies',
      cookies: [
        {
          name: 'v2_cookie',
          value: 'ok',
          url: fixture.origin,
        },
      ],
    }));
    expect(setCookies.ok).toBe(true);

    const getCookies = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'get',
      target: 'cookies',
    }));
    expect((((getCookies.data as { cookies?: Array<{ name: string; value: string }> }).cookies) || []).some((cookie) => cookie.name === 'v2_cookie' && cookie.value === 'ok')).toBe(true);

    const setLocal = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'set',
      target: 'local',
      entries: {
        localToken: 'abc123',
        localNonce: 'nonce-1',
      },
    }));
    expect(setLocal.ok).toBe(true);

    const getLocal = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'get',
      target: 'local',
    }));
    expect(((getLocal.data as { entries?: Record<string, string> }).entries || {}).localToken).toBe('abc123');

    const setSession = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'set',
      target: 'session',
      entries: {
        sessionToken: 'xyz789',
      },
    }));
    expect(setSession.ok).toBe(true);

    const getSession = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'get',
      target: 'session',
    }));
    expect(((getSession.data as { entries?: Record<string, string> }).entries || {}).sessionToken).toBe('xyz789');

    const clearLocal = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'clear',
      target: 'local',
    }));
    expect(clearLocal.ok).toBe(true);
    expect((clearLocal.data as { cleared?: boolean }).cleared).toBe(true);

    const clearedLocal = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'get',
      target: 'local',
    }));
    expect(Object.keys((clearedLocal.data as { entries?: Record<string, string> }).entries || {})).toHaveLength(0);

    const clearSession = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'clear',
      target: 'session',
    }));
    expect(clearSession.ok).toBe(true);

    const clearCookies = parseToolResponse(await executor.execute('browser.storage', {
      sessionId,
      action: 'clear',
      target: 'cookies',
    }));
    expect(clearCookies.ok).toBe(true);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports browser.capture screenshot output to a file path', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const screenshotPath = path.resolve(process.cwd(), '.cache-test', `browser-capture-${Date.now()}.png`);

    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const captured = parseToolResponse(await executor.execute('browser.capture', {
      sessionId,
      action: 'screenshot',
      path: screenshotPath,
      type: 'png',
      fullPage: true,
    }));

    expect(captured.ok).toBe(true);
    expect((captured.data as { path?: string }).path).toBe(screenshotPath);
    expect((captured.data as { type?: string }).type).toBe('png');
    expect((captured.data as { fullPage?: boolean }).fullPage).toBe(true);
    expect((captured.data as { sizeBytes?: number }).sizeBytes || 0).toBeGreaterThan(0);

    const file = await fs.stat(screenshotPath);
    expect(file.size).toBeGreaterThan(0);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports browser.interact for wait, type, and click actions', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const waited = parseToolResponse(await executor.execute('browser.interact', {
      sessionId,
      action: 'waitForSelector',
      selector: '#message',
      timeout: 2000,
    }));
    expect(waited.ok).toBe(true);
    expect(((waited.data as { result?: { success?: boolean } }).result || {}).success).toBe(true);

    const typed = parseToolResponse(await executor.execute('browser.interact', {
      sessionId,
      action: 'type',
      selector: '#message',
      text: 'updated-message',
    }));
    expect(typed.ok).toBe(true);

    const value = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `document.querySelector('#message').value`,
    }));
    expect(value.ok).toBe(true);
    expect(value.data).toBe('updated-message');

    const clicked = parseToolResponse(await executor.execute('browser.interact', {
      sessionId,
      action: 'click',
      selector: '#action',
    }));
    expect(clicked.ok).toBe(true);

    const clickedState = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `window.__buttonClicked === true`,
    }));
    expect(clickedState.ok).toBe(true);
    expect(clickedState.data).toBe(true);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports browser.stealth apply before navigation', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const applied = parseToolResponse(await executor.execute('browser.stealth', {
      sessionId,
      action: 'apply',
      platform: 'windows',
    }));
    expect(applied.ok).toBe(true);

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const webdriver = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `navigator.webdriver`,
    }));
    if (!webdriver.ok) {
      // eslint-disable-next-line no-console
      console.log('browser.stealth webdriver payload', JSON.stringify(webdriver, null, 2));
    }
    expect(webdriver.ok).toBe(true);
    expect(webdriver.data).not.toBe(true);

    const vendor = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `navigator.vendor`,
    }));
    expect(vendor.ok).toBe(true);
    expect(vendor.data).toBe('Google Inc.');

    const ua = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `navigator.userAgent`,
    }));
    expect(ua.ok).toBe(true);
    expect(String(ua.data)).toContain('Windows');

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('keeps browser.stealth idempotent across repeated apply calls', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const firstApply = parseToolResponse(await executor.execute('browser.stealth', {
      sessionId,
      action: 'apply',
      platform: 'windows',
    }));
    expect(firstApply.ok).toBe(true);

    const secondApply = parseToolResponse(await executor.execute('browser.stealth', {
      sessionId,
      action: 'apply',
      platform: 'windows',
    }));
    expect(secondApply.ok).toBe(true);

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const network = parseToolResponse(await executor.execute('inspect.network', {
      sessionId,
      limit: 5,
    }));

    expect(
      (((network.data as { exceptions?: Array<{ text?: string }> }).exceptions) || []).some((item) =>
        String(item.text || '').includes('Cannot redefine property'),
      ),
    ).toBe(false);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports browser.captcha config, detect, and wait actions', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const config = parseToolResponse(await executor.execute('browser.captcha', {
      sessionId,
      action: 'config',
      autoDetectCaptcha: false,
      autoSwitchHeadless: false,
      captchaTimeout: 1500,
    }));
    expect(config.ok).toBe(true);
    expect(((config.data as { config?: { autoDetectCaptcha?: boolean } }).config || {}).autoDetectCaptcha).toBe(false);
    expect(((config.data as { config?: { captchaTimeout?: number } }).config || {}).captchaTimeout).toBe(1500);

    const detected = parseToolResponse(await executor.execute('browser.captcha', {
      sessionId,
      action: 'detect',
    }));
    expect(detected.ok).toBe(true);
    expect((detected.data as { captchaDetected?: boolean }).captchaDetected).toBe(false);

    const waited = parseToolResponse(await executor.execute('browser.captcha', {
      sessionId,
      action: 'wait',
      timeout: 200,
    }));
    expect(waited.ok).toBe(true);
    expect((waited.data as { completed?: boolean }).completed).toBe(true);

    const closed = parseToolResponse(await executor.execute('browser.close', { sessionId }));
    expect(closed.ok).toBe(true);
  });

  test('supports direct breakpoint and watch entrypoints in the debug group', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const scripts = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
    }));
    const targetScript = (scripts.data as Array<{ scriptId: string; url: string }>).find((item) => item.url.includes('app.js'));
    expect(targetScript).toBeDefined();

    const debugEnabled = parseToolResponse(await executor.execute('debug.control', {
      sessionId,
      action: 'enable',
    }));
    expect(debugEnabled.ok).toBe(true);

    const breakpoint = parseToolResponse(await executor.execute('debug.breakpoint', {
      sessionId,
      action: 'set',
      scriptId: targetScript!.scriptId,
      lineNumber: 0,
    }));
    expect(breakpoint.ok).toBe(true);
    expect((breakpoint.data as { breakpoint: { breakpointId: string } }).breakpoint.breakpointId).toBeDefined();

    const breakpointList = parseToolResponse(await executor.execute('debug.breakpoint', {
      sessionId,
      action: 'list',
    }));
    expect(((breakpointList.data as { breakpoints: Array<unknown> }).breakpoints || []).length).toBeGreaterThan(0);

    const watchAdd = parseToolResponse(await executor.execute('debug.watch', {
      sessionId,
      action: 'add',
      expression: 'window.location.href',
      name: 'currentUrl',
    }));
    expect(watchAdd.ok).toBe(true);
    expect((watchAdd.data as { watchId: string }).watchId).toBeDefined();

    const watchEvaluate = parseToolResponse(await executor.execute('debug.watch', {
      sessionId,
      action: 'evaluate',
    }));
    expect(watchEvaluate.ok).toBe(true);
    expect(((watchEvaluate.data as { results: Array<{ value: string }> }).results || [])[0]?.value).toContain('/basic/index.html');
  });

  test('supports xhr, event, and blackbox expert entrypoints in the debug group', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const debugEnabled = parseToolResponse(await executor.execute('debug.control', {
      sessionId,
      action: 'enable',
    }));
    expect(debugEnabled.ok).toBe(true);

    const xhrSet = parseToolResponse(await executor.execute('debug.xhr', {
      sessionId,
      action: 'set',
      urlPattern: '/api/sign',
    }));
    expect(xhrSet.ok).toBe(true);
    expect((xhrSet.data as { breakpointId: string }).breakpointId).toBeDefined();

    const xhrList = parseToolResponse(await executor.execute('debug.xhr', {
      sessionId,
      action: 'list',
    }));
    expect(((xhrList.data as { breakpoints: Array<unknown> }).breakpoints || []).length).toBeGreaterThan(0);

    const eventSet = parseToolResponse(await executor.execute('debug.event', {
      sessionId,
      action: 'set',
      eventName: 'click',
    }));
    expect(eventSet.ok).toBe(true);
    expect((eventSet.data as { breakpointId: string }).breakpointId).toBeDefined();

    const eventList = parseToolResponse(await executor.execute('debug.event', {
      sessionId,
      action: 'list',
    }));
    expect(((eventList.data as { breakpoints: Array<unknown> }).breakpoints || []).length).toBeGreaterThan(0);

    const blackboxAdd = parseToolResponse(await executor.execute('debug.blackbox', {
      sessionId,
      action: 'add',
      urlPattern: '*app.js',
    }));
    expect(blackboxAdd.ok).toBe(true);

    const blackboxList = parseToolResponse(await executor.execute('debug.blackbox', {
      sessionId,
      action: 'list',
    }));
    expect(((blackboxList.data as { patterns: string[] }).patterns || [])).toContain('*app.js');

    const blackboxRemove = parseToolResponse(await executor.execute('debug.blackbox', {
      sessionId,
      action: 'remove',
      urlPattern: '*app.js',
    }));
    expect(blackboxRemove.ok).toBe(true);
    expect((blackboxRemove.data as { removed: boolean }).removed).toBe(true);
  });

  test('supports compact response mode for script and network inspection', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'manifest',
    });

    const scripts = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
      responseMode: 'compact',
    }));
    expect((scripts.data as { format: string }).format).toBe('table');
    expect(((scripts.data as { columns: string[] }).columns || [])).toContain('scriptId');

    const network = parseToolResponse(await executor.execute('inspect.network', {
      sessionId,
      responseMode: 'compact',
    }));
    expect(((network.data as { requests: { format: string } }).requests || {}).format).toBe('table');
    expect((((network.data as { requests: { columns: string[] } }).requests || {}).columns || [])).toContain('requestId');
  });

  test('supports compact response mode for request tracing', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'manifest',
    });

    const trace = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      responseMode: 'compact',
    }));

    expect(trace.ok).toBe(true);
    expect(((trace.data as { requests: { format: string } }).requests || {}).format).toBe('table');
    expect((((trace.data as { requests: { columns: string[] } }).requests || {}).columns || [])).toContain('requestId');
  });

  test('compacts field-aware trace collections when responseMode is compact', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const trace = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      targetField: 'signature',
      fieldRole: 'final-signature',
      responseMode: 'compact',
    }));

    expect(trace.ok).toBe(true);
    expect(((trace.data as { candidateScripts?: { format?: string } }).candidateScripts || {}).format).toBe('table');
    expect(((trace.data as { candidateFunctions?: { format?: string } }).candidateFunctions || {}).format).toBe('table');
    expect(((trace.data as { finalWriteHints?: { format?: string } }).finalWriteHints || {}).format).toBe('table');
  });

  test('returns field-aware correlation hints from flow.trace-request', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const trace = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      targetField: 'signature',
      fieldRole: 'final-signature',
      preferredValidation: ['inspect.interceptor', 'inspect.function-trace', 'debug.blackbox'],
    }));

    expect(trace.ok).toBe(true);
    expect((((trace.data as { candidateScripts?: Array<{ url?: string }> }).candidateScripts) || []).some((item) => String(item.url || '').includes('/basic/app.js'))).toBe(true);
    expect((((trace.data as { candidateFunctions?: Array<{ name?: string }> }).candidateFunctions) || []).length).toBeGreaterThan(0);
    expect((((trace.data as { candidateObjectPaths?: string[] }).candidateObjectPaths) || []).some((item) => item.includes('basicFixture.sign'))).toBe(true);
    expect(Array.isArray((trace.data as { payloadAssemblyHints?: unknown[] }).payloadAssemblyHints)).toBe(true);
    expect(Array.isArray((trace.data as { finalWriteHints?: unknown[] }).finalWriteHints)).toBe(true);
    expect(Array.isArray((trace.data as { finalPayloadHints?: unknown[] }).finalPayloadHints)).toBe(true);
    expect((((trace.data as { finalPayloadHints?: Array<{ field?: string; matchedPaths?: string[] }> }).finalPayloadHints) || []).some((item) => item.field === 'signature' && (item.matchedPaths || []).some((path) => path.includes('signature')))).toBe(true);
    expect(((trace.data as { recommendedActions?: Array<{ tool?: string }> }).recommendedActions || [])[0]?.tool).toBe('inspect.interceptor');
    expect((((trace.data as { recommendedHookCandidates?: Array<{ target?: { object?: string; property?: string } }> }).recommendedHookCandidates) || [])[0]?.target?.object).toBe('window.basicFixture');
    expect((((trace.data as { recommendedHookCandidates?: Array<{ target?: { property?: string } }> }).recommendedHookCandidates) || [])[0]?.target?.property).toBe('sign');
    expect(((trace.data as { guidance?: { validationFocus?: string } }).guidance || {}).validationFocus).toBe('final-write');
  });

  test('returns recommendedActions from request tracing and carries source evidence into flow.generate-hook', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'manifest',
    });

    const trace = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
    }));

    expect(trace.ok).toBe(true);
    expect(((trace.data as { recommendedActions?: Array<{ tool: string; action?: string; urlPattern?: string }> }).recommendedActions || []).some((item) => item.tool === 'debug.xhr' && item.action === 'set' && item.urlPattern === '/api/sign')).toBe(true);
    expect(((trace.data as { recommendedActions?: Array<{ tool: string; action?: string; type?: string; urlPattern?: string }> }).recommendedActions || []).some((item) => item.tool === 'inspect.interceptor' && item.action === 'start' && item.type === 'both' && item.urlPattern === '/api/sign')).toBe(true);

    const evidenceIds = (trace.evidenceIds as string[]) || [];
    expect(evidenceIds.length).toBeGreaterThan(0);

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'capture sign flow and surface runtime validation',
      sourceEvidenceIds: [evidenceIds[0]],
    }));

    expect(generated.ok).toBe(true);
    expect(((generated.data as { sourceEvidenceIds?: string[] }).sourceEvidenceIds || [])).toContain(evidenceIds[0]);
    expect(Array.isArray((generated.data as { recommendedActions?: unknown[] }).recommendedActions)).toBe(true);
    expect(((generated.data as { recommendedActions?: Array<{ tool: string; action?: string; type?: string; urlPattern?: string }> }).recommendedActions || []).some((item) => item.tool === 'inspect.interceptor' && item.action === 'start' && item.type === 'both' && item.urlPattern === '/api/sign')).toBe(true);
  });

  test('returns candidate scoring metadata from hook.generate', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const generated = parseToolResponse(await executor.execute('hook.generate', {
      sessionId,
      description: 'trace final signature generation',
      targetField: 'signature',
      fieldRole: 'final-signature',
      preferredHookTypes: ['object-method', 'api'],
    }));

    expect(generated.ok).toBe(true);
    expect(Array.isArray((generated.data as { candidates?: unknown[] }).candidates)).toBe(true);
    expect((((generated.data as { candidates?: unknown[] }).candidates) || []).length).toBeGreaterThan(0);
    expect(Array.isArray((generated.data as { candidateScores?: unknown[] }).candidateScores)).toBe(true);
    expect(Array.isArray((generated.data as { reasoning?: unknown[] }).reasoning)).toBe(true);
    expect(Array.isArray((generated.data as { verification?: unknown[] }).verification)).toBe(true);
  });

  test('filters noisy browser globals from hook.generate candidate ordering for field-focused targets', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const generated = parseToolResponse(await executor.execute('hook.generate', {
      sessionId,
      description: 'trace final nonce generation',
      targetField: 'nonce',
      fieldRole: 'derived',
      preferredHookTypes: ['object-method'],
    }));

    expect(generated.ok).toBe(true);
    expect((((generated.data as { selectedCandidate?: { target?: { object?: string; property?: string } } }).selectedCandidate || {}).target || {}).object).toBe('window.basicFixture');
    expect((((generated.data as { selectedCandidate?: { target?: { property?: string } } }).selectedCandidate || {}).target || {}).property).toBe('sign');
  });

  test('supports hook.inject injectStrategy pre-init behavior', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const injected = parseToolResponse(await executor.execute('hook.inject', {
      sessionId,
      injectStrategy: 'pre-init',
      code: `window.__preInitHook = 'ready';`,
    }));

    expect(injected.ok).toBe(true);
    expect((injected.data as { injectStrategy?: string }).injectStrategy).toBe('pre-init');
    expect((injected.data as { onNewDocument?: boolean }).onNewDocument).toBe(true);

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const value = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: `window.__preInitHook`,
    }));

    expect(value.ok).toBe(true);
    expect(value.data).toBe('ready');
  });

  test('returns candidate competition metadata from flow.generate-hook', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final signature generation',
      targetField: 'signature',
      fieldRole: 'final-signature',
      preferredHookTypes: ['object-method', 'api'],
      injectStrategy: 'auto',
    }));

    expect(generated.ok).toBe(true);
    expect((generated.data as { selectedCandidate?: unknown }).selectedCandidate).toBeDefined();
    expect(Array.isArray((generated.data as { candidateScores?: unknown[] }).candidateScores)).toBe(true);
    expect(Array.isArray((generated.data as { rejectedCandidates?: unknown[] }).rejectedCandidates)).toBe(true);
    expect(Array.isArray((generated.data as { fallbackAttempts?: unknown[] }).fallbackAttempts)).toBe(true);
    expect((generated.data as { hitValidationResult?: { status?: string } }).hitValidationResult?.status).toBe('pending-runtime-validation');
  });

  test('promotes source evidence candidates during flow.generate-hook competition', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    await executor.execute('inspect.runtime', {
      sessionId,
      expression: `
        window.basicFixture.customSign = window.basicFixture.sign;
        'ready';
      `,
    });

    const evidence = runtime.evidence.create('request-trace', 'Synthetic trace candidate for hook competition', {
      candidateObjectPaths: ['window.basicFixture.customSign'],
      candidateFunctions: [
        {
          name: 'customSign',
          score: 999,
          reasons: ['synthetic-source-evidence'],
        },
      ],
      finalWriteHints: [
        {
          field: 'signature',
          lineNumber: 1,
          snippet: 'signature: window.basicFixture.customSign(...)',
        },
      ],
    }, sessionId);

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final signature generation from evidence',
      sourceEvidenceIds: [evidence.id],
      targetField: 'signature',
      fieldRole: 'final-signature',
      preferredHookTypes: ['object-method'],
    }));

    expect(generated.ok).toBe(true);
    expect((((generated.data as { selectedCandidate?: { target?: { object?: string; property?: string } } }).selectedCandidate || {}).target || {}).object).toBe('window.basicFixture');
    expect((((generated.data as { selectedCandidate?: { target?: { property?: string } } }).selectedCandidate || {}).target || {}).property).toBe('customSign');
    expect((((generated.data as { candidateScores?: Array<{ target?: { property?: string } }> }).candidateScores) || []).some((item) => item.target?.property === 'customSign')).toBe(true);
  });

  test('auto-validates injected hook candidates and falls back when the first target misses', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final nonce generation with fallback',
      targetField: 'nonce',
      fieldRole: 'derived',
      injectStrategy: 'runtime',
      autoInject: true,
      validationExpression: `window.basicFixture.sign({ nonce: 'fallback-nonce' })`,
      candidates: [
        {
          target: {
            type: 'function',
            name: 'missingHookTarget',
          },
          score: 0.99,
          reasoning: ['deliberate-miss'],
          verification: ['inspect.function-trace'],
        },
        {
          target: {
            type: 'object-method',
            object: 'window.basicFixture',
            property: 'sign',
            name: 'sign',
          },
          score: 0.75,
          reasoning: ['valid-fallback'],
          verification: ['inspect.function-trace'],
        },
      ],
    }));

    expect(generated.ok).toBe(true);
    expect((generated.data as { autoInjected?: boolean }).autoInjected).toBe(true);
    expect(Array.isArray((generated.data as { fallbackAttempts?: unknown[] }).fallbackAttempts)).toBe(true);
    expect(((generated.data as { fallbackAttempts?: unknown[] }).fallbackAttempts || []).length).toBeGreaterThan(0);
    expect((((generated.data as { selectedCandidate?: { target?: { name?: string; property?: string } } }).selectedCandidate || {}).target || {}).property || (((generated.data as { selectedCandidate?: { target?: { name?: string; property?: string } } }).selectedCandidate || {}).target || {}).name).toBe('sign');
    expect((generated.data as { hitValidationResult?: { status?: string } }).hitValidationResult?.status).toBe('observed-target-field');
  });

  test('auto-competes source-evidence candidates even without explicit candidate inputs', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const evidence = runtime.evidence.create('request-trace', 'Source evidence driven hook competition', {
      candidateObjectPaths: [
        'window.missingFixture.sign',
        'window.basicFixture.sign',
      ],
      finalWriteHints: [
        {
          field: 'nonce',
          lineNumber: 1,
          snippet: 'nonce: window.basicFixture.sign(...)',
        },
      ],
    }, sessionId);

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final nonce generation from source evidence',
      sourceEvidenceIds: [evidence.id],
      targetField: 'nonce',
      fieldRole: 'derived',
      preferredHookTypes: ['object-method'],
      injectStrategy: 'runtime',
      autoInject: true,
      validationExpression: `window.basicFixture.sign({ nonce: 'source-evidence-fallback' })`,
    }));

    expect(generated.ok).toBe(true);
    expect(Array.isArray((generated.data as { fallbackAttempts?: unknown[] }).fallbackAttempts)).toBe(true);
    expect(((generated.data as { fallbackAttempts?: unknown[] }).fallbackAttempts || []).length).toBeGreaterThan(0);
    expect((((generated.data as { selectedCandidate?: { target?: { object?: string; property?: string } } }).selectedCandidate || {}).target || {}).object).toBe('window.basicFixture');
    expect((((generated.data as { selectedCandidate?: { target?: { property?: string } } }).selectedCandidate || {}).target || {}).property).toBe('sign');
    expect((generated.data as { hitValidationResult?: { status?: string } }).hitValidationResult?.status).toBe('observed-target-field');
  });

  test('persists hook-data evidence automatically after flow.generate-hook runtime validation succeeds', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const generated = parseToolResponse(await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final nonce generation and persist validation evidence',
      targetField: 'nonce',
      fieldRole: 'derived',
      injectStrategy: 'runtime',
      autoInject: true,
      validationExpression: `window.basicFixture.sign({ nonce: 'evidence-persisted' })`,
      candidates: [
        {
          target: {
            type: 'object-method',
            object: 'window.basicFixture',
            property: 'sign',
            name: 'sign',
          },
          score: 0.9,
          reasoning: ['direct-valid-target'],
          verification: ['inspect.function-trace'],
        },
      ],
    }));

    expect(generated.ok).toBe(true);
    expect((generated.data as { hitValidationResult?: { status?: string } }).hitValidationResult?.status).toBe('observed-target-field');

    const hookDataEvidence = runtime.evidence
      .listBySession(sessionId)
      .filter((entry) => entry.kind === 'hook-data')
      .pop();

    expect(hookDataEvidence).toBeDefined();
    expect(((hookDataEvidence?.data as { summary?: { targetField?: string } })?.summary || {}).targetField).toBe('nonce');
    expect(((hookDataEvidence?.data as { summary?: { targetFieldObserved?: boolean } })?.summary || {}).targetFieldObserved).toBe(true);
    expect(((hookDataEvidence?.data as { summary?: { rerankHint?: string } })?.summary || {}).rerankHint).toBe('promote-candidate');
    expect((((hookDataEvidence?.data as { metadata?: { target?: { property?: string } } })?.metadata || {}).target || {}).property).toBe('sign');
  });

  test('returns summary metadata from hook.data', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    await executor.execute('hook.inject', {
      sessionId,
      code: `
        window.__aiHooks = window.__aiHooks || {};
        window.__aiHookMetadata = window.__aiHookMetadata || {};
        window.__aiHooks.demoHook = [{ value: 'ok' }];
        window.__aiHookMetadata.demoHook = { target: 'demoHook' };
      `,
    });

    const hookData = parseToolResponse(await executor.execute('hook.data', {
      sessionId,
      hookId: 'demoHook',
    }));

    expect(hookData.ok).toBe(true);
    expect(((hookData.data as { summary?: { totalRecords?: number; hasRecords?: boolean } }).summary || {}).totalRecords).toBe(1);
    expect(((hookData.data as { summary?: { hasRecords?: boolean } }).summary || {}).hasRecords).toBe(true);
    expect(Array.isArray(((hookData.data as { summary?: { suggestedNextActions?: unknown[] } }).summary || {}).suggestedNextActions)).toBe(true);
  });

  test('preserves hook.data summary and references when records are externalized', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    await executor.execute('hook.inject', {
      sessionId,
      code: `
        window.__aiHooks = window.__aiHooks || {};
        window.__aiHookMetadata = window.__aiHookMetadata || {};
        window.__aiHooks.largeHook = Array.from({ length: 160 }, (_, index) => ({
          index,
          payload: 'x'.repeat(256),
        }));
        window.__aiHookMetadata.largeHook = { target: 'largeHook' };
      `,
    });

    const hookData = parseToolResponse(await executor.execute('hook.data', {
      sessionId,
      hookId: 'largeHook',
    }));

    expect(hookData.ok).toBe(true);
    expect(hookData.artifactId).toBeDefined();
    expect(((hookData.data as { summary?: { totalRecords?: number; references?: { artifactId?: string; detailId?: string; evidenceIds?: string[] } } }).summary || {}).totalRecords).toBe(160);
    expect((((hookData.data as { summary?: { references?: { artifactId?: string } } }).summary || {}).references || {}).artifactId).toBe(hookData.artifactId);
    expect(((((hookData.data as { summary?: { references?: { evidenceIds?: string[] } } }).summary || {}).references || {}).evidenceIds || []).length).toBeGreaterThan(0);
  });

  test('adds target-field quality analysis to hook.data summaries', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    await executor.execute('hook.inject', {
      sessionId,
      code: `
        window.__aiHooks = window.__aiHooks || {};
        window.__aiHookMetadata = window.__aiHookMetadata || {};
        window.__aiHooks.fieldHook = [
          {
            payload: { vkey: 'alpha', nonce: 'n1' },
            request: { url: '/api/vkey', body: { vkey: 'alpha' } }
          },
          {
            returnValue: { vkey: 'beta' },
            finalPayload: { vkey: 'beta', signature: 'sig' }
          }
        ];
        window.__aiHookMetadata.fieldHook = { target: 'fieldHook' };
      `,
    });

    const hookData = parseToolResponse(await executor.execute('hook.data', {
      sessionId,
      hookId: 'fieldHook',
      targetField: 'vkey',
    }));

    expect(hookData.ok).toBe(true);
    expect(((hookData.data as { summary?: { targetFieldObserved?: boolean } }).summary || {}).targetFieldObserved).toBe(true);
    expect(((hookData.data as { summary?: { fieldWriteObserved?: boolean } }).summary || {}).fieldWriteObserved).toBe(true);
    expect(((hookData.data as { summary?: { requestCorrelationObserved?: boolean } }).summary || {}).requestCorrelationObserved).toBe(true);
    expect(((hookData.data as { summary?: { finalPayloadCorrelationObserved?: boolean } }).summary || {}).finalPayloadCorrelationObserved).toBe(true);
    expect(((hookData.data as { summary?: { rerankHint?: string } }).summary || {}).rerankHint).toBe('promote-candidate');
    expect((((hookData.data as { summary?: { bestHitSummary?: { matchedField?: string } } }).summary || {}).bestHitSummary || {}).matchedField).toBe('vkey');
  });

  test('adds workflow summary sections to flow.reverse-report', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      targetField: 'signature',
      fieldRole: 'final-signature',
    });

    await executor.execute('flow.generate-hook', {
      sessionId,
      description: 'trace final signature generation',
      targetField: 'signature',
      fieldRole: 'final-signature',
    });

    const report = parseToolResponse(await executor.execute('flow.reverse-report', {
      sessionId,
      focus: 'hooks',
    }));

    expect(report.ok).toBe(true);
    expect((report.data as { requestCorrelationSummary?: unknown }).requestCorrelationSummary).toBeDefined();
    expect((report.data as { validationHitSummary?: unknown }).validationHitSummary).toBeDefined();
    expect((report.data as { hookCompetitionSummary?: unknown }).hookCompetitionSummary).toBeDefined();
    expect((report.data as { rerankResultSummary?: unknown }).rerankResultSummary).toBeDefined();
    expect((report.data as { finalWriteHypothesisSummary?: unknown }).finalWriteHypothesisSummary).toBeDefined();
  });

  test('surfaces degraded engine health through flow.resume-session summaries', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;
    const session = runtime.sessions.getSession(sessionId);

    expect(session).toBeDefined();
    session!.engine.markFailure('page-error', new Error('Synthetic page error'), true);

    const resumed = parseToolResponse(await executor.execute('flow.resume-session', {
      sessionId,
    }));

    expect(resumed.ok).toBe(true);
    expect(((resumed.data as { session?: { health?: string } }).session || {}).health).toBe('degraded');
    expect(((resumed.data as { session?: { recoverable?: boolean } }).session || {}).recoverable).toBe(true);
    expect(((resumed.data as { session?: { lastFailure?: { code?: string } } }).session || {}).lastFailure || {}).toEqual(
      expect.objectContaining({ code: 'page-error' }),
    );
    expect(((resumed.nextActions as string[]) || []).some((item) => item.includes('browser.recover'))).toBe(true);
  });

  test('supports function trace start, read, and stop on a runtime function', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const started = parseToolResponse(await executor.execute('inspect.function-trace', {
      sessionId,
      action: 'start',
      functionName: 'basicFixture.sign',
      captureArgs: true,
      captureReturn: true,
    }));

    expect(started.ok).toBe(true);

    await executor.execute('inspect.runtime', {
      sessionId,
      expression: `window.basicFixture.sign({ nonce: 'trace-nonce' })`,
    });

    const traceData = parseToolResponse(await executor.execute('inspect.function-trace', {
      sessionId,
      action: 'read',
      functionName: 'basicFixture.sign',
    }));

    expect(traceData.ok).toBe(true);
    expect(((traceData.data as { records?: Array<{ args?: Array<{ nonce?: string }> }> }).records || [])[0]?.args?.[0]?.nonce).toBe('trace-nonce');

    const stopped = parseToolResponse(await executor.execute('inspect.function-trace', {
      sessionId,
      action: 'stop',
      functionName: 'basicFixture.sign',
    }));

    expect(stopped.ok).toBe(true);
  });

  test('supports interceptor start, read, and clear for fetch traffic', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const started = parseToolResponse(await executor.execute('inspect.interceptor', {
      sessionId,
      action: 'start',
      type: 'fetch',
      urlPattern: '/api/sign',
    }));

    expect(started.ok).toBe(true);

    await executor.execute('inspect.runtime', {
      sessionId,
      expression: `fetch('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce: 'intercepted' }) }).then((response) => response.json())`,
    });

    const interceptorData = parseToolResponse(await executor.execute('inspect.interceptor', {
      sessionId,
      action: 'read',
      type: 'fetch',
      urlPattern: '/api/sign',
    }));

    expect(interceptorData.ok).toBe(true);
    expect(((interceptorData.data as { records?: Array<{ url?: string }> }).records || []).some((item) => String(item.url || '').includes('/api/sign'))).toBe(true);

    const cleared = parseToolResponse(await executor.execute('inspect.interceptor', {
      sessionId,
      action: 'clear',
      type: 'fetch',
    }));

    expect(cleared.ok).toBe(true);
  });

  test('rate limits repeated heavy search calls', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'deep',
    });

    let limited = false;
    for (let index = 0; index < 12; index += 1) {
      const response = parseToolResponse(
        await executor.execute('inspect.scripts', {
          sessionId,
          action: 'search',
          keyword: 'fetch',
        }),
      );

      if (response.ok === false && String(response.error || '').includes('rate limit')) {
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
  });
});
