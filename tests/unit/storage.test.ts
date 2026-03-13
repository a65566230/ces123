import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
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

  test('keeps request records isolated across sessions even when requestId is reused', async () => {
    const dbPath = await createTempDbPath('requests-session-isolation');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.writeRequestBatch('session-a', [
      {
        requestId: 'shared-request-id',
        url: 'https://example.test/a',
        method: 'POST',
        headers: { authorization: 'Bearer A' },
        type: 'Fetch',
        timestamp: Date.now(),
        response: {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
        },
        body: {
          text: JSON.stringify({ marker: 'A' }),
          encoding: 'utf8',
        },
      },
    ]);

    await storage.writeRequestBatch('session-b', [
      {
        requestId: 'shared-request-id',
        url: 'https://example.test/b',
        method: 'POST',
        headers: { authorization: 'Bearer B' },
        type: 'Fetch',
        timestamp: Date.now() + 1,
        response: {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
        },
        body: {
          text: JSON.stringify({ marker: 'B' }),
          encoding: 'utf8',
        },
      },
    ]);

    const sessionA = await storage.searchRequests({
      sessionId: 'session-a',
      limit: 5,
    });
    const sessionB = await storage.searchRequests({
      sessionId: 'session-b',
      limit: 5,
    });

    expect(sessionA.total).toBe(1);
    expect(sessionA.items[0]?.url).toBe('https://example.test/a');
    expect(sessionB.total).toBe(1);
    expect(sessionB.items[0]?.url).toBe('https://example.test/b');
  });

  test('migrates legacy request schema to session-scoped request isolation', async () => {
    const dbPath = await createTempDbPath('requests-legacy-migration');
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        type TEXT,
        headers_json TEXT,
        initiator_json TEXT,
        body_ref TEXT,
        response_body_ref TEXT,
        status INTEGER,
        status_text TEXT,
        response_headers_json TEXT,
        mime_type TEXT,
        request_timestamp INTEGER NOT NULL,
        response_timestamp INTEGER,
        from_cache INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE request_bodies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        body_ref TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        encoding TEXT,
        body_text TEXT,
        body_base64 TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE requests_fts USING fts5(
        session_id UNINDEXED,
        request_id UNINDEXED,
        url,
        method,
        headers_text,
        body_text,
        response_body_text
      );
    `);
    legacyDb.prepare(`
      INSERT INTO requests (
        session_id, request_id, url, method, type, headers_json, initiator_json,
        body_ref, response_body_ref, status, status_text, response_headers_json,
        mime_type, request_timestamp, response_timestamp, from_cache
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-session',
      'shared-request-id',
      'https://example.test/legacy',
      'POST',
      'Fetch',
      '{}',
      '{}',
      null,
      null,
      200,
      'OK',
      '{}',
      'application/json',
      Date.now(),
      Date.now(),
      0,
    );
    legacyDb.close();

    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.writeRequestBatch('new-session', [
      {
        requestId: 'shared-request-id',
        url: 'https://example.test/new',
        method: 'POST',
        headers: { authorization: 'Bearer new' },
        type: 'Fetch',
        timestamp: Date.now() + 1,
        response: {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
        },
      },
    ]);

    const legacySession = await storage.searchRequests({
      sessionId: 'legacy-session',
      limit: 5,
    });
    const newSession = await storage.searchRequests({
      sessionId: 'new-session',
      limit: 5,
    });

    expect(legacySession.total).toBe(1);
    expect(legacySession.items[0]?.url).toBe('https://example.test/legacy');
    expect(newSession.total).toBe(1);
    expect(newSession.items[0]?.url).toBe('https://example.test/new');
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

  test('keeps script chunks isolated across sessions even when chunkRef is reused', async () => {
    const dbPath = await createTempDbPath('scripts-session-isolation');
    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.storeScriptChunkBatch('session-script-a', [
      {
        scriptId: 'script-1',
        url: 'https://example.test/a.js',
        chunkIndex: 0,
        chunkRef: 'script-1:0',
        content: 'const marker = "A";',
        size: 20,
      },
    ]);

    await storage.storeScriptChunkBatch('session-script-b', [
      {
        scriptId: 'script-1',
        url: 'https://example.test/b.js',
        chunkIndex: 0,
        chunkRef: 'script-1:0',
        content: 'const marker = "B";',
        size: 20,
      },
    ]);

    const chunkA = await storage.getScriptChunk('session-script-a', 'script-1:0');
    const chunkB = await storage.getScriptChunk('session-script-b', 'script-1:0');

    expect(chunkA?.url).toBe('https://example.test/a.js');
    expect(chunkA?.content).toContain('"A"');
    expect(chunkB?.url).toBe('https://example.test/b.js');
    expect(chunkB?.content).toContain('"B"');
  });

  test('migrates legacy script chunk schema to session-scoped chunk isolation', async () => {
    const dbPath = await createTempDbPath('scripts-legacy-migration');
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE script_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        script_id TEXT NOT NULL,
        url TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_ref TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE script_chunks_fts USING fts5(
        session_id UNINDEXED,
        script_id UNINDEXED,
        chunk_ref UNINDEXED,
        url,
        content
      );
    `);
    legacyDb.prepare(`
      INSERT INTO script_chunks (session_id, script_id, url, chunk_index, chunk_ref, content, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-script-session',
      'script-1',
      'https://example.test/legacy.js',
      0,
      'script-1:0',
      'const legacy = true;',
      20,
      Date.now(),
    );
    legacyDb.close();

    const storage = new StorageService({
      databasePath: dbPath,
      cacheSize: 2,
    });

    await storage.init();
    await storage.storeScriptChunkBatch('new-script-session', [
      {
        scriptId: 'script-1',
        url: 'https://example.test/new.js',
        chunkIndex: 0,
        chunkRef: 'script-1:0',
        content: 'const migrated = true;',
        size: 22,
      },
    ]);

    const legacyChunk = await storage.getScriptChunk('legacy-script-session', 'script-1:0');
    const newChunk = await storage.getScriptChunk('new-script-session', 'script-1:0');

    expect(legacyChunk?.url).toBe('https://example.test/legacy.js');
    expect(newChunk?.url).toBe('https://example.test/new.js');
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
