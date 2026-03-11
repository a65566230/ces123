// @ts-nocheck

import { logger } from '../../../utils/logger.js';

export class SessionScriptInventory {
  sessionId;
  storage;
  entries = new Map();
  urlToScriptId = new Map();
  keywordIndex = new Map();
  chunks = new Map();
  CHUNK_SIZE = 100 * 1024;

  constructor(sessionId, storage) {
    this.sessionId = sessionId;
    this.storage = storage;
  }

  recordScripts(scripts, options = {}) {
    const indexPolicy = options.indexPolicy || 'metadata-only';

    for (const script of scripts) {
      const normalizedUrl = typeof script.url === 'string' && script.url.length > 0
        ? script.url
        : `inline:${script.scriptId}`;
      const existing = this.entries.get(script.scriptId) || {
        scriptId: script.scriptId,
        url: normalizedUrl,
      };

      existing.url = normalizedUrl;
      existing.sourceLength = script.sourceLength ?? script.source?.length ?? existing.sourceLength;

      if (typeof script.source === 'string') {
        existing.source = script.source;
        existing.sourceLoadedAt = new Date().toISOString();
      }

      this.entries.set(script.scriptId, existing);
      this.urlToScriptId.set(normalizedUrl, script.scriptId);

      if (typeof existing.source === 'string' && indexPolicy !== 'metadata-only') {
        this.indexScript(existing);
        if (this.storage) {
          void this.storage.storeScriptChunkBatch(this.sessionId, this.chunks.get(existing.scriptId) || []);
        }
      }
    }

    logger.debug(`SessionScriptInventory(${this.sessionId}) recorded ${scripts.length} scripts`);
  }

  list(options = {}) {
    const includeSource = options.includeSource === true;
    const maxScripts = typeof options.maxScripts === 'number' ? options.maxScripts : 250;

    return Array.from(this.entries.values())
      .slice(0, maxScripts)
      .map((entry) => ({
        scriptId: entry.scriptId,
        url: entry.url,
        source: includeSource ? entry.source : undefined,
        sourceLength: entry.sourceLength,
      }));
  }

  getScript(options = {}) {
    if (typeof options.scriptId === 'string' && this.entries.has(options.scriptId)) {
      return this.entries.get(options.scriptId);
    }

    if (typeof options.url === 'string') {
      for (const entry of this.entries.values()) {
        if (entry.url.includes(options.url)) {
          return entry;
        }
      }
    }

    return null;
  }

  getChunk(chunkRef) {
    const [scriptId, indexText] = String(chunkRef || '').split(':');
    const chunks = this.chunks.get(scriptId);
    const chunkIndex = Number(indexText);

    if (!chunks || !Number.isFinite(chunkIndex)) {
      return null;
    }

    return chunks[chunkIndex] || null;
  }

  createManifest(budgets = {}) {
    const maxScripts = typeof budgets.maxScripts === 'number' ? budgets.maxScripts : 250;
    const listed = this.list({ includeSource: false, maxScripts });
    const scripts = listed.map((entry) => ({
      scriptId: entry.scriptId,
      url: entry.url,
      sourceLength: entry.sourceLength,
      sourceLoaded: typeof this.entries.get(entry.scriptId)?.source === 'string',
      chunkCount: (this.chunks.get(entry.scriptId) || []).length,
    }));

    return {
      scripts,
      budgets: {
        maxScripts,
        maxBytes: typeof budgets.maxBytes === 'number' ? budgets.maxBytes : 512 * 1024,
        maxRequests: typeof budgets.maxRequests === 'number' ? budgets.maxRequests : 100,
      },
      usage: {
        indexedScripts: Array.from(this.entries.values()).filter((entry) => typeof entry.source === 'string').length,
        chunkCount: Array.from(this.chunks.values()).reduce((sum, chunks) => sum + chunks.length, 0),
      },
    };
  }

  getSiteProfile(currentUrl) {
    const entries = Array.from(this.entries.values());
    const totalScripts = entries.length;
    const inlineScripts = entries.filter((entry) => entry.url.startsWith('inline:') || entry.url.startsWith('dom_script_')).length;
    const externalScripts = totalScripts - inlineScripts;
    const indexedScripts = entries.filter((entry) => typeof entry.source === 'string').length;
    const chunkCount = Array.from(this.chunks.values()).reduce((sum, chunks) => sum + chunks.length, 0);
    const largeScripts = entries.filter((entry) => (entry.sourceLength || 0) > this.CHUNK_SIZE).length;

    let origin;
    try {
      origin = currentUrl ? new URL(currentUrl).origin : undefined;
    } catch {
      origin = undefined;
    }

    return {
      origin,
      totalScripts,
      inlineScripts,
      externalScripts,
      indexedScripts,
      chunkCount,
      largeScripts,
    };
  }

  search(keyword, options = {}) {
    const searchMode = options.searchMode || 'indexed';
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 100;
    const maxBytes = typeof options.maxBytes === 'number' ? options.maxBytes : 24 * 1024;

    let matches = [];
    let resolvedMode = searchMode;

    if (searchMode === 'indexed') {
      matches = this.searchIndexed(keyword, maxResults);
      if (matches.length === 0) {
        matches = this.searchByScan(keyword, { maxResults });
        resolvedMode = 'indexed';
      }
    } else if (searchMode === 'regex') {
      matches = this.searchByScan(keyword, {
        maxResults,
        regex: true,
      });
    } else {
      matches = this.searchByScan(keyword, { maxResults });
    }

    let truncated = false;
    let size = 0;
    const normalizedMatches = [];

    for (const match of matches) {
      const withChunk = {
        ...match,
        chunkRef: match.chunkRef || `${match.scriptId}:0`,
      };
      const serialized = JSON.stringify(withChunk);
      size += serialized.length;

      if (size > maxBytes) {
        truncated = true;
        normalizedMatches.push({
          scriptId: withChunk.scriptId,
          url: withChunk.url,
          line: withChunk.line,
          column: withChunk.column,
          matchText: withChunk.matchText,
          chunkRef: withChunk.chunkRef,
        });
      } else {
        normalizedMatches.push(withChunk);
      }

      if (normalizedMatches.length >= maxResults) {
        break;
      }
    }

    return {
      keyword,
      searchMode: resolvedMode,
      totalMatches: matches.length,
      truncated,
      matches: normalizedMatches,
    };
  }

  indexScript(entry) {
    this.chunkScript(entry.scriptId, entry.url, entry.source);
    const lines = entry.source.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }

      const terms = new Set(
        line
          .split(/[^A-Za-z0-9_$]+/)
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean)
      );

      for (const term of terms) {
        if (!this.keywordIndex.has(term)) {
          this.keywordIndex.set(term, []);
        }

        this.keywordIndex.get(term).push({
          scriptId: entry.scriptId,
          url: entry.url,
          line: lineIndex + 1,
          column: line.toLowerCase().indexOf(term),
          matchText: term,
          context: line,
          chunkRef: `${entry.scriptId}:${this.resolveChunkIndex(entry.source, lineIndex)}`,
        });
      }
    }
  }

  resolveChunkIndex(source, lineIndex) {
    const prefix = source.split('\n').slice(0, lineIndex + 1).join('\n');
    return Math.floor(prefix.length / this.CHUNK_SIZE);
  }

  chunkScript(scriptId, url, source) {
    const chunks = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < source.length) {
      const content = source.substring(offset, offset + this.CHUNK_SIZE);
      chunks.push({
        scriptId,
        url,
        chunkIndex,
        chunkRef: `${scriptId}:${chunkIndex}`,
        content,
        size: content.length,
      });
      offset += this.CHUNK_SIZE;
      chunkIndex += 1;
    }

    this.chunks.set(scriptId, chunks);
  }

  searchIndexed(keyword, maxResults) {
    const searchTerm = String(keyword || '').toLowerCase();
    const matches = [];

    for (const [indexedKeyword, entries] of this.keywordIndex.entries()) {
      if (!indexedKeyword.includes(searchTerm)) {
        continue;
      }

      for (const entry of entries) {
        matches.push(entry);
        if (matches.length >= maxResults) {
          return matches;
        }
      }
    }

    return matches;
  }

  searchByScan(keyword, options = {}) {
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 100;
    const regex = options.regex === true
      ? new RegExp(keyword, 'gi')
      : new RegExp(String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    const matches = [];

    for (const entry of this.entries.values()) {
      if (typeof entry.source !== 'string') {
        continue;
      }

      const lines = entry.source.split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line) {
          continue;
        }

        const found = Array.from(line.matchAll(regex));
        for (const match of found) {
          matches.push({
            scriptId: entry.scriptId,
            url: entry.url,
            line: lineIndex + 1,
            column: match.index || 0,
            matchText: match[0],
            context: line,
            chunkRef: `${entry.scriptId}:${Math.floor(entry.source.indexOf(line) / this.CHUNK_SIZE)}`,
          });

          if (matches.length >= maxResults) {
            return matches;
          }
        }
      }
    }

    return matches;
  }
}
