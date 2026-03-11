import { SessionScriptInventory } from '../../src/server/v2/runtime/SessionScriptInventory.js';

describe('session script inventory', () => {
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
});
