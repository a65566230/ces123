// @ts-nocheck

export class DetailedDataManagerAdapter {
    manager;
    name = 'DetailedDataManager';
    constructor(manager) {
        this.manager = manager;
    }
    getStats() {
        const stats = this.manager.getStats();
        return {
            entries: stats.cacheSize,
            size: this.estimateSize(stats.cacheSize),
            hits: 0,
            misses: 0,
            ttl: stats.defaultTTLSeconds * 1000,
            maxSize: stats.maxCacheSize,
        };
    }
    clear() {
        this.manager.clear();
    }
    estimateSize(entries) {
        return entries * 50 * 1024;
    }
}
export class CodeCacheAdapter {
    cache;
    name = 'CodeCache';
    constructor(cache) {
        this.cache = cache;
    }
    async getStats() {
        const stats = await this.cache.getStats();
        return {
            entries: stats.memoryEntries + stats.diskEntries,
            size: stats.totalSize,
            hits: 0,
            misses: 0,
        };
    }
    async cleanup() {
        await this.cache.cleanup();
    }
    async clear() {
        await this.cache.clear();
    }
}
export class CodeCompressorAdapter {
    compressor;
    name = 'CodeCompressor';
    constructor(compressor) {
        this.compressor = compressor;
    }
    getStats() {
        const stats = this.compressor.getStats();
        const cacheSize = this.compressor.getCacheSize();
        const total = stats.cacheHits + stats.cacheMisses;
        const hitRate = total > 0 ? stats.cacheHits / total : 0;
        return {
            entries: cacheSize,
            size: this.estimateSize(cacheSize, stats.totalCompressedSize),
            hits: stats.cacheHits,
            misses: stats.cacheMisses,
            hitRate,
        };
    }
    clear() {
        this.compressor.clearCache();
    }
    estimateSize(entries, totalCompressed) {
        if (entries === 0)
            return 0;
        const avgSize = totalCompressed / Math.max(1, entries);
        return entries * avgSize;
    }
}
export function createCacheAdapters(detailedDataManager, codeCache, codeCompressor) {
    return [
        new DetailedDataManagerAdapter(detailedDataManager),
        new CodeCacheAdapter(codeCache),
        new CodeCompressorAdapter(codeCompressor),
    ];
}
//# sourceMappingURL=CacheAdapters.js.map