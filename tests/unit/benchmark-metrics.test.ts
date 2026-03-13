import { compareSerializedPayloads, measureSerializedBytes, recommendPayloadMode } from '../../src/server/v2/tools/benchmarkMetrics.js';

describe('benchmark metrics', () => {
  test('measures serialized payload size', () => {
    expect(measureSerializedBytes({ ok: true })).toBe(JSON.stringify({ ok: true }).length);
  });

  test('compares full and compact payload sizes', () => {
    const comparison = compareSerializedPayloads(
      {
        items: [
          {
            scriptIdentifier: 'script-1',
            requestIdentifier: 'request-1',
            contextPreview: 'fetch("/api/a")',
          },
          {
            scriptIdentifier: 'script-2',
            requestIdentifier: 'request-2',
            contextPreview: 'fetch("/api/b")',
          },
          {
            scriptIdentifier: 'script-3',
            requestIdentifier: 'request-3',
            contextPreview: 'fetch("/api/c")',
          },
        ],
      },
      {
        items: {
          format: 'table',
          columns: ['scriptIdentifier', 'requestIdentifier', 'contextPreview'],
          rows: [
            ['script-1', 'request-1', 'fetch("/api/a")'],
            ['script-2', 'request-2', 'fetch("/api/b")'],
            ['script-3', 'request-3', 'fetch("/api/c")'],
          ],
        },
      },
    );

    expect(comparison.fullBytes).toBeGreaterThan(comparison.compactBytes);
    expect(comparison.savedBytes).toBe(comparison.fullBytes - comparison.compactBytes);
    expect(comparison.savedPercent).toBeGreaterThan(0);
  });

  test('recommends compact only when it is strictly smaller', () => {
    expect(recommendPayloadMode({ fullBytes: 100, compactBytes: 80 })).toBe('compact');
    expect(recommendPayloadMode({ fullBytes: 100, compactBytes: 100 })).toBe('full');
    expect(recommendPayloadMode({ fullBytes: 100, compactBytes: 120 })).toBe('full');
  });
});
