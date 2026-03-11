import { ArtifactStore } from '../../src/server/v2/runtime/ArtifactStore.js';
import { maybeExternalize, successResponse } from '../../src/server/v2/response.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';

describe('response helpers', () => {
  test('keeps small payloads inline', () => {
    const store = new ArtifactStore();
    const result = maybeExternalize(store, 'inline', 'small payload', { ok: true }, 'session-inline');

    expect(result.data).toEqual({ ok: true });
    expect(result.artifactId).toBeUndefined();
  });

  test('externalizes large payloads into an artifact', () => {
    const store = new ArtifactStore();
    const result = maybeExternalize(store, 'large', 'large payload', { blob: 'x'.repeat(30_000) }, 'session-large');

    expect(result.artifactId).toBeDefined();
    expect(store.get(result.artifactId!)).toBeDefined();
    expect(result.detailId).toBe(result.artifactId);
  });

  test('serializes success envelopes as MCP text payloads', () => {
    const response = successResponse('done', { feature: 'v2' });
    const parsed = parseToolResponse(response);

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('done');
    expect(parsed.data).toEqual({ feature: 'v2' });
  });
});
