import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 advanced flow with Playwright adapter', () => {
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

  test('supports engine auto, status health, and reverse-report metadata', async () => {
    const collect = parseToolResponse(
      await executor.execute('flow.collect-site', {
        engine: 'auto',
        url: `${fixture.origin}/basic/index.html`,
        collectionStrategy: 'manifest',
      })
    );

    const sessionId = collect.sessionId as string;
    expect(collect.ok).toBe(true);

    const status = parseToolResponse(await executor.execute('browser.status', { sessionId }));
    expect((status.data as { health: string }).health).toBe('ready');
    expect((status.data as { engineCapabilities: { scriptSearch: boolean } }).engineCapabilities.scriptSearch).toBe(true);

    const report = parseToolResponse(await executor.execute('flow.reverse-report', { sessionId, focus: 'overview' }));
    expect((report.data as { status: { health: string } }).status.health).toBe('ready');
    expect((report.data as { siteProfile: { totalScripts: number } }).siteProfile.totalScripts).toBeGreaterThan(0);
  });
});
