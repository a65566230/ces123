import { PageController } from '../../src/modules/collector/PageController.js';
import * as compat from '../../src/utils/playwrightCompat.js';

describe('PageController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reload falls back through navigation wait strategies', async () => {
    const page = {
      reload: jest
        .fn()
        .mockRejectedValueOnce(new Error('networkidle timeout'))
        .mockResolvedValueOnce(undefined),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    const controller = new PageController(collector as never);

    await controller.reload({
      waitProfile: 'network-quiet',
      timeout: 1234,
    });

    expect(page.reload).toHaveBeenNthCalledWith(1, {
      waitUntil: 'networkidle',
      timeout: 1234,
    });
    expect(page.reload).toHaveBeenNthCalledWith(2, {
      waitUntil: 'load',
      timeout: 1234,
    });
  });

  test('navigate returns partial success when execution pauses during navigation', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      off: jest.fn((event: string) => {
        listeners.delete(event);
      }),
      send: jest.fn(async () => ({})),
      detach: jest.fn(async () => undefined),
    };
    const page = {
      goto: jest.fn(() => new Promise(() => undefined)),
      title: jest.fn().mockResolvedValue('Paused page'),
      url: jest.fn().mockReturnValue('https://example.test/app'),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const controller = new PageController(collector as never);
    const navigationPromise = controller.navigate('https://example.test/app', {
      waitProfile: 'interactive',
      timeout: 1234,
    });

    for (let attempt = 0; attempt < 10 && !listeners.has('Debugger.paused'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    listeners.get('Debugger.paused')?.({
      reason: 'exception',
      hitBreakpoints: ['bp-1'],
      callFrames: [
        {
          location: {
            scriptId: 'script-1',
            lineNumber: 10,
            columnNumber: 4,
          },
        },
      ],
    });

    const result = await navigationPromise;

    expect(result.interruptedByDebuggerPause).toBe(true);
    expect(result.pausedState?.reason).toBe('exception');
    expect(result.url).toBe('https://example.test/app');
    expect(result.title).toBe('');
  });

  test('goBack resolves even if the underlying navigation hangs', async () => {
    jest.useFakeTimers();
    const page = {
      goBack: jest.fn(() => new Promise(() => undefined)),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };
    const controller = new PageController(collector as never);

    const promise = controller.goBack();
    await jest.advanceTimersByTimeAsync(12000);
    await promise;

    expect(page.goBack).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
