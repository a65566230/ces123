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
  });
});
