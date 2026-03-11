import { V2_TOOL_CATALOG } from '../../src/server/v2/tools/createV2Tools.js';

describe('v2 tool catalog', () => {
  test('contains unique tool names', () => {
    const names = new Set<string>();
    for (const tool of V2_TOOL_CATALOG) {
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
    }
  });

  test('covers the major v2 groups', () => {
    const groups = new Set(V2_TOOL_CATALOG.map((tool) => tool.group));
    expect(groups).toEqual(new Set(['browser', 'inspect', 'debug', 'analyze', 'hook', 'flow']));
  });
});
