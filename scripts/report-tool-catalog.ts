async function main() {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
  const [{ getConfig }, { LegacyToolBridge }, { getV2ToolCatalog, V2_TOOL_CATALOG }, { measureToolCatalog }] = await Promise.all([
    import('../src/utils/config.js'),
    import('../src/server/v2/legacy/LegacyToolBridge.js'),
    import('../src/server/v2/tools/createV2Tools.js'),
    import('../src/server/v2/tools/toolCatalogStats.js'),
  ]);
  const config = getConfig();
  const legacyBridge = new LegacyToolBridge(config);

  try {
    const core = measureToolCatalog(getV2ToolCatalog('core'));
    const expert = measureToolCatalog(V2_TOOL_CATALOG);
    const legacy = measureToolCatalog(legacyBridge.getTools());
    const combined = {
      count: expert.count + legacy.count,
      bytes: expert.bytes + legacy.bytes,
      avgBytesPerTool: Math.round((expert.bytes + legacy.bytes) / (expert.count + legacy.count)),
    };

    console.log(JSON.stringify({
      core,
      expert,
      legacy,
      combined,
    }, null, 2));
  } finally {
    await legacyBridge.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
