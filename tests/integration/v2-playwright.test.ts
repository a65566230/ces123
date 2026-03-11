import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 flow with Playwright adapter', () => {
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

  test('launches a Playwright-backed session and evaluates runtime state', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    const collect = parseToolResponse(await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    }));
    expect(collect.ok).toBe(true);

    const runtimeValue = parseToolResponse(await executor.execute('inspect.runtime', {
      sessionId,
      expression: 'document.title',
    }));
    expect(runtimeValue.data).toBe('Basic Fixture');
  });

  test('supports debugger control and function-tree extraction on a Playwright session', async () => {
    const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launch.sessionId as string;

    await executor.execute('browser.navigate', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
    });

    const status = parseToolResponse(await executor.execute('browser.status', { sessionId }));
    expect((status.data as { engineCapabilities: { debugger: boolean } }).engineCapabilities.debugger).toBe(true);

    const debug = parseToolResponse(await executor.execute('debug.control', {
      sessionId,
      action: 'enable',
    }));
    expect((debug.data as { enabled: boolean }).enabled).toBe(true);

    const scripts = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
    }));
    const appScript = (scripts.data as Array<{ scriptId: string; url: string }>).find((item) => item.url.includes('app.js'));
    expect(appScript).toBeDefined();

    const functionTree = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'function-tree',
      scriptId: appScript!.scriptId,
      functionName: 'sign',
    }));
    expect((functionTree.data as { extractedCount: number }).extractedCount).toBeGreaterThan(0);
  });
});
