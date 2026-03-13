import { BrowserModeManager } from '../../src/modules/browser/BrowserModeManager.js';
import { PlaywrightCompatibilityCollector } from '../../src/modules/collector/PlaywrightCompatibilityCollector.js';
import { CodeCollector } from '../../src/modules/collector/CodeCollector.js';
import { EnvironmentEmulator } from '../../src/modules/emulator/EnvironmentEmulator.js';
import { applyBasicNavigatorStealthInit } from '../../src/modules/stealth/basicNavigatorStealth.js';

describe('Playwright compatibility helpers', () => {
  async function withMockBrowserGlobals(run: () => void | Promise<void>) {
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;
    const originalNotification = (globalThis as Record<string, unknown>).Notification;
    const originalStealthBase = (globalThis as Record<string, unknown>).__jshookStealthBase;

    const navigatorValue = {
      permissions: {
        query: jest.fn(() => Promise.resolve({ state: 'prompt' })),
      },
      mediaDevices: {
        enumerateDevices: jest.fn(() => Promise.resolve([])),
      },
      getBattery: jest.fn(() => Promise.resolve({})),
    };
    const windowValue = {
      navigator: navigatorValue,
      chrome: undefined,
    };
    const notificationValue = {
      permission: 'default',
    };

    Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: windowValue, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: notificationValue, configurable: true, writable: true });

    try {
      await run();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'Notification', { value: originalNotification, configurable: true, writable: true });
      Object.defineProperty(globalThis, '__jshookStealthBase', { value: originalStealthBase, configurable: true, writable: true });
    }
  }

  test('BrowserModeManager injects anti-detection scripts through addInitScript', async () => {
    const manager = new BrowserModeManager();
    const page = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };

    await manager.injectAntiDetectionScripts(page as never);

    expect(page.addInitScript).toHaveBeenCalledTimes(1);
  });

  test('anti-detection init scripts remain idempotent when executed multiple times', async () => {
    const manager = new BrowserModeManager();
    const browserModePage = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };
    await manager.injectAntiDetectionScripts(browserModePage as never);

    const collector = new PlaywrightCompatibilityCollector({
      sessionId: 'session-test',
      browserPool: {},
      userAgent: 'test-agent',
      viewport: { width: 1280, height: 720 },
    } as never);
    const collectorPage = {
      evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
    };
    await collector.applyAntiDetection(collectorPage as never);

    const codeCollector = new CodeCollector({
      headless: true,
      timeout: 1000,
    } as never);
    const codeCollectorPage = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };
    await codeCollector.applyAntiDetection(codeCollectorPage as never);

    const scripts = [
      browserModePage.addInitScript.mock.calls[0][0],
      collectorPage.evaluateOnNewDocument.mock.calls[0][0],
      codeCollectorPage.addInitScript.mock.calls[0][0],
    ];

    await withMockBrowserGlobals(async () => {
      for (const script of scripts) {
        expect(() => script()).not.toThrow();
        expect(() => script()).not.toThrow();
      }
    });
  });

  test('shared basic navigator stealth init is idempotent for both simple and realistic profiles', async () => {
    await withMockBrowserGlobals(async () => {
      expect(() => applyBasicNavigatorStealthInit({
        flagName: 'simple-profile',
        webdriverMode: 'false',
        pluginsMode: 'simple',
        languages: ['en-US', 'en'],
        notificationState: 'denied',
      })).not.toThrow();
      expect(() => applyBasicNavigatorStealthInit({
        flagName: 'simple-profile',
        webdriverMode: 'false',
        pluginsMode: 'simple',
        languages: ['en-US', 'en'],
        notificationState: 'denied',
      })).not.toThrow();

      expect(() => applyBasicNavigatorStealthInit({
        flagName: 'realistic-profile',
        webdriverMode: 'undefined',
        pluginsMode: 'realistic',
        languages: ['en-US', 'en'],
        notificationState: 'denied',
      })).not.toThrow();
      expect(Array.isArray((globalThis as { navigator: { plugins: unknown[] } }).navigator.plugins)).toBe(true);
    });
  });

  test('BrowserModeManager preserves the live Notification.permission state in permissions.query', async () => {
    const manager = new BrowserModeManager();
    const page = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };

    await manager.injectAntiDetectionScripts(page as never);
    const script = page.addInitScript.mock.calls[0][0];
    const options = page.addInitScript.mock.calls[0][1];

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;
    const originalNotification = (globalThis as Record<string, unknown>).Notification;
    const originalStealthBase = (globalThis as Record<string, unknown>).__jshookStealthBase;

    const navigatorValue = {
      permissions: {
        query: jest.fn(() => Promise.resolve({ state: 'prompt' })),
      },
    };
    const notificationValue = {
      permission: 'granted',
    };
    Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { navigator: navigatorValue, chrome: undefined }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: notificationValue, configurable: true, writable: true });

    try {
      script(options);
      const result = await navigatorValue.permissions.query({ name: 'notifications' });
      expect(result.state).toBe('granted');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'Notification', { value: originalNotification, configurable: true, writable: true });
      Object.defineProperty(globalThis, '__jshookStealthBase', { value: originalStealthBase, configurable: true, writable: true });
    }
  });

  test('BrowserModeManager keeps a rich chrome runtime shim after the shared stealth refactor', async () => {
    const manager = new BrowserModeManager();
    const page = {
      addInitScript: jest.fn().mockResolvedValue(undefined),
    };

    await manager.injectAntiDetectionScripts(page as never);
    const script = page.addInitScript.mock.calls[0][0];
    const options = page.addInitScript.mock.calls[0][1];

    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;
    const originalNotification = (globalThis as Record<string, unknown>).Notification;
    const originalStealthBase = (globalThis as Record<string, unknown>).__jshookStealthBase;

    const navigatorValue = {
      permissions: {
        query: jest.fn(() => Promise.resolve({ state: 'prompt' })),
      },
    };
    const notificationValue = {
      permission: 'default',
    };
    Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { navigator: navigatorValue, chrome: undefined }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: notificationValue, configurable: true, writable: true });

    try {
      script(options);
      const chromeValue = (globalThis as { window: { chrome: Record<string, unknown> } }).window.chrome;
      expect(typeof chromeValue.runtime?.connect).toBe('function');
      expect(typeof chromeValue.runtime?.sendMessage).toBe('function');
      expect(typeof chromeValue.loadTimes).toBe('function');
      expect(typeof chromeValue.csi).toBe('function');
      expect(typeof chromeValue.loadTimes()).toBe('object');
      expect(typeof chromeValue.csi()).toBe('object');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'Notification', { value: originalNotification, configurable: true, writable: true });
      Object.defineProperty(globalThis, '__jshookStealthBase', { value: originalStealthBase, configurable: true, writable: true });
    }
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
