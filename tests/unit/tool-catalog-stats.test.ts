import { getV2ToolCatalog, V2_TOOL_CATALOG } from '../../src/server/v2/tools/createV2Tools.js';
import { measureToolCatalog } from '../../src/server/v2/tools/toolCatalogStats.js';

describe('tool catalog stats', () => {
  test('measures tool count and schema size deterministically', () => {
    const expert = measureToolCatalog(V2_TOOL_CATALOG);
    const core = measureToolCatalog(getV2ToolCatalog('core'));

    expect(expert.count).toBe(V2_TOOL_CATALOG.length);
    expect(expert.bytes).toBeGreaterThan(0);
    expect(expert.avgBytesPerTool).toBeGreaterThan(0);

    expect(core.count).toBeLessThan(expert.count);
    expect(core.bytes).toBeLessThan(expert.bytes);
  });
});
