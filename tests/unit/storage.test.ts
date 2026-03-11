import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StorageService } from '../../src/services/StorageService.js';

async function createTempDbPath(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jshook-storage-'));
  return path.join(dir, `${name}.sqlite`);
}

describe('StorageService', () => {
  test('persists requests and supports FTS request search', async () => {
    const dbPath = await createTempDbPath('requests');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.writeRequestBatch('session-storage-1', [
      {
        requestId: 'req-1',
        url: 'https://example.test/api/sign',
        method: 'POST',
        headers: { authorization: 'Bearer fixture-token' },
        type: 'Fetch',
        timestamp: Date.now(),
        response: {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
        },
        body: {
          text: JSON.stringify({ nonce: 'fixture-nonce', signature: 'fixture-signature' }),
          encoding: 'utf8',
        },
      },
    ]);

    const result = await storage.searchRequests({
      sessionId: 'session-storage-1',
      query: 'fixture-signature',
      limit: 5,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.requestId).toBe('req-1');
  });

  test('stores script chunks and returns chunk refs from FTS search', async () => {
    const dbPath = await createTempDbPath('scripts');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.storeScriptChunkBatch('session-storage-2', [
      {
        scriptId: 'script-1',
        url: 'https://example.test/app.js',
        chunkIndex: 0,
        chunkRef: 'script-1:0',
        content: 'function signer(){ return "fixture-token"; }',
        size: 44,
      },
    ]);

    const result = await storage.searchScriptChunks({
      sessionId: 'session-storage-2',
      query: 'fixture-token',
      limit: 5,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.chunkRef).toBe('script-1:0');

    const chunk = await storage.getScriptChunk('session-storage-2', 'script-1:0');
    expect(chunk?.content).toContain('signer');
  });

  test('cleanup removes expired llm cache rows and keeps fresh entries', async () => {
    const dbPath = await createTempDbPath('cleanup');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.setLlmCacheEntry({
      cacheKey: 'expired-entry',
      semanticKey: 'semantic-expired',
      kind: 'chat',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptPreview: 'expired',
      responseText: 'expired',
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1_000,
    });
    await storage.setLlmCacheEntry({
      cacheKey: 'fresh-entry',
      semanticKey: 'semantic-fresh',
      kind: 'chat',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptPreview: 'fresh',
      responseText: 'fresh',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    const result = await storage.cleanup();

    expect(result.deletedLlmCacheEntries).toBe(1);
    expect(result.maintenancePerformed).toBe(false);
    expect(result.vacuumed).toBe(false);
    expect(result.analyzed).toBe(false);
    await expect(storage.getLlmCacheEntry('expired-entry')).resolves.toBeNull();
    await expect(storage.getLlmCacheEntry('fresh-entry')).resolves.toMatchObject({
      responseText: 'fresh',
    });
  });

  test('cleanup performs heavy maintenance only after the maintenance window elapses', async () => {
    const dbPath = await createTempDbPath('maintenance-window');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    const first = await storage.cleanup();
    expect(first.maintenancePerformed).toBe(false);

    // Simulate a stale maintenance clock without waiting a week in real time.
    (storage as unknown as { lastMaintenanceAt: number }).lastMaintenanceAt = Date.now() - (8 * 24 * 60 * 60 * 1000);
    const second = await storage.cleanup();

    expect(second.maintenancePerformed).toBe(true);
    expect(second.vacuumed).toBe(true);
    expect(second.analyzed).toBe(true);
  });
});
