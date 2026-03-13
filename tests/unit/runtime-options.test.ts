import { resolveRuntimeOptions } from '../../src/server/v2/runtime/runtimeOptions.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('resolveRuntimeOptions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('defaults to Playwright and ignores legacy browser engine env', () => {
    process.env.BROWSER_ENGINE = 'puppeteer';

    const options = resolveRuntimeOptions(createTestConfig());

    expect(options.defaultBrowserEngine).toBe('playwright');
    expect(options.toolProfile).toBe('expert');
  });

  test('supports tool profile selection from env', () => {
    process.env.JSHOOK_TOOL_PROFILE = 'core';

    const options = resolveRuntimeOptions(createTestConfig());

    expect(options.toolProfile).toBe('core');
  });

  test('treats legacy profile as enabling legacy tools', () => {
    process.env.JSHOOK_TOOL_PROFILE = 'legacy';

    const options = resolveRuntimeOptions(createTestConfig());

    expect(options.toolProfile).toBe('legacy');
    expect(options.enableLegacyTools).toBe(true);
  });
});
