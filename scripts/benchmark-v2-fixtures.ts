async function main() {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  const path = await import('path');
  const [{ logger }, { ToolExecutor }, { ToolRegistry }, { ToolRuntimeContext }, { resolveRuntimeOptions }, { createV2Tools, V2_TOOL_CATALOG, getV2ToolCatalog }, { compareSerializedPayloads, recommendPayloadMode }, { measureToolCatalog }, { startFixtureServer }, { createTestConfig }, { parseToolResponse }] = await Promise.all([
    import('../src/utils/logger.js'),
    import('../src/server/v2/ToolExecutor.js'),
    import('../src/server/v2/ToolRegistry.js'),
    import('../src/server/v2/runtime/ToolRuntimeContext.js'),
    import('../src/server/v2/runtime/runtimeOptions.js'),
    import('../src/server/v2/tools/createV2Tools.js'),
    import('../src/server/v2/tools/benchmarkMetrics.js'),
    import('../src/server/v2/tools/toolCatalogStats.js'),
    import('../tests/helpers/fixtureServer.js'),
    import('../tests/helpers/testConfig.js'),
    import('../tests/helpers/parseToolResponse.js'),
  ]);
  logger.setLevel('silent');

  const fixture = await startFixtureServer(path.resolve(process.cwd(), 'tests/fixtures'));
  const config = createTestConfig();
  const runtime = new ToolRuntimeContext(config, resolveRuntimeOptions(config));
  const executor = new ToolExecutor(new ToolRegistry(createV2Tools(runtime, 'expert')), runtime);

  try {
    const launched = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
    const sessionId = launched.sessionId as string;

    await executor.execute('flow.collect-site', {
      sessionId,
      url: `${fixture.origin}/basic/index.html`,
      collectionStrategy: 'manifest',
    });

    const scriptsFull = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
      responseMode: 'full',
    }));
    const scriptsCompact = parseToolResponse(await executor.execute('inspect.scripts', {
      sessionId,
      action: 'list',
      responseMode: 'compact',
    }));

    const networkFull = parseToolResponse(await executor.execute('inspect.network', {
      sessionId,
      responseMode: 'full',
    }));
    const networkCompact = parseToolResponse(await executor.execute('inspect.network', {
      sessionId,
      responseMode: 'compact',
    }));

    const traceFull = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      responseMode: 'full',
    }));
    const traceCompact = parseToolResponse(await executor.execute('flow.trace-request', {
      sessionId,
      urlPattern: '/api/sign',
      responseMode: 'compact',
    }));

    const inspectScripts = compareSerializedPayloads(scriptsFull.data, scriptsCompact.data);
    const inspectNetwork = compareSerializedPayloads(networkFull.data, networkCompact.data);
    const flowTraceRequest = compareSerializedPayloads(traceFull.data, traceCompact.data);

    console.log(JSON.stringify({
      toolCatalog: {
        core: measureToolCatalog(getV2ToolCatalog('core')),
        expert: measureToolCatalog(V2_TOOL_CATALOG),
      },
      responseModes: {
        inspectScripts: {
          ...inspectScripts,
          recommendedMode: recommendPayloadMode(inspectScripts),
        },
        inspectNetwork: {
          ...inspectNetwork,
          recommendedMode: recommendPayloadMode(inspectNetwork),
        },
        flowTraceRequest: {
          ...flowTraceRequest,
          recommendedMode: recommendPayloadMode(flowTraceRequest),
        },
      },
    }, null, 2));
  } finally {
    await runtime.close();
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
