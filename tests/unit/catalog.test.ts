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

  test('includes the direct expert entrypoints exposed by the v2 roadmap', () => {
    const names = new Set(V2_TOOL_CATALOG.map((tool) => tool.name));

    expect(names.has('debug.breakpoint')).toBe(true);
    expect(names.has('debug.watch')).toBe(true);
    expect(names.has('debug.xhr')).toBe(true);
    expect(names.has('debug.event')).toBe(true);
    expect(names.has('debug.blackbox')).toBe(true);
    expect(names.has('analyze.understand')).toBe(true);
    expect(names.has('analyze.crypto')).toBe(true);
    expect(names.has('analyze.coverage')).toBe(true);
    expect(names.has('browser.storage')).toBe(true);
    expect(names.has('browser.capture')).toBe(true);
    expect(names.has('browser.interact')).toBe(true);
    expect(names.has('browser.stealth')).toBe(true);
    expect(names.has('browser.captcha')).toBe(true);
  });

  test('adds validation inspect tools when Phase 3 lands', () => {
    const names = new Set(V2_TOOL_CATALOG.map((tool) => tool.name));

    expect(names.has('inspect.function-trace')).toBe(true);
    expect(names.has('inspect.interceptor')).toBe(true);
  });
});
