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

  test('caps same-url script history to the freshest parsed entries', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      send: jest.fn(async () => ({})),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);
    await manager.init();

    const handler = listeners.get('Debugger.scriptParsed');
    expect(handler).toBeDefined();

    for (let index = 1; index <= 12; index += 1) {
      handler?.({
        scriptId: `script-${index}`,
        url: 'https://example.test/app.js',
        startLine: 0,
        startColumn: 0,
        endLine: 10,
        endColumn: 0,
        length: 100 + index,
      });
    }

    const history = manager.scriptsByUrl.get('https://example.test/app.js') || [];

    expect(history).toHaveLength(8);
    expect(history.map((item) => item.scriptId)).toEqual([
      'script-5',
      'script-6',
      'script-7',
      'script-8',
      'script-9',
      'script-10',
      'script-11',
      'script-12',
    ]);
    expect(manager.scripts.has('script-1')).toBe(false);
    expect(manager.scripts.has('script-12')).toBe(true);
  });

  test('caps inline script history to the freshest parsed entries', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const cdpSession = {
      on: jest.fn((event: string, handler: (params: Record<string, unknown>) => void) => {
        listeners.set(event, handler);
      }),
      send: jest.fn(async () => ({})),
    };
    const page = {};
    const collector = {
      getActivePage: jest.fn().mockResolvedValue(page),
    };

    jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue(cdpSession as never);

    const manager = new ScriptManager(collector as never);
    await manager.init();

    const handler = listeners.get('Debugger.scriptParsed');
    expect(handler).toBeDefined();

    for (let index = 1; index <= 80; index += 1) {
      handler?.({
        scriptId: `inline-${index}`,
        url: '',
        startLine: 0,
        startColumn: 0,
        endLine: 10,
        endColumn: 0,
        length: 10 + index,
      });
    }

    const scripts = await manager.getAllScripts(false, 200);
    const inlineIds = scripts
      .filter((item) => !item.url)
      .map((item) => item.scriptId);

    expect(inlineIds.length).toBeLessThanOrEqual(32);
    expect(inlineIds).toContain('inline-80');
    expect(inlineIds).not.toContain('inline-1');
    expect(manager.scripts.has('inline-1')).toBe(false);
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

  test('prefers the freshest scripts when getAllScripts applies a maxScripts limit', async () => {
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

    for (let index = 1; index <= 5; index += 1) {
      manager.scripts.set(`script-${index}`, {
        scriptId: `script-${index}`,
        url: `https://example.test/${index}.js`,
        sourceLength: index * 10,
      } as never);
    }

    const scripts = await manager.getAllScripts(false, 3);

    expect(scripts.map((item) => item.scriptId)).toEqual([
      'script-3',
      'script-4',
      'script-5',
    ]);
  });

  test('prioritizes url-backed scripts over low-signal inline scripts when capped', async () => {
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

    manager.scripts.set('url-1', {
      scriptId: 'url-1',
      url: 'https://example.test/a.js',
      sourceLength: 120,
    } as never);
    manager.scripts.set('inline-1', {
      scriptId: 'inline-1',
      url: '',
      sourceLength: 60,
    } as never);
    manager.scripts.set('inline-2', {
      scriptId: 'inline-2',
      url: '',
      sourceLength: 80,
    } as never);
    manager.scripts.set('url-2', {
      scriptId: 'url-2',
      url: 'https://example.test/b.js',
      sourceLength: 140,
    } as never);
    manager.scripts.set('inline-3', {
      scriptId: 'inline-3',
      url: '',
      sourceLength: 90,
    } as never);

    const scripts = await manager.getAllScripts(false, 2);

    expect(scripts.map((item) => item.scriptId)).toEqual([
      'url-1',
      'url-2',
    ]);
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

  test('prefers the freshest same-url candidate before older stale entries', async () => {
    const cdpSession = {
      on: jest.fn(),
      send: jest.fn(async (_method: string, params?: { scriptId?: string }) => {
        if (params?.scriptId === 'stale-script') {
          throw new Error('Protocol error (Debugger.getScriptSource): No script for id: stale-script');
        }

        if (params?.scriptId === 'fresh-script') {
          return {
            scriptSource: 'function latestSignature(){ return "ok"; }',
          };
        }

        if (params?.scriptId === 'older-stale-script') {
          throw new Error('Protocol error (Debugger.getScriptSource): No script for id: older-stale-script');
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
    const olderStale = {
      scriptId: 'older-stale-script',
      url: 'https://example.test/app.js',
      sourceLength: 96,
    };
    const fresh = {
      scriptId: 'fresh-script',
      url: 'https://example.test/app.js',
      sourceLength: 256,
    };

    manager.scripts.set(stale.scriptId, stale as never);
    manager.scripts.set(olderStale.scriptId, olderStale as never);
    manager.scripts.set(fresh.scriptId, fresh as never);
    manager.scriptsByUrl.set(stale.url, [olderStale as never, stale as never, fresh as never]);

    const resolved = await manager.getScriptSource('stale-script');

    expect(resolved?.scriptId).toBe('fresh-script');
    expect(cdpSession.send).toHaveBeenCalledWith('Debugger.getScriptSource', { scriptId: 'stale-script' });
    expect(cdpSession.send).toHaveBeenCalledWith('Debugger.getScriptSource', { scriptId: 'fresh-script' });
    expect(cdpSession.send).not.toHaveBeenCalledWith('Debugger.getScriptSource', { scriptId: 'older-stale-script' });
  });
});
