// @ts-nocheck

import { logger } from '../../../utils/logger.js';

export class SessionScriptInventory {
  sessionId;
  storage;
  entries = new Map();
  urlToScriptId = new Map();
  scriptIdAliases = new Map();
  keywordIndex = new Map();
  chunks = new Map();
  CHUNK_SIZE = 100 * 1024;
  MAX_INDEXABLE_SOURCE_BYTES = 2 * 1024 * 1024;
  MAX_INDEXABLE_LINE_LENGTH = 4 * 1024;
  MAX_CONTEXT_CHARS = 240;
  MAX_TERMS_PER_SCRIPT = 10_000;

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
      const canonicalScriptId = this.resolveCanonicalScriptId(script.scriptId, normalizedUrl);
      const existing = this.entries.get(canonicalScriptId) || {
        scriptId: canonicalScriptId,
        url: normalizedUrl,
      };
      const previousSource = existing.source;

      existing.url = normalizedUrl;
      existing.sourceLength = script.sourceLength ?? script.source?.length ?? existing.sourceLength;

      if (typeof script.source === 'string') {
        existing.source = script.source;
        existing.sourceLoadedAt = new Date().toISOString();
      }

      this.entries.set(canonicalScriptId, existing);
      this.scriptIdAliases.set(script.scriptId, canonicalScriptId);
      if (this.shouldDedupeByUrl(normalizedUrl)) {
        this.urlToScriptId.set(normalizedUrl, canonicalScriptId);
      }

      const sourceChanged = typeof script.source === 'string' && script.source !== previousSource;
      if (typeof existing.source === 'string' && indexPolicy !== 'metadata-only' && sourceChanged) {
        this.indexScript(existing, { indexPolicy });
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
    if (typeof options.scriptId === 'string') {
      const canonicalScriptId = this.scriptIdAliases.get(options.scriptId) || options.scriptId;
      if (this.entries.has(canonicalScriptId)) {
        return this.entries.get(canonicalScriptId);
      }
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

  indexScript(entry, options = {}) {
    this.chunkScript(entry.scriptId, entry.url, entry.source);
    if (!this.shouldBuildKeywordIndex(entry, options.indexPolicy)) {
      return;
    }

    const lines = entry.source.split('\n');
    let indexedTerms = 0;
    let runningOffset = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const chunkRef = `${entry.scriptId}:${Math.floor(runningOffset / this.CHUNK_SIZE)}`;
      if (!line) {
        runningOffset += 1;
        continue;
      }

      if (line.length > this.MAX_INDEXABLE_LINE_LENGTH) {
        runningOffset += line.length + 1;
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

        const column = line.toLowerCase().indexOf(term);
        this.keywordIndex.get(term).push({
          scriptId: entry.scriptId,
          url: entry.url,
          line: lineIndex + 1,
          column,
          matchText: term,
          context: this.buildContextSnippet(line, column),
          chunkRef,
        });
        indexedTerms += 1;
        if (indexedTerms >= this.MAX_TERMS_PER_SCRIPT) {
          break;
        }
      }

      runningOffset += line.length + 1;
      if (indexedTerms >= this.MAX_TERMS_PER_SCRIPT) {
        break;
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
      let runningOffset = 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const chunkRef = `${entry.scriptId}:${Math.floor(runningOffset / this.CHUNK_SIZE)}`;
        if (!line) {
          runningOffset += 1;
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
            context: this.buildContextSnippet(line, match.index || 0),
            chunkRef,
          });

          if (matches.length >= maxResults) {
            return matches;
          }
        }

        runningOffset += line.length + 1;
      }
    }

    return matches;
  }

  shouldBuildKeywordIndex(entry, indexPolicy) {
    if (indexPolicy === 'metadata-only') {
      return false;
    }

    return (entry?.source?.length || 0) <= this.MAX_INDEXABLE_SOURCE_BYTES;
  }

  buildContextSnippet(line, column = 0) {
    if (line.length <= this.MAX_CONTEXT_CHARS) {
      return line;
    }

    const halfWindow = Math.floor(this.MAX_CONTEXT_CHARS / 2);
    const start = Math.max(0, column - halfWindow);
    const end = Math.min(line.length, start + this.MAX_CONTEXT_CHARS);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < line.length ? '...' : '';
    return `${prefix}${line.slice(start, end)}${suffix}`;
  }

  resolveCanonicalScriptId(scriptId, normalizedUrl) {
    if (!this.shouldDedupeByUrl(normalizedUrl)) {
      return this.scriptIdAliases.get(scriptId) || scriptId;
    }

    return this.urlToScriptId.get(normalizedUrl) || this.scriptIdAliases.get(scriptId) || scriptId;
  }

  shouldDedupeByUrl(normalizedUrl) {
    return !normalizedUrl.startsWith('inline:') && !normalizedUrl.startsWith('dom_script_');
  }
}
