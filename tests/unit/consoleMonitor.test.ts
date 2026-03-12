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

  test('downgrades expected inspector cache misses to warnings', async () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
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
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
