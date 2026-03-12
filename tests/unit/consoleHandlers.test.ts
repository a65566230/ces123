import { AdvancedToolHandlers } from '../../src/server/AdvancedToolHandlers.js';
import { BrowserToolHandlers } from '../../src/server/BrowserToolHandlers.js';

function parseTextResponse(response: { content?: Array<{ text?: string }> }) {
  return JSON.parse(response.content?.[0]?.text || '{}');
}

describe('legacy console handlers', () => {
  test('handleConsoleGetLogs trims oversized log payloads before serializing them', async () => {
    const consoleMonitor = {
      getLogs: jest.fn(() => ([
        {
          type: 'log',
          text: 'x'.repeat(5000),
          args: ['y'.repeat(5000), { nested: 'z'.repeat(5000) }],
          timestamp: 1,
          url: 'https://example.test/app.js',
          lineNumber: 10,
          columnNumber: 20,
          stackTrace: Array.from({ length: 20 }, (_, index) => ({
            functionName: `fn${index}`,
            url: 'https://example.test/app.js',
            lineNumber: index,
            columnNumber: index,
          })),
        },
      ])),
    };

    const handler = new BrowserToolHandlers(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      consoleMonitor as never,
      {} as never,
      {} as never,
    ) as BrowserToolHandlers & {
      detailedDataManager: { smartHandle: jest.Mock };
    };

    handler.detailedDataManager = {
      smartHandle: jest.fn((value) => value),
    };

    const response = await handler.handleConsoleGetLogs({ limit: 20 });
    const payload = parseTextResponse(response);

    expect(payload.count).toBe(1);
    expect(payload.logs[0].text.length).toBeLessThan(2500);
    expect(payload.logs[0].stackTrace.length).toBeLessThanOrEqual(8);
    expect(String(payload.logs[0].args[0])).toContain('...');
  });

  test('handleConsoleGetExceptions trims oversized exception payloads before returning them', async () => {
    const consoleMonitor = {
      getExceptions: jest.fn(() => ([
        {
          text: 'e'.repeat(8000),
          exceptionId: 1,
          timestamp: 1,
          url: 'https://example.test/app.js',
          lineNumber: 10,
          columnNumber: 20,
          scriptId: 'script-1',
          stackTrace: Array.from({ length: 30 }, (_, index) => ({
            functionName: `fn${index}`,
            url: 'https://example.test/app.js',
            lineNumber: index,
            columnNumber: index,
          })),
        },
      ])),
    };

    const handler = new AdvancedToolHandlers({} as never, consoleMonitor as never);
    const response = await handler.handleConsoleGetExceptions({ limit: 20 });

    expect(response.total).toBe(1);
    expect(response.exceptions[0].text.length).toBeLessThan(4500);
    expect(response.exceptions[0].stackTrace.length).toBeLessThanOrEqual(12);
  });
});
