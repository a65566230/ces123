// @ts-nocheck

function extractSourceMapUrl(source) {
  const match = String(source || '').match(/[#@]\s*sourceMappingURL=([^\s]+)/);
  return match?.[1];
}

function decodeInlineSourceMap(dataUrl) {
  const [header, payload] = String(dataUrl).split(',', 2);
  if (!header || !payload) {
    throw new Error('Invalid inline source map');
  }

  if (header.includes(';base64')) {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
  }

  return JSON.parse(decodeURIComponent(payload));
}

export class SourceMapAnalyzer {
  public async analyze(source, scriptUrl) {
    const sourceMapRef = extractSourceMapUrl(source);
    if (!sourceMapRef) {
      return {
        hasSourceMap: false,
        sourceMapUrl: null,
        version: null,
        sources: [],
        names: [],
      };
    }

    try {
      const sourceMap = sourceMapRef.startsWith('data:')
        ? decodeInlineSourceMap(sourceMapRef)
        : await this.fetchExternalMap(sourceMapRef, scriptUrl);

      return {
        hasSourceMap: true,
        sourceMapUrl: sourceMapRef.startsWith('data:')
          ? 'inline'
          : new URL(sourceMapRef, scriptUrl).toString(),
        version: sourceMap.version ?? null,
        file: sourceMap.file ?? null,
        sources: Array.isArray(sourceMap.sources) ? sourceMap.sources : [],
        names: Array.isArray(sourceMap.names) ? sourceMap.names : [],
      };
    } catch (error) {
      return {
        hasSourceMap: false,
        sourceMapUrl: sourceMapRef,
        version: null,
        sources: [],
        names: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async fetchExternalMap(sourceMapRef, scriptUrl) {
    if (!scriptUrl) {
      throw new Error('scriptUrl is required to resolve an external source map');
    }

    const response = await fetch(new URL(sourceMapRef, scriptUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch source map: ${response.status}`);
    }

    return response.json();
  }
}
