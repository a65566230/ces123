import { ArtifactStore } from '../../src/server/v2/runtime/ArtifactStore.js';
import { compactPayload, maybeExternalize, successResponse } from '../../src/server/v2/response.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';

describe('response helpers', () => {
  test('keeps small payloads inline', () => {
    const store = new ArtifactStore();
    const result = maybeExternalize(store, 'inline', 'small payload', { ok: true }, 'session-inline');

    expect(result.data).toEqual({ ok: true });
    expect(result.artifactId).toBeUndefined();
  });

  test('handles undefined payloads without crashing externalization logic', () => {
    const store = new ArtifactStore();

    expect(() => maybeExternalize(store, 'undefined', 'undefined payload', undefined, 'session-undefined')).not.toThrow();
    const result = maybeExternalize(store, 'undefined', 'undefined payload', undefined, 'session-undefined');

    expect(result.artifactId).toBeUndefined();
    expect(result.data).toBeUndefined();
  });

  test('externalizes large payloads into an artifact', () => {
    const store = new ArtifactStore();
    const result = maybeExternalize(store, 'large', 'large payload', { blob: 'x'.repeat(30_000) }, 'session-large');

    expect(result.artifactId).toBeDefined();
    expect(store.get(result.artifactId!)).toBeDefined();
    expect(result.detailId).toBe(result.artifactId);
  });

  test('keeps a small inline array preview when a large array payload is externalized', () => {
    const store = new ArtifactStore();
    const largeArray = Array.from({ length: 60 }, (_, index) => ({
      scriptId: `script-${index}`,
      url: `/bundle-${index}.js`,
      source: 'x'.repeat(1024),
    }));

    const result = maybeExternalize(store, 'large-array', 'large array payload', largeArray, 'session-array');

    expect(result.artifactId).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as Array<unknown>).length).toBeGreaterThan(0);
    expect((result.data as Array<unknown>).length).toBeLessThan(largeArray.length);
  });

  test('serializes success envelopes as MCP text payloads', () => {
    const response = successResponse('done', { feature: 'v2' });
    const parsed = parseToolResponse(response);

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('done');
    expect(parsed.data).toEqual({ feature: 'v2' });
  });

  test('compacts a top-level object array into a columnar table', () => {
    const compacted = compactPayload([
      { scriptId: 'script-1', url: '/a.js', sourceLength: 12 },
      { scriptId: 'script-2', url: '/b.js', sourceLength: 24 },
    ]);

    expect(compacted).toEqual({
      format: 'table',
      columns: ['scriptId', 'sourceLength', 'url'],
      rows: [
        ['script-1', 12, '/a.js'],
        ['script-2', 24, '/b.js'],
      ],
      rowCount: 2,
    });
  });

  test('compacts configured collection fields while preserving surrounding metadata', () => {
    const compacted = compactPayload({
      keyword: 'fetch',
      matches: [
        { scriptId: 'script-1', url: '/a.js', context: 'fetch("/api")' },
        { scriptId: 'script-2', url: '/b.js', context: 'window.fetch("/b")' },
      ],
      page: {
        page: 1,
      },
    });

    expect(compacted).toEqual({
      keyword: 'fetch',
      matches: {
        format: 'table',
        columns: ['context', 'scriptId', 'url'],
        rows: [
          ['fetch("/api")', 'script-1', '/a.js'],
          ['window.fetch("/b")', 'script-2', '/b.js'],
        ],
        rowCount: 2,
      },
      page: {
        page: 1,
      },
    });
  });

  test('compacts extended workflow collection fields used by field-aware request tracing', () => {
    const compacted = compactPayload({
      candidateScripts: [
        { scriptId: 'script-1', url: '/a.js', score: 12 },
        { scriptId: 'script-2', url: '/b.js', score: 8 },
      ],
      candidateFunctions: [
        { name: 'buildPayload', line: 12, score: 9 },
      ],
      finalWriteHints: [
        { field: 'vkey', lineNumber: 20, snippet: 'payload.vkey = value' },
      ],
      guidance: {
        activeFilter: {
          urlPattern: '/api/vkey',
        },
      },
    });

    expect((compacted as { candidateScripts: { format: string } }).candidateScripts.format).toBe('table');
    expect((compacted as { candidateFunctions: { format: string } }).candidateFunctions.format).toBe('table');
    expect((compacted as { finalWriteHints: { format: string } }).finalWriteHints.format).toBe('table');
    expect((compacted as { guidance: { activeFilter: { urlPattern: string } } }).guidance.activeFilter.urlPattern).toBe('/api/vkey');
  });
});
