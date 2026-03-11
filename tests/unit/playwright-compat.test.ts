import { BrowserModeManager } from '../../src/modules/browser/BrowserModeManager.js';
import { EnvironmentEmulator } from '../../src/modules/emulator/EnvironmentEmulator.js';

describe('Playwright compatibility helpers', () => {
  test('BrowserModeManager injects anti-detection scripts through addInitScript', async () => {
    const manager = new BrowserModeManager();
    const page = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };

    await manager.injectAntiDetectionScripts(page as never);

    expect(page.addInitScript).toHaveBeenCalledTimes(1);
  });

  test('EnvironmentEmulator uses addInitScript when reusing an existing Playwright context', async () => {
    const emulator = new EnvironmentEmulator();
    const page = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const context = {
      newPage: jest.fn().mockResolvedValue(page),
    };

    (emulator as unknown as { browser: Record<string, unknown>; context: unknown }).browser = {};
    (emulator as unknown as { context: unknown }).context = context;

    await emulator.fetchRealEnvironment('https://example.test', {
      window: [],
      document: [],
      navigator: [],
      location: [],
      screen: [],
      other: [],
    }, 1);

    expect(page.addInitScript).toHaveBeenCalledTimes(1);
  });
});
