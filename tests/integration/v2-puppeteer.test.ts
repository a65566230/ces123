import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 flow with Puppeteer', () => {
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
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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
  });

  test('resolves a source map from a captured script', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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

  test('supports natural-language hook generation for decrypt/signature workflows', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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

  test('rate limits repeated heavy search calls', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'puppeteer' }));
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
