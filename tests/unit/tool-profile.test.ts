import { V2_TOOL_CATALOG, getV2ToolCatalog } from '../../src/server/v2/tools/createV2Tools.js';

describe('v2 tool profiles', () => {
  test('core profile hides expert-only direct tooling', () => {
    const coreNames = new Set(getV2ToolCatalog('core').map((tool) => tool.name));

    expect(coreNames.has('flow.collect-site')).toBe(true);
    expect(coreNames.has('inspect.scripts')).toBe(true);
    expect(coreNames.has('debug.control')).toBe(true);

    expect(coreNames.has('debug.breakpoint')).toBe(false);
    expect(coreNames.has('debug.watch')).toBe(false);
    expect(coreNames.has('debug.xhr')).toBe(false);
    expect(coreNames.has('debug.event')).toBe(false);
    expect(coreNames.has('debug.blackbox')).toBe(false);
    expect(coreNames.has('analyze.understand')).toBe(false);
    expect(coreNames.has('analyze.crypto')).toBe(false);
    expect(coreNames.has('analyze.coverage')).toBe(false);
    expect(coreNames.has('browser.storage')).toBe(false);
    expect(coreNames.has('browser.capture')).toBe(false);
    expect(coreNames.has('browser.interact')).toBe(false);
    expect(coreNames.has('browser.stealth')).toBe(false);
    expect(coreNames.has('browser.captcha')).toBe(false);
    expect(coreNames.has('hook.generate')).toBe(false);
  });

  test('keeps future validation inspect tools out of the core profile', () => {
    const coreNames = new Set(getV2ToolCatalog('core').map((tool) => tool.name));

    expect(coreNames.has('inspect.function-trace')).toBe(false);
    expect(coreNames.has('inspect.interceptor')).toBe(false);
  });

  test('expert profile exposes the full v2 catalog', () => {
    const expert = getV2ToolCatalog('expert');

    expect(expert).toEqual(V2_TOOL_CATALOG);
  });
});
