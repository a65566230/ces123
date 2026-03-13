import { ToolExecutor } from '../../src/server/v2/ToolExecutor.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';

describe('ToolExecutor', () => {
  const originalTimeout = process.env.TOOL_EXECUTOR_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.TOOL_EXECUTOR_TIMEOUT_MS;
    } else {
      process.env.TOOL_EXECUTOR_TIMEOUT_MS = originalTimeout;
    }
    jest.restoreAllMocks();
  });

  test('returns a timeout error with recovery guidance when a tool exceeds the executor timeout', async () => {
    process.env.TOOL_EXECUTOR_TIMEOUT_MS = '25';

    const registry = {
      get: jest.fn(() => ({
        name: 'slow.tool',
        execute: jest.fn((_args: unknown, context: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            context.signal?.addEventListener('abort', () => {
              reject(context.signal?.reason || new Error('aborted'));
            });
          })),
      })),
    };

    const runtime = {
      ready: Promise.resolve(),
      toolRateLimiter: {
        check: jest.fn(() => ({ allowed: true, remaining: 9, resetInMs: 1000 })),
      },
      config: {
        browser: { timeout: 5000 },
        worker: { taskTimeoutMs: 5000 },
      },
    };

    const executor = new ToolExecutor(registry as never, runtime as never);
    const response = parseToolResponse(await executor.execute('slow.tool', { sessionId: 'session-timeout' }));

    expect(response.ok).toBe(false);
    expect(String(response.summary || '')).toContain('timed out');
    expect(String(response.error || '')).toContain('timed out');
    expect(Array.isArray(response.nextActions)).toBe(true);
    expect((response.nextActions as string[]).some((item) => item.includes('browser.recover') || item.includes('Retry'))).toBe(true);
  });

  test('blocks execution when the global executor rate limit has been exceeded', async () => {
    const execute = jest.fn();
    const registry = {
      get: jest.fn(() => ({
        name: 'browser.navigate',
        execute,
      })),
    };

    const runtime = {
      ready: Promise.resolve(),
      toolRateLimiter: {
        check: jest.fn(() => ({ allowed: false, remaining: 0, resetInMs: 250 })),
      },
      config: {
        browser: { timeout: 5000 },
        worker: { taskTimeoutMs: 5000 },
      },
    };

    const executor = new ToolExecutor(registry as never, runtime as never);
    const response = parseToolResponse(await executor.execute('browser.navigate', { sessionId: 'session-limit' }));

    expect(response.ok).toBe(false);
    expect(String(response.error || '')).toContain('rate limit');
    expect(execute).not.toHaveBeenCalled();
    expect(runtime.toolRateLimiter.check).toHaveBeenCalledWith('exec:session-limit:browser.navigate');
  });
});
