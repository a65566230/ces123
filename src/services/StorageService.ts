import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { LRUCache } from 'lru-cache';

export interface StorageServiceOptions {
  databasePath: string;
  cacheSize?: number;
}

export interface StoredBodyPayload {
  text?: string;
  base64?: string;
  encoding?: string;
}

export interface StoredRequestRecord {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, unknown>;
  type?: string;
  timestamp: number;
  initiator?: unknown;
  response?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, unknown>;
    mimeType?: string;
    timestamp?: number;
    fromCache?: boolean;
  };
  body?: StoredBodyPayload;
  responseBody?: StoredBodyPayload;
}

export interface SearchRequestsOptions {
  sessionId: string;
  query?: string;
  limit?: number;
}

export interface SearchRequestMatch {
  requestId: string;
  url: string;
  method: string;
  status: number | null;
  mimeType: string | null;
  bodyRef: string | null;
  responseBodyRef: string | null;
  timestamp: number;
}

export interface SearchRequestsResult {
  total: number;
  items: SearchRequestMatch[];
}

export interface StoredScriptChunk {
  scriptId: string;
  url: string;
  chunkIndex: number;
  chunkRef: string;
  content: string;
  size: number;
}

export interface SearchScriptChunksOptions {
  sessionId: string;
  query?: string;
  limit?: number;
}

export interface SearchScriptChunkMatch {
  scriptId: string;
  url: string;
  chunkIndex: number;
  chunkRef: string;
  size: number;
  contentPreview: string;
}

export interface SearchScriptChunksResult {
  total: number;
  items: SearchScriptChunkMatch[];
}

export interface StoredHookEvent {
  hookId: string;
  eventType: string;
  summary: string;
  payload?: unknown;
  createdAt?: number;
}

export interface ListHookEventsOptions {
  sessionId: string;
  hookId?: string;
  limit?: number;
}

export interface StoredBreakpointRecord {
  breakpointId: string;
  location: unknown;
  condition?: string;
  enabled: boolean;
  hitCount?: number;
  payload?: unknown;
  updatedAt?: number;
}

export interface ListBreakpointsOptions {
  sessionId: string;
  limit?: number;
}

export interface StoredPerformanceSample {
  metricType: string;
  value: number;
  unit?: string;
  payload?: unknown;
  createdAt?: number;
}

export interface SummarizePerformanceOptions {
  sessionId: string;
  metricType?: string;
}

export interface PerformanceSummary {
  count: number;
  average: number | null;
  max: number | null;
  min: number | null;
}

export interface LlmCacheRecord {
  cacheKey: string;
  semanticKey: string;
  kind: string;
  provider: string;
  model: string;
  promptPreview: string;
  responseText: string;
  usage?: unknown;
  createdAt: number;
  expiresAt: number;
}

interface CachedValue<T> {
  value: T;
}

/**
 * SQLite-backed persistence service for high-volume request, script, hook, and debugger data.
 * All writes are durable on disk while a small LRU cache accelerates repeated reads.
 */
export class StorageService {
  private static readonly QUERY_CACHE_MAX_ENTRIES = 1000;
  private static readonly QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly options: Required<StorageServiceOptions>;
  private readonly queryCache: LRUCache<string, CachedValue<unknown>>;
  private db: Database.Database | null = null;
  private lastMaintenanceAt = 0;

  public constructor(options: StorageServiceOptions) {
    this.options = {
      databasePath: options.databasePath,
      cacheSize: options.cacheSize ?? 500,
    };
    this.queryCache = new LRUCache<string, CachedValue<unknown>>({
      max: StorageService.QUERY_CACHE_MAX_ENTRIES,
      ttl: StorageService.QUERY_CACHE_TTL_MS,
    });
  }

  /**
   * Opens the SQLite database, enables WAL mode, and creates required tables/indexes.
   */
  public async init(): Promise<void> {
    if (this.db) {
      return;
    }

    const directory = path.dirname(this.options.databasePath);
    fs.mkdirSync(directory, { recursive: true });

    const database = new Database(this.options.databasePath);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');
    database.pragma('temp_store = MEMORY');

    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        engine TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS request_bodies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        body_ref TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        encoding TEXT,
        body_text TEXT,
        body_base64 TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
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
        from_cache INTEGER NOT NULL DEFAULT 0,
        UNIQUE(session_id, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_requests_session_time
        ON requests(session_id, request_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_requests_session_url_time
        ON requests(session_id, url, request_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_requests_session_method_time
        ON requests(session_id, method, request_timestamp DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS requests_fts USING fts5(
        session_id UNINDEXED,
        request_id UNINDEXED,
        url,
        method,
        headers_text,
        body_text,
        response_body_text
      );

      CREATE TABLE IF NOT EXISTS script_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        script_id TEXT NOT NULL,
        url TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_ref TEXT NOT NULL,
        content TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, chunk_ref)
      );

      CREATE INDEX IF NOT EXISTS idx_script_chunks_session_script
        ON script_chunks(session_id, script_id, chunk_index);

      CREATE INDEX IF NOT EXISTS idx_script_chunks_session_url
        ON script_chunks(session_id, url, chunk_index);

      CREATE VIRTUAL TABLE IF NOT EXISTS script_chunks_fts USING fts5(
        session_id UNINDEXED,
        script_id UNINDEXED,
        chunk_ref UNINDEXED,
        url,
        content
      );

      CREATE TABLE IF NOT EXISTS hooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        hook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hooks_session_hook
        ON hooks(session_id, hook_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS breakpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        breakpoint_id TEXT NOT NULL,
        location_json TEXT NOT NULL,
        condition_text TEXT,
        enabled INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, breakpoint_id)
      );

      CREATE TABLE IF NOT EXISTS performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_cache (
        cache_key TEXT PRIMARY KEY,
        semantic_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        response_text TEXT NOT NULL,
        usage_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_llm_cache_semantic
        ON llm_cache(semantic_key, kind, provider, model, expires_at DESC);

      CREATE INDEX IF NOT EXISTS idx_llm_cache_expires_at
        ON llm_cache(expires_at);
    `);

    this.ensureRequestSessionIsolationSchema(database);
    this.ensureScriptChunkSessionIsolationSchema(database);

    database.pragma('optimize');

    this.db = database;
  }

  private ensureRequestSessionIsolationSchema(database: Database.Database): void {
    const schemaRow = database.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'requests'
    `).get() as { sql?: string } | undefined;

    const schemaSql = String(schemaRow?.sql || '').replace(/\s+/g, ' ').toUpperCase();
    const usesLegacyGlobalRequestId = schemaSql.includes('REQUEST_ID TEXT NOT NULL UNIQUE');
    const hasSessionScopedConstraint = schemaSql.includes('UNIQUE(SESSION_ID, REQUEST_ID)');

    if (!usesLegacyGlobalRequestId && hasSessionScopedConstraint) {
      return;
    }

    const transaction = database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS requests_fts;
        ALTER TABLE requests RENAME TO requests_legacy_migration;

        CREATE TABLE requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
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
          from_cache INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_id, request_id)
        );

        CREATE INDEX IF NOT EXISTS idx_requests_session_time
          ON requests(session_id, request_timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_requests_session_url_time
          ON requests(session_id, url, request_timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_requests_session_method_time
          ON requests(session_id, method, request_timestamp DESC);

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

      database.exec(`
        INSERT INTO requests (
          session_id,
          request_id,
          url,
          method,
          type,
          headers_json,
          initiator_json,
          body_ref,
          response_body_ref,
          status,
          status_text,
          response_headers_json,
          mime_type,
          request_timestamp,
          response_timestamp,
          from_cache
        )
        SELECT
          session_id,
          request_id,
          url,
          method,
          type,
          headers_json,
          initiator_json,
          body_ref,
          response_body_ref,
          status,
          status_text,
          response_headers_json,
          mime_type,
          request_timestamp,
          response_timestamp,
          from_cache
        FROM requests_legacy_migration
      `);

      database.exec(`
        INSERT INTO requests_fts (rowid, session_id, request_id, url, method, headers_text, body_text, response_body_text)
        SELECT
          requests.id,
          requests.session_id,
          requests.request_id,
          requests.url,
          requests.method,
          COALESCE(requests.headers_json, ''),
          COALESCE(request_body.body_text, ''),
          COALESCE(response_body.body_text, '')
        FROM requests
        LEFT JOIN request_bodies request_body ON request_body.body_ref = requests.body_ref
        LEFT JOIN request_bodies response_body ON response_body.body_ref = requests.response_body_ref
      `);

      database.exec(`
        DROP TABLE requests_legacy_migration
      `);
    });

    transaction();
  }

  private ensureScriptChunkSessionIsolationSchema(database: Database.Database): void {
    const schemaRow = database.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'script_chunks'
    `).get() as { sql?: string } | undefined;

    const schemaSql = String(schemaRow?.sql || '').replace(/\s+/g, ' ').toUpperCase();
    const usesLegacyGlobalChunkRef = schemaSql.includes('CHUNK_REF TEXT NOT NULL UNIQUE');
    const hasSessionScopedConstraint = schemaSql.includes('UNIQUE(SESSION_ID, CHUNK_REF)');

    if (!usesLegacyGlobalChunkRef && hasSessionScopedConstraint) {
      return;
    }

    const transaction = database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS script_chunks_fts;
        ALTER TABLE script_chunks RENAME TO script_chunks_legacy_migration;

        CREATE TABLE script_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          script_id TEXT NOT NULL,
          url TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          chunk_ref TEXT NOT NULL,
          content TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(session_id, chunk_ref)
        );

        CREATE INDEX IF NOT EXISTS idx_script_chunks_session_script
          ON script_chunks(session_id, script_id, chunk_index);

        CREATE INDEX IF NOT EXISTS idx_script_chunks_session_url
          ON script_chunks(session_id, url, chunk_index);

        CREATE VIRTUAL TABLE script_chunks_fts USING fts5(
          session_id UNINDEXED,
          script_id UNINDEXED,
          chunk_ref UNINDEXED,
          url,
          content
        );
      `);

      database.exec(`
        INSERT INTO script_chunks (
          session_id,
          script_id,
          url,
          chunk_index,
          chunk_ref,
          content,
          size,
          created_at
        )
        SELECT
          session_id,
          script_id,
          url,
          chunk_index,
          chunk_ref,
          content,
          size,
          created_at
        FROM script_chunks_legacy_migration
      `);

      database.exec(`
        INSERT INTO script_chunks_fts (rowid, session_id, script_id, chunk_ref, url, content)
        SELECT
          id,
          session_id,
          script_id,
          chunk_ref,
          url,
          content
        FROM script_chunks
      `);

      database.exec(`
        DROP TABLE script_chunks_legacy_migration
      `);
    });

    transaction();
  }

  /**
   * Closes the underlying SQLite database.
   */
  public async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
    this.queryCache.clear();
  }

  public async cleanup(): Promise<{
    deletedLlmCacheEntries: number;
    optimized: boolean;
    analyzed: boolean;
    vacuumed: boolean;
    walCheckpoint: boolean;
    maintenancePerformed: boolean;
  }> {
    const db = this.getDb();
    const now = Date.now();
    const deleteExpired = db.prepare('DELETE FROM llm_cache WHERE expires_at <= ?').run(now);
    let maintenanceDue = now - this.lastMaintenanceAt >= StorageService.MAINTENANCE_INTERVAL_MS;

    let analyzed = false;
    let vacuumed = false;
    let walCheckpoint = false;

    if (this.lastMaintenanceAt === 0) {
      this.lastMaintenanceAt = now;
      maintenanceDue = false;
    }

    if (maintenanceDue) {
      db.exec('ANALYZE;');
      analyzed = true;
      db.exec('VACUUM;');
      vacuumed = true;
      db.pragma('wal_checkpoint(TRUNCATE)');
      walCheckpoint = true;
      this.lastMaintenanceAt = now;
    }

    db.pragma('optimize');
    this.queryCache.clear();

    return {
      deletedLlmCacheEntries: deleteExpired.changes,
      optimized: true,
      analyzed,
      vacuumed,
      walCheckpoint,
      maintenancePerformed: maintenanceDue,
    };
  }

  /**
   * Persists a batch of network requests and their textual bodies.
   */
  public async writeRequestBatch(sessionId: string, records: StoredRequestRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const db = this.getDb();
    const upsertBody = db.prepare(`
      INSERT INTO request_bodies (session_id, body_ref, kind, encoding, body_text, body_base64, created_at)
      VALUES (@sessionId, @bodyRef, @kind, @encoding, @bodyText, @bodyBase64, @createdAt)
      ON CONFLICT(body_ref) DO UPDATE SET
        encoding = excluded.encoding,
        body_text = excluded.body_text,
        body_base64 = excluded.body_base64
    `);
    const upsertRequest = db.prepare(`
      INSERT INTO requests (
        session_id,
        request_id,
        url,
        method,
        type,
        headers_json,
        initiator_json,
        body_ref,
        response_body_ref,
        status,
        status_text,
        response_headers_json,
        mime_type,
        request_timestamp,
        response_timestamp,
        from_cache
      ) VALUES (
        @sessionId,
        @requestId,
        @url,
        @method,
        @type,
        @headersJson,
        @initiatorJson,
        @bodyRef,
        @responseBodyRef,
        @status,
        @statusText,
        @responseHeadersJson,
        @mimeType,
        @requestTimestamp,
        @responseTimestamp,
        @fromCache
      )
      ON CONFLICT(session_id, request_id) DO UPDATE SET
        url = excluded.url,
        method = excluded.method,
        type = excluded.type,
        headers_json = excluded.headers_json,
        initiator_json = excluded.initiator_json,
        body_ref = excluded.body_ref,
        response_body_ref = excluded.response_body_ref,
        status = excluded.status,
        status_text = excluded.status_text,
        response_headers_json = excluded.response_headers_json,
        mime_type = excluded.mime_type,
        request_timestamp = excluded.request_timestamp,
        response_timestamp = excluded.response_timestamp,
        from_cache = excluded.from_cache
    `);
    const selectRequestRowId = db.prepare('SELECT id FROM requests WHERE session_id = ? AND request_id = ?');
    const deleteRequestsFts = db.prepare('DELETE FROM requests_fts WHERE rowid = ?');
    const insertRequestsFts = db.prepare(`
      INSERT INTO requests_fts (rowid, session_id, request_id, url, method, headers_text, body_text, response_body_text)
      VALUES (@rowId, @sessionId, @requestId, @url, @method, @headersText, @bodyText, @responseBodyText)
    `);

    const transaction = db.transaction((input: StoredRequestRecord[]) => {
      for (const record of input) {
        const createdAt = Date.now();
        const requestBodyRef = record.body && (record.body.text || record.body.base64)
          ? `request:${sessionId}:${record.requestId}`
          : null;
        const responseBodyRef = record.responseBody && (record.responseBody.text || record.responseBody.base64)
          ? `response:${sessionId}:${record.requestId}`
          : null;

        if (requestBodyRef) {
          upsertBody.run({
            sessionId,
            bodyRef: requestBodyRef,
            kind: 'request',
            encoding: record.body?.encoding ?? 'utf8',
            bodyText: record.body?.text ?? null,
            bodyBase64: record.body?.base64 ?? null,
            createdAt,
          });
        }

        if (responseBodyRef) {
          upsertBody.run({
            sessionId,
            bodyRef: responseBodyRef,
            kind: 'response',
            encoding: record.responseBody?.encoding ?? 'utf8',
            bodyText: record.responseBody?.text ?? null,
            bodyBase64: record.responseBody?.base64 ?? null,
            createdAt,
          });
        }

        upsertRequest.run({
          sessionId,
          requestId: record.requestId,
          url: record.url,
          method: record.method,
          type: record.type ?? null,
          headersJson: this.stringifyJson(record.headers),
          initiatorJson: this.stringifyJson(record.initiator),
          bodyRef: requestBodyRef,
          responseBodyRef,
          status: record.response?.status ?? null,
          statusText: record.response?.statusText ?? null,
          responseHeadersJson: this.stringifyJson(record.response?.headers),
          mimeType: record.response?.mimeType ?? null,
          requestTimestamp: record.timestamp,
          responseTimestamp: record.response?.timestamp ?? null,
          fromCache: record.response?.fromCache ? 1 : 0,
        });

        const row = selectRequestRowId.get(sessionId, record.requestId) as { id: number } | undefined;
        if (!row) {
          continue;
        }

        deleteRequestsFts.run(row.id);
        insertRequestsFts.run({
          rowId: row.id,
          sessionId,
          requestId: record.requestId,
          url: record.url,
          method: record.method,
          headersText: this.toSearchableText(record.headers),
          bodyText: record.body?.text ?? '',
          responseBodyText: record.responseBody?.text ?? '',
        });
      }
    });

    transaction(records);
    this.queryCache.clear();
  }

  /**
   * Searches persisted requests by full text or falls back to LIKE matching when FTS yields no results.
   */
  public async searchRequests(options: SearchRequestsOptions): Promise<SearchRequestsResult> {
    const cacheKey = `requests:${JSON.stringify(options)}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return cached.value as SearchRequestsResult;
    }

    const db = this.getDb();
    const limit = options.limit ?? 20;
    let rows: SearchRequestMatch[] = [];

    if (options.query && options.query.trim().length > 0) {
      const ftsQuery = this.toFtsQuery(options.query);
      rows = db.prepare(`
        SELECT
          requests.request_id AS requestId,
          requests.url AS url,
          requests.method AS method,
          requests.status AS status,
          requests.mime_type AS mimeType,
          requests.body_ref AS bodyRef,
          requests.response_body_ref AS responseBodyRef,
          requests.request_timestamp AS timestamp
        FROM requests
        INNER JOIN requests_fts ON requests_fts.rowid = requests.id
        WHERE requests.session_id = ? AND requests_fts MATCH ?
        ORDER BY requests.request_timestamp DESC
        LIMIT ?
      `).all(options.sessionId, ftsQuery, limit) as SearchRequestMatch[];

      if (rows.length === 0) {
        const like = `%${options.query}%`;
        rows = db.prepare(`
          SELECT
            requests.request_id AS requestId,
            requests.url AS url,
            requests.method AS method,
            requests.status AS status,
            requests.mime_type AS mimeType,
            requests.body_ref AS bodyRef,
            requests.response_body_ref AS responseBodyRef,
            requests.request_timestamp AS timestamp
          FROM requests
          LEFT JOIN request_bodies request_body ON request_body.body_ref = requests.body_ref
          LEFT JOIN request_bodies response_body ON response_body.body_ref = requests.response_body_ref
          WHERE requests.session_id = ?
            AND (
              requests.url LIKE ?
              OR requests.method LIKE ?
              OR COALESCE(requests.headers_json, '') LIKE ?
              OR COALESCE(request_body.body_text, '') LIKE ?
              OR COALESCE(response_body.body_text, '') LIKE ?
            )
          ORDER BY requests.request_timestamp DESC
          LIMIT ?
        `).all(options.sessionId, like, like, like, like, like, limit) as SearchRequestMatch[];
      }
    } else {
      rows = db.prepare(`
        SELECT
          request_id AS requestId,
          url,
          method,
          status,
          mime_type AS mimeType,
          body_ref AS bodyRef,
          response_body_ref AS responseBodyRef,
          request_timestamp AS timestamp
        FROM requests
        WHERE session_id = ?
        ORDER BY request_timestamp DESC
        LIMIT ?
      `).all(options.sessionId, limit) as SearchRequestMatch[];
    }

    const result: SearchRequestsResult = {
      total: rows.length,
      items: rows,
    };
    this.queryCache.set(cacheKey, { value: result });
    return result;
  }

  /**
   * Persists script chunks and indexes them with SQLite FTS5.
   */
  public async storeScriptChunkBatch(sessionId: string, chunks: StoredScriptChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const db = this.getDb();
    const upsertChunk = db.prepare(`
      INSERT INTO script_chunks (session_id, script_id, url, chunk_index, chunk_ref, content, size, created_at)
      VALUES (@sessionId, @scriptId, @url, @chunkIndex, @chunkRef, @content, @size, @createdAt)
      ON CONFLICT(session_id, chunk_ref) DO UPDATE SET
        url = excluded.url,
        content = excluded.content,
        size = excluded.size
    `);
    const selectChunkRowId = db.prepare('SELECT id FROM script_chunks WHERE session_id = ? AND chunk_ref = ?');
    const listChunkRowsByScript = db.prepare(`
      SELECT id, chunk_ref AS chunkRef
      FROM script_chunks
      WHERE session_id = ? AND script_id = ?
    `);
    const deleteChunkFts = db.prepare('DELETE FROM script_chunks_fts WHERE rowid = ?');
    const deleteChunkRow = db.prepare('DELETE FROM script_chunks WHERE id = ?');
    const insertChunkFts = db.prepare(`
      INSERT INTO script_chunks_fts (rowid, session_id, script_id, chunk_ref, url, content)
      VALUES (@rowId, @sessionId, @scriptId, @chunkRef, @url, @content)
    `);

    const transaction = db.transaction((input: StoredScriptChunk[]) => {
      const chunkRefsByScript = new Map<string, Set<string>>();
      for (const chunk of input) {
        if (!chunkRefsByScript.has(chunk.scriptId)) {
          chunkRefsByScript.set(chunk.scriptId, new Set());
        }
        chunkRefsByScript.get(chunk.scriptId)!.add(chunk.chunkRef);
      }

      for (const chunk of input) {
        upsertChunk.run({
          sessionId,
          scriptId: chunk.scriptId,
          url: chunk.url,
          chunkIndex: chunk.chunkIndex,
          chunkRef: chunk.chunkRef,
          content: chunk.content,
          size: chunk.size,
          createdAt: Date.now(),
        });

        const row = selectChunkRowId.get(sessionId, chunk.chunkRef) as { id: number } | undefined;
        if (!row) {
          continue;
        }

        deleteChunkFts.run(row.id);
        insertChunkFts.run({
          rowId: row.id,
          sessionId,
          scriptId: chunk.scriptId,
          chunkRef: chunk.chunkRef,
          url: chunk.url,
          content: chunk.content,
        });
      }

      for (const [scriptId, chunkRefs] of chunkRefsByScript.entries()) {
        const existingRows = listChunkRowsByScript.all(sessionId, scriptId) as Array<{ id: number; chunkRef: string }>;
        for (const row of existingRows) {
          if (chunkRefs.has(row.chunkRef)) {
            continue;
          }
          deleteChunkFts.run(row.id);
          deleteChunkRow.run(row.id);
        }
      }
    });

    transaction(chunks);
    this.queryCache.clear();
  }

  /**
   * Searches stored script chunks using FTS5 with a LIKE fallback.
   */
  public async searchScriptChunks(options: SearchScriptChunksOptions): Promise<SearchScriptChunksResult> {
    const cacheKey = `scriptChunks:${JSON.stringify(options)}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return cached.value as SearchScriptChunksResult;
    }

    const db = this.getDb();
    const limit = options.limit ?? 20;
    let rows: SearchScriptChunkMatch[] = [];

    if (options.query && options.query.trim().length > 0) {
      const ftsQuery = this.toFtsQuery(options.query);
      rows = db.prepare(`
        SELECT
          script_chunks.script_id AS scriptId,
          script_chunks.url AS url,
          script_chunks.chunk_index AS chunkIndex,
          script_chunks.chunk_ref AS chunkRef,
          script_chunks.size AS size,
          substr(script_chunks.content, 1, 240) AS contentPreview
        FROM script_chunks
        INNER JOIN script_chunks_fts ON script_chunks_fts.rowid = script_chunks.id
        WHERE script_chunks.session_id = ? AND script_chunks_fts MATCH ?
        ORDER BY script_chunks.chunk_index ASC
        LIMIT ?
      `).all(options.sessionId, ftsQuery, limit) as SearchScriptChunkMatch[];

      if (rows.length === 0) {
        rows = db.prepare(`
          SELECT
            script_id AS scriptId,
            url,
            chunk_index AS chunkIndex,
            chunk_ref AS chunkRef,
            size,
            substr(content, 1, 240) AS contentPreview
          FROM script_chunks
          WHERE session_id = ? AND (url LIKE ? OR content LIKE ?)
          ORDER BY chunk_index ASC
          LIMIT ?
        `).all(options.sessionId, `%${options.query}%`, `%${options.query}%`, limit) as SearchScriptChunkMatch[];
      }
    } else {
      rows = db.prepare(`
        SELECT
          script_id AS scriptId,
          url,
          chunk_index AS chunkIndex,
          chunk_ref AS chunkRef,
          size,
          substr(content, 1, 240) AS contentPreview
        FROM script_chunks
        WHERE session_id = ?
        ORDER BY chunk_index ASC
        LIMIT ?
      `).all(options.sessionId, limit) as SearchScriptChunkMatch[];
    }

    const result: SearchScriptChunksResult = {
      total: rows.length,
      items: rows,
    };
    this.queryCache.set(cacheKey, { value: result });
    return result;
  }

  /**
   * Loads a single persisted script chunk by chunk reference.
   */
  public async getScriptChunk(
    sessionId: string,
    chunkRef: string,
  ): Promise<StoredScriptChunk | null> {
    const cacheKey = `scriptChunk:${sessionId}:${chunkRef}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return cached.value as StoredScriptChunk | null;
    }

    const db = this.getDb();
    const row = db.prepare(`
      SELECT
        script_id AS scriptId,
        url,
        chunk_index AS chunkIndex,
        chunk_ref AS chunkRef,
        content,
        size
      FROM script_chunks
      WHERE session_id = ? AND chunk_ref = ?
      LIMIT 1
    `).get(sessionId, chunkRef) as StoredScriptChunk | undefined;

    const result = row ?? null;
    this.queryCache.set(cacheKey, { value: result });
    return result;
  }

  /**
   * Persists hook events for later retrieval and RAG-friendly history.
   */
  public async recordHookEvent(sessionId: string, event: StoredHookEvent): Promise<void> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO hooks (session_id, hook_id, event_type, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      event.hookId,
      event.eventType,
      event.summary,
      this.stringifyJson(event.payload),
      event.createdAt ?? Date.now(),
    );
    this.queryCache.clear();
  }

  /**
   * Lists stored hook events for a session or single hook id.
   */
  public async listHookEvents(options: ListHookEventsOptions): Promise<StoredHookEvent[]> {
    const db = this.getDb();
    const limit = options.limit ?? 50;
    const rows = options.hookId
      ? db.prepare(`
          SELECT hook_id AS hookId, event_type AS eventType, summary, payload_json AS payloadJson, created_at AS createdAt
          FROM hooks
          WHERE session_id = ? AND hook_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(options.sessionId, options.hookId, limit)
      : db.prepare(`
          SELECT hook_id AS hookId, event_type AS eventType, summary, payload_json AS payloadJson, created_at AS createdAt
          FROM hooks
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(options.sessionId, limit);

    return (rows as Array<{ hookId: string; eventType: string; summary: string; payloadJson: string | null; createdAt: number }>).map((row) => ({
      hookId: row.hookId,
      eventType: row.eventType,
      summary: row.summary,
      payload: this.parseJson(row.payloadJson),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Upserts breakpoint state so debugger sessions can be restored or inspected later.
   */
  public async recordBreakpoint(sessionId: string, breakpoint: StoredBreakpointRecord): Promise<void> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO breakpoints (
        session_id,
        breakpoint_id,
        location_json,
        condition_text,
        enabled,
        hit_count,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, breakpoint_id) DO UPDATE SET
        location_json = excluded.location_json,
        condition_text = excluded.condition_text,
        enabled = excluded.enabled,
        hit_count = excluded.hit_count,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      sessionId,
      breakpoint.breakpointId,
      this.stringifyJson(breakpoint.location),
      breakpoint.condition ?? null,
      breakpoint.enabled ? 1 : 0,
      breakpoint.hitCount ?? 0,
      this.stringifyJson(breakpoint.payload),
      breakpoint.updatedAt ?? Date.now(),
      breakpoint.updatedAt ?? Date.now(),
    );
    this.queryCache.clear();
  }

  /**
   * Lists stored breakpoints for a session.
   */
  public async listBreakpoints(options: ListBreakpointsOptions): Promise<StoredBreakpointRecord[]> {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT
        breakpoint_id AS breakpointId,
        location_json AS locationJson,
        condition_text AS conditionText,
        enabled,
        hit_count AS hitCount,
        payload_json AS payloadJson,
        updated_at AS updatedAt
      FROM breakpoints
      WHERE session_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(options.sessionId, options.limit ?? 100);

    return (rows as Array<{
      breakpointId: string;
      locationJson: string;
      conditionText: string | null;
      enabled: number;
      hitCount: number;
      payloadJson: string | null;
      updatedAt: number;
    }>).map((row) => ({
      breakpointId: row.breakpointId,
      location: this.parseJson(row.locationJson),
      condition: row.conditionText ?? undefined,
      enabled: row.enabled === 1,
      hitCount: row.hitCount,
      payload: this.parseJson(row.payloadJson),
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Records a single performance sample.
   */
  public async recordPerformanceSample(sessionId: string, sample: StoredPerformanceSample): Promise<void> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO performance (session_id, metric_type, value, unit, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      sample.metricType,
      sample.value,
      sample.unit ?? null,
      this.stringifyJson(sample.payload),
      sample.createdAt ?? Date.now(),
    );
  }

  /**
   * Summarizes persisted performance metrics for a session.
   */
  public async summarizePerformance(options: SummarizePerformanceOptions): Promise<PerformanceSummary> {
    const db = this.getDb();
    const row = options.metricType
      ? db.prepare(`
          SELECT COUNT(*) AS count, AVG(value) AS average, MAX(value) AS max, MIN(value) AS min
          FROM performance
          WHERE session_id = ? AND metric_type = ?
        `).get(options.sessionId, options.metricType)
      : db.prepare(`
          SELECT COUNT(*) AS count, AVG(value) AS average, MAX(value) AS max, MIN(value) AS min
          FROM performance
          WHERE session_id = ?
        `).get(options.sessionId);

    return {
      count: Number((row as { count?: number } | undefined)?.count ?? 0),
      average: (row as { average?: number | null } | undefined)?.average ?? null,
      max: (row as { max?: number | null } | undefined)?.max ?? null,
      min: (row as { min?: number | null } | undefined)?.min ?? null,
    };
  }

  public async getLlmCacheEntry(cacheKey: string): Promise<LlmCacheRecord | null> {
    const db = this.getDb();
    const now = Date.now();
    const row = db.prepare(`
      SELECT
        cache_key AS cacheKey,
        semantic_key AS semanticKey,
        kind,
        provider,
        model,
        prompt_preview AS promptPreview,
        response_text AS responseText,
        usage_json AS usageJson,
        created_at AS createdAt,
        expires_at AS expiresAt
      FROM llm_cache
      WHERE cache_key = ? AND expires_at > ?
      LIMIT 1
    `).get(cacheKey, now);

    if (!row) {
      return null;
    }

    return {
      ...(row as Omit<LlmCacheRecord, 'usage'> & { usageJson?: string | null }),
      usage: this.parseJson((row as { usageJson?: string | null }).usageJson ?? null),
    };
  }

  public async findLlmCacheBySemanticKey(options: {
    semanticKey: string;
    kind: string;
    provider: string;
    model: string;
  }): Promise<LlmCacheRecord | null> {
    const db = this.getDb();
    const now = Date.now();
    const row = db.prepare(`
      SELECT
        cache_key AS cacheKey,
        semantic_key AS semanticKey,
        kind,
        provider,
        model,
        prompt_preview AS promptPreview,
        response_text AS responseText,
        usage_json AS usageJson,
        created_at AS createdAt,
        expires_at AS expiresAt
      FROM llm_cache
      WHERE semantic_key = ? AND kind = ? AND provider = ? AND model = ? AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(options.semanticKey, options.kind, options.provider, options.model, now);

    if (!row) {
      return null;
    }

    return {
      ...(row as Omit<LlmCacheRecord, 'usage'> & { usageJson?: string | null }),
      usage: this.parseJson((row as { usageJson?: string | null }).usageJson ?? null),
    };
  }

  public async setLlmCacheEntry(record: LlmCacheRecord): Promise<void> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO llm_cache (
        cache_key,
        semantic_key,
        kind,
        provider,
        model,
        prompt_preview,
        response_text,
        usage_json,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        semantic_key = excluded.semantic_key,
        kind = excluded.kind,
        provider = excluded.provider,
        model = excluded.model,
        prompt_preview = excluded.prompt_preview,
        response_text = excluded.response_text,
        usage_json = excluded.usage_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).run(
      record.cacheKey,
      record.semanticKey,
      record.kind,
      record.provider,
      record.model,
      record.promptPreview,
      record.responseText,
      this.stringifyJson(record.usage),
      record.createdAt,
      record.expiresAt,
    );
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('StorageService is not initialized');
    }

    return this.db;
  }

  private stringifyJson(value: unknown): string | null {
    if (value === undefined) {
      return null;
    }

    return JSON.stringify(value);
  }

  private parseJson<T>(value: string | null): T | undefined {
    if (!value) {
      return undefined;
    }

    return JSON.parse(value) as T;
  }

  private toSearchableText(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }

  private toFtsQuery(rawQuery: string): string {
    return rawQuery
      .trim()
      .split(/\s+/)
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(' AND ');
  }
}
