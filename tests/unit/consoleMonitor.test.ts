import { ConsoleMonitor } from '../../src/modules/monitor/ConsoleMonitor.js';
import { logger } from '../../src/utils/logger.js';

describe('ConsoleMonitor response-body handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMonitor() {
    const monitor = new ConsoleMonitor({ getActivePage: jest.fn() } as never, undefined, 'session-test') as ConsoleMonitor & {
      cdpSession: { send: jest.Mock; on: jest.Mock; off: jest.Mock };
      networkEnabled: boolean;
      requests: Map<string, unknown>;
      responses: Map<string, unknown>;
    };

    monitor.cdpSession = {
      send: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };
    monitor.networkEnabled = true;

    return monitor;
  }

  test('skips fetching response bodies for bodiless responses', async () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    monitor.requests.set('req-1', {
      requestId: 'req-1',
      url: 'https://example.test/ping',
      method: 'OPTIONS',
    });
    monitor.responses.set('req-1', {
      requestId: 'req-1',
      url: 'https://example.test/ping',
      status: 204,
      mimeType: 'text/plain',
    });

    const result = await monitor.getResponseBody('req-1');

    expect(result).toBeNull();
    expect(monitor.cdpSession.send).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('downgrades inspector cache evictions to debug logs', async () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    monitor.requests.set('req-2', {
      requestId: 'req-2',
      url: 'https://example.test/data.json',
      method: 'GET',
    });
    monitor.responses.set('req-2', {
      requestId: 'req-2',
      url: 'https://example.test/data.json',
      status: 200,
      mimeType: 'application/json',
    });
    monitor.cdpSession.send.mockRejectedValue(new Error('Protocol error (Network.getResponseBody): Request content was evicted from inspector cache'));

    const result = await monitor.getResponseBody('req-2');

    expect(result).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('rate limits repeated expected missing-body warnings for the same response signature', async () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});

    monitor.requests.set('req-3', {
      requestId: 'req-3',
      url: 'https://example.test/data.json',
      method: 'GET',
    });
    monitor.responses.set('req-3', {
      requestId: 'req-3',
      url: 'https://example.test/data.json',
      status: 200,
      mimeType: 'application/json',
    });
    monitor.cdpSession.send.mockRejectedValue(new Error('Protocol error (Network.getResponseBody): No resource with given identifier found'));

    await monitor.getResponseBody('req-3');
    await monitor.getResponseBody('req-3');
    await monitor.getResponseBody('req-3');
    await monitor.getResponseBody('req-3');

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(debugSpy).toHaveBeenCalled();
  });

  test('skips persisting response bodies for telemetry endpoints', async () => {
    const monitor = createMonitor();

    expect(
      monitor.shouldPersistResponseBody(
        {
          requestId: 'req-telemetry',
          url: 'https://mcs.zijieapi.com/list?aid=6383',
          method: 'POST',
          type: 'fetch',
        },
        {
          requestId: 'req-telemetry',
          url: 'https://mcs.zijieapi.com/list?aid=6383',
          status: 200,
          mimeType: 'application/json',
        },
      ),
    ).toBe(false);
  });

  test('skips persisting response bodies for GET json requests during background capture', async () => {
    const monitor = createMonitor();

    expect(
      monitor.shouldPersistResponseBody(
        {
          requestId: 'req-get-json',
          url: 'https://example.test/api/feed',
          method: 'GET',
          type: 'fetch',
        },
        {
          requestId: 'req-get-json',
          url: 'https://example.test/api/feed',
          status: 200,
          mimeType: 'application/json',
        },
      ),
    ).toBe(false);
  });

  test('upgrades an existing console session to enable network monitoring on demand', async () => {
    const cdpSession = {
      send: jest.fn(async () => ({})),
      on: jest.fn(),
      off: jest.fn(),
    };
    const page = {
      createCDPSession: jest.fn().mockResolvedValue(cdpSession),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    const monitor = new ConsoleMonitor(collector as never, undefined, 'session-upgrade');

    await monitor.enable();
    expect(monitor.isEnabled()).toBe(true);
    expect(monitor.isNetworkEnabled()).toBe(false);

    await monitor.enable({ enableNetwork: true, enableExceptions: true });

    expect(monitor.isNetworkEnabled()).toBe(true);
    expect(cdpSession.send).toHaveBeenCalledWith('Network.enable', expect.any(Object));
  });

  test('upgrades an existing console session to enable exception monitoring on demand', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      send: jest.fn(async () => ({})),
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      off: jest.fn((event: string) => {
        listeners.delete(event);
      }),
    };
    const page = {
      createCDPSession: jest.fn().mockResolvedValue(cdpSession),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    const monitor = new ConsoleMonitor(collector as never, undefined, 'session-upgrade-exception');

    await monitor.enable({ enableExceptions: false });
    expect(monitor.getExceptions().length).toBe(0);
    expect(listeners.has('Runtime.exceptionThrown')).toBe(false);

    await monitor.enable({ enableExceptions: true });

    expect(listeners.has('Runtime.exceptionThrown')).toBe(true);

    listeners.get('Runtime.exceptionThrown')?.({
      exceptionDetails: {
        text: 'boom',
        exceptionId: 1,
        url: 'https://example.test/app.js',
        lineNumber: 12,
        columnNumber: 4,
        scriptId: 'script-1',
        stackTrace: {
          callFrames: [],
        },
      },
    });

    expect(monitor.getExceptions().length).toBe(1);
    expect(monitor.getExceptions()[0]?.text).toContain('boom');
  });

  test('can disable exception monitoring without tearing down the whole console session', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      send: jest.fn(async () => ({})),
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      off: jest.fn((event: string) => {
        listeners.delete(event);
      }),
    };
    const page = {
      createCDPSession: jest.fn().mockResolvedValue(cdpSession),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    const monitor = new ConsoleMonitor(collector as never, undefined, 'session-disable-exception');

    await monitor.enable({ enableExceptions: true });
    expect(listeners.has('Runtime.exceptionThrown')).toBe(true);
    expect(monitor.getMonitorState().enabled).toBe(true);
    expect(monitor.getMonitorState().exceptionsEnabled).toBe(true);

    await monitor.enable({ enableExceptions: false });

    expect(listeners.has('Runtime.exceptionThrown')).toBe(false);
    expect(monitor.getMonitorState().enabled).toBe(true);
    expect(monitor.getMonitorState().exceptionsEnabled).toBe(false);
  });

  test('can disable network monitoring without tearing down the whole console session', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      send: jest.fn(async () => ({})),
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      off: jest.fn((event: string) => {
        listeners.delete(event);
      }),
      detach: jest.fn(async () => undefined),
    };
    const page = {
      createCDPSession: jest.fn().mockResolvedValue(cdpSession),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    const monitor = new ConsoleMonitor(collector as never, undefined, 'session-disable-network');

    await monitor.enable({ enableNetwork: true, enableExceptions: false });
    expect(monitor.isNetworkEnabled()).toBe(true);
    expect(listeners.has('Network.requestWillBeSent')).toBe(true);

    await monitor.enable({ enableNetwork: false });

    expect(monitor.isEnabled()).toBe(true);
    expect(monitor.isNetworkEnabled()).toBe(false);
    expect(listeners.has('Network.requestWillBeSent')).toBe(false);
  });

  test('filters captured requests and responses by requestId when requested', async () => {
    const monitor = createMonitor();

    monitor.requests.set('req-a', {
      requestId: 'req-a',
      url: 'https://example.test/a',
      method: 'GET',
      type: 'fetch',
    });
    monitor.requests.set('req-b', {
      requestId: 'req-b',
      url: 'https://example.test/b',
      method: 'POST',
      type: 'xhr',
    });
    monitor.responses.set('req-a', {
      requestId: 'req-a',
      url: 'https://example.test/a',
      status: 200,
      mimeType: 'application/json',
    });
    monitor.responses.set('req-b', {
      requestId: 'req-b',
      url: 'https://example.test/b',
      status: 201,
      mimeType: 'application/json',
    });

    const requests = monitor.getNetworkRequests({ requestId: 'req-b' });
    const responses = monitor.getNetworkResponses({ requestId: 'req-b' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.requestId).toBe('req-b');
    expect(responses).toHaveLength(1);
    expect(responses[0]?.requestId).toBe('req-b');
  });
});
