import * as compat from '../../src/utils/playwrightCompat.js';
import { ScriptManager } from '../../src/modules/debugger/ScriptManager.js';

describe('ScriptManager', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('captures scriptParsed events emitted during debugger enable', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      send: jest.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          listeners.get('Debugger.scriptParsed')?.({
            scriptId: 'script-1',
            url: 'https://example.test/runtime.js',
            startLine: 0,
            startColumn: 0,
            endLine: 10,
            endColumn: 0,
            length: 1024,
          });
        }
        return {};
      }),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);

    await manager.init();

    expect(await manager.getAllScripts(false)).toEqual([
      expect.objectContaining({
        scriptId: 'script-1',
        url: 'https://example.test/runtime.js',
      }),
    ]);
  });

  test('getScriptSource skips eager derived-data indexing unless explicitly requested', async () => {
    const cdpSession = {
      on: jest.fn(),
      send: jest.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          return {};
        }

        if (method === 'Debugger.getScriptSource') {
          return {
            scriptSource: 'const largeBundle = "token";\nfunction sign(){ return largeBundle; }',
          };
        }

        return {};
      }),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);
    const indexSpy = jest.spyOn(manager as never, 'buildKeywordIndex');
    const chunkSpy = jest.spyOn(manager as never, 'chunkScript');

    await manager.init();
    manager.scripts.set('script-2', {
      scriptId: 'script-2',
      url: 'https://example.test/large.js',
      sourceLength: 64,
    });

    const script = await manager.getScriptSource('script-2');

    expect(script?.source).toContain('largeBundle');
    expect(indexSpy).not.toHaveBeenCalled();
    expect(chunkSpy).not.toHaveBeenCalled();
  });

  test('does not leak cached source blobs when metadata-only script listings are requested', async () => {
    const cdpSession = {
      on: jest.fn(),
      send: jest.fn(async () => ({})),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);
    await manager.init();
    manager.scripts.set('script-3', {
      scriptId: 'script-3',
      url: 'https://example.test/bundle.js',
      sourceLength: 1024,
      source: 'const heavy = "payload";',
    } as never);

    const scripts = await manager.getAllScripts(false);

    expect(scripts[0]?.scriptId).toBe('script-3');
    expect(scripts[0]?.source).toBeUndefined();
  });

  test('falls back to a fresh script with the same url when the original script id is stale', async () => {
    const cdpSession = {
      on: jest.fn(),
      send: jest.fn(async (_method: string, params?: { scriptId?: string }) => {
        if (params?.scriptId === 'stale-script') {
          throw new Error('Protocol error (Debugger.getScriptSource): No script for id: stale-script');
        }

        if (params?.scriptId === 'fresh-script') {
          return {
            scriptSource: 'function createSignature(){ return "ok"; }',
          };
        }

        return {};
      }),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);
    await manager.init();

    const stale = {
      scriptId: 'stale-script',
      url: 'https://example.test/app.js',
      sourceLength: 128,
    };
    const fresh = {
      scriptId: 'fresh-script',
      url: 'https://example.test/app.js',
      sourceLength: 256,
    };

    manager.scripts.set(stale.scriptId, stale as never);
    manager.scripts.set(fresh.scriptId, fresh as never);
    manager.scriptsByUrl.set(stale.url, [stale as never, fresh as never]);

    const resolved = await manager.getScriptSource('stale-script');

    expect(resolved?.scriptId).toBe('fresh-script');
    expect(resolved?.source).toContain('createSignature');
    expect(manager.scripts.has('stale-script')).toBe(false);
  });
});
