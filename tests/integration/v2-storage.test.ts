import path from 'path';
import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../../src/server/v2/tools/createV2Tools.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('v2 storage-backed persistence', () => {
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

  test('persists collected network and script data into storage', async () => {
    const collect = parseToolResponse(
      await executor.execute('flow.collect-site', {
        engine: 'playwright',
        url: `${fixture.origin}/basic/index.html`,
        collectionStrategy: 'deep',
      })
    );

    const sessionId = collect.sessionId as string;

    const requests = await runtime.storage.searchRequests({
      sessionId,
      query: 'fixture-signature',
      limit: 10,
    });
    expect(requests.total).toBeGreaterThan(0);

    const scripts = await runtime.storage.searchScriptChunks({
      sessionId,
      query: 'basicFixture',
      limit: 10,
    });
    expect(scripts.total).toBeGreaterThan(0);
  });
});
