import * as compat from '../../src/utils/playwrightCompat.js';
import { DebuggerManager } from '../../src/modules/debugger/DebuggerManager.js';

describe('DebuggerManager', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('setBreakpoint snaps to the nearest breakable location reported by CDP', async () => {
    const cdpSession = {
      on: jest.fn(),
      off: jest.fn(),
      detach: jest.fn(async () => undefined),
      send: jest.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Debugger.enable') {
          return {};
        }
        if (method === 'Debugger.getPossibleBreakpoints') {
          return {
            locations: [
              { scriptId: 'script-1', lineNumber: 120, columnNumber: 16, type: 'call' },
              { scriptId: 'script-1', lineNumber: 120, columnNumber: 55 },
            ],
          };
        }
        if (method === 'Debugger.setBreakpoint') {
          return {
            breakpointId: 'bp-1',
            actualLocation: params?.location,
          };
        }
        return {};
      }),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue({}),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new DebuggerManager(collector as never, undefined, 'session-test');
    await manager.init();

    const breakpoint = await manager.setBreakpoint({
      scriptId: 'script-1',
      lineNumber: 120,
      columnNumber: 20,
    });

    expect(cdpSession.send).toHaveBeenCalledWith('Debugger.getPossibleBreakpoints', {
      start: { scriptId: 'script-1', lineNumber: 120, columnNumber: 20 },
      end: { scriptId: 'script-1', lineNumber: 121, columnNumber: 20 },
      restrictToFunction: false,
    });
    expect(breakpoint.location.columnNumber).toBe(16);
  });

  test('setBreakpointByUrl stores the resolved CDP location instead of the raw request', async () => {
    const cdpSession = {
      on: jest.fn(),
      off: jest.fn(),
      detach: jest.fn(async () => undefined),
      send: jest.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          return {};
        }
        if (method === 'Debugger.setBreakpointByUrl') {
          return {
            breakpointId: 'bp-2',
            locations: [
              {
                scriptId: 'script-2',
                lineNumber: 3086,
                columnNumber: 16,
              },
            ],
          };
        }
        return {};
      }),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue({}),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new DebuggerManager(collector as never, undefined, 'session-test');
    await manager.init();

    const breakpoint = await manager.setBreakpointByUrl({
      url: 'https://example.test/app.js',
      lineNumber: 3086,
      columnNumber: 20,
    });

    expect(breakpoint.location.columnNumber).toBe(16);
    expect(breakpoint.location.scriptId).toBe('script-2');
  });

  test('updates a url breakpoint when Debugger.breakpointResolved reports the actual binding location later', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      off: jest.fn(),
      detach: jest.fn(async () => undefined),
      send: jest.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          return {};
        }
        if (method === 'Debugger.setBreakpointByUrl') {
          return {
            breakpointId: 'bp-3',
            locations: [],
          };
        }
        return {};
      }),
    };
    const collector = {
      getActivePage: jest.fn().mockResolvedValue({}),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new DebuggerManager(collector as never, undefined, 'session-test');
    await manager.init();

    const breakpoint = await manager.setBreakpointByUrl({
      url: 'https://example.test/app.js',
      lineNumber: 3086,
      columnNumber: 20,
    });

    listeners.get('Debugger.breakpointResolved')?.({
      breakpointId: 'bp-3',
      location: {
        scriptId: 'script-3',
        lineNumber: 3087,
        columnNumber: 10,
      },
    });

    const updated = manager.getBreakpoint('bp-3');

    expect(updated?.location.scriptId).toBe('script-3');
    expect(updated?.location.lineNumber).toBe(3087);
    expect(updated?.location.columnNumber).toBe(10);
  });
});
