import { SessionScriptInventory } from '../../src/server/v2/runtime/SessionScriptInventory.js';

describe('session script inventory', () => {
  test('deduplicates repeated external scripts by URL when script ids change', () => {
    const inventory = new SessionScriptInventory('session-dedupe');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-a',
          url: 'https://example.test/runtime.js',
          sourceLength: 128,
        },
        {
          scriptId: 'script-b',
          url: 'https://example.test/runtime.js',
          source: 'window.runtime = true;',
          sourceLength: 22,
        },
      ],
      { indexPolicy: 'deep' }
    );

    const profile = inventory.getSiteProfile('https://example.test/page');
    const manifest = inventory.createManifest();

    expect(profile.totalScripts).toBe(1);
    expect(profile.externalScripts).toBe(1);
    expect(profile.indexedScripts).toBe(1);
    expect(manifest.scripts).toHaveLength(1);
    expect(manifest.scripts[0]?.scriptId).toBe('script-a');
    expect(manifest.scripts[0]?.sourceLoaded).toBe(true);
  });

  test('builds an indexed search result with chunk references', () => {
    const inventory = new SessionScriptInventory('session-indexed');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-1',
          url: 'https://example.test/app.js',
          source: 'const token = "abc";\nfunction signRequest(){ return token + "-sig"; }',
          sourceLength: 68,
        },
      ],
      { indexPolicy: 'deep' }
    );

    const result = inventory.search('signRequest', {
      searchMode: 'indexed',
      maxResults: 10,
      maxBytes: 8_192,
    });

    expect(result.searchMode).toBe('indexed');
    expect(result.matches[0]?.chunkRef).toBe('script-1:0');
    expect(result.matches[0]?.url).toContain('app.js');
  });

  test('returns summarized matches when payload is too large', () => {
    const inventory = new SessionScriptInventory('session-summary');
    inventory.recordScripts(
      [
        {
          scriptId: 'script-2',
          url: 'https://example.test/huge.js',
          source: `function hotPath(){\n${'const sign = token + nonce;\n'.repeat(80)}}`,
          sourceLength: 2_400,
        },
      ],
      { indexPolicy: 'deep' }
    );

    const result = inventory.search('sign', {
      searchMode: 'substring',
      maxResults: 50,
      maxBytes: 256,
    });

    expect(result.truncated).toBe(true);
    expect(result.matches.every((match) => typeof match.chunkRef === 'string')).toBe(true);
  });

  test('indexes multi-line sources without repeatedly recomputing chunk positions', () => {
    const inventory = new SessionScriptInventory('session-large-index');
    const resolveChunkIndexSpy = jest.spyOn(inventory, 'resolveChunkIndex');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-3',
          url: 'https://example.test/catalog.js',
          source: Array.from({ length: 150 }, (_, index) => `const token_${index} = "value_${index}";`).join('\n'),
          sourceLength: 4_800,
        },
      ],
      { indexPolicy: 'deep' }
    );

    expect(resolveChunkIndexSpy).not.toHaveBeenCalled();
    expect(inventory.search('token_149', { searchMode: 'substring', maxResults: 5, maxBytes: 4_096 }).matches[0]?.chunkRef).toBe('script-3:0');
  });

  test('reports scan mode when indexed search falls back to source scanning', () => {
    const inventory = new SessionScriptInventory('session-indexed-fallback');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-4',
          url: 'https://example.test/raw.js',
          source: 'const dynamicNeedle = "needle-value";',
          sourceLength: 36,
        },
      ],
      { indexPolicy: 'metadata-only' }
    );

    const result = inventory.search('needle-value', {
      searchMode: 'indexed',
      maxResults: 5,
      maxBytes: 1024,
    });

    expect(result.searchMode).toBe('scan');
    expect(result.matches[0]?.scriptId).toBe('script-4');
  });

  test('drops stale keyword index entries when a script source is replaced', () => {
    const inventory = new SessionScriptInventory('session-source-replace');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-5',
          url: 'https://example.test/replace.js',
          source: 'const alphaToken = "alpha";',
          sourceLength: 27,
        },
      ],
      { indexPolicy: 'deep' }
    );

    inventory.recordScripts(
      [
        {
          scriptId: 'script-5',
          url: 'https://example.test/replace.js',
          source: 'const betaToken = "beta";',
          sourceLength: 25,
        },
      ],
      { indexPolicy: 'deep' }
    );

    const alphaResult = inventory.search('alphaToken', {
      searchMode: 'indexed',
      maxResults: 5,
      maxBytes: 1024,
    });
    const betaResult = inventory.search('betaToken', {
      searchMode: 'indexed',
      maxResults: 5,
      maxBytes: 1024,
    });

    expect(alphaResult.matches).toHaveLength(0);
    expect(betaResult.matches[0]?.scriptId).toBe('script-5');
  });

  test('builds keyword index when the same source is later upgraded from metadata-only to deep', () => {
    const inventory = new SessionScriptInventory('session-index-upgrade');

    inventory.recordScripts(
      [
        {
          scriptId: 'script-6',
          url: 'https://example.test/index-upgrade.js',
          source: 'const upgradedToken = "ready";',
          sourceLength: 30,
        },
      ],
      { indexPolicy: 'metadata-only' }
    );

    inventory.recordScripts(
      [
        {
          scriptId: 'script-6',
          url: 'https://example.test/index-upgrade.js',
          source: 'const upgradedToken = "ready";',
          sourceLength: 30,
        },
      ],
      { indexPolicy: 'deep' }
    );

    const result = inventory.search('upgradedToken', {
      searchMode: 'indexed',
      maxResults: 5,
      maxBytes: 1024,
    });

    expect(result.searchMode).toBe('indexed');
    expect(result.matches[0]?.scriptId).toBe('script-6');
  });
});
