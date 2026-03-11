// @ts-nocheck

import { logger } from './logger.js';
export class DetailedDataManager {
    static instance;
    cache = new Map();
    cleanupTimer;
    DEFAULT_TTL = 30 * 60 * 1000;
    MAX_TTL = 60 * 60 * 1000;
    MAX_CACHE_SIZE = 100;
    AUTO_EXTEND_ON_ACCESS = true;
    EXTEND_DURATION = 15 * 60 * 1000;
    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        this.cleanupTimer.unref?.();
    }
    static getInstance() {
        if (!this.instance) {
            this.instance = new DetailedDataManager();
        }
        return this.instance;
    }
    smartHandle(data, threshold = 50 * 1024) {
        const jsonStr = JSON.stringify(data);
        const size = jsonStr.length;
        if (size <= threshold) {
            return data;
        }
        logger.info(`Data too large (${(size / 1024).toFixed(1)}KB), returning summary with detailId`);
        return this.createDetailedResponse(data);
    }
    createDetailedResponse(data) {
        const detailId = this.store(data);
        const summary = this.generateSummary(data);
        return {
            summary,
            detailId,
            hint: `⚠️ Data too large. Use get_detailed_data("${detailId}") to retrieve full data, or get_detailed_data("${detailId}", path="key.subkey") for specific part.`,
            expiresAt: Date.now() + this.DEFAULT_TTL,
        };
    }
    store(data, customTTL) {
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            this.evictLRU();
        }
        const detailId = `detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();
        const ttl = customTTL || this.DEFAULT_TTL;
        const expiresAt = now + ttl;
        const size = JSON.stringify(data).length;
        const entry = {
            data,
            expiresAt,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            size,
        };
        this.cache.set(detailId, entry);
        logger.debug(`Stored detailed data: ${detailId}, size: ${(size / 1024).toFixed(1)}KB, expires in ${ttl / 1000}s`);
        return detailId;
    }
    retrieve(detailId, path) {
        const cached = this.cache.get(detailId);
        if (!cached) {
            throw new Error(`DetailId not found or expired: ${detailId}`);
        }
        const now = Date.now();
        if (now > cached.expiresAt) {
            this.cache.delete(detailId);
            throw new Error(`DetailId expired: ${detailId}`);
        }
        cached.lastAccessedAt = now;
        cached.accessCount++;
        if (this.AUTO_EXTEND_ON_ACCESS) {
            const remainingTime = cached.expiresAt - now;
            if (remainingTime < 5 * 60 * 1000) {
                cached.expiresAt = Math.min(now + this.EXTEND_DURATION, now + this.MAX_TTL);
                logger.debug(`Auto-extended detailId ${detailId}, new expiry: ${new Date(cached.expiresAt).toISOString()}`);
            }
        }
        if (path) {
            return this.getByPath(cached.data, path);
        }
        return cached.data;
    }
    getByPath(obj, path) {
        const keys = path.split('.');
        let current = obj;
        for (const key of keys) {
            if (current === null || current === undefined) {
                throw new Error(`Path not found: ${path} (stopped at ${key})`);
            }
            current = current[key];
        }
        return current;
    }
    generateSummary(data) {
        const jsonStr = JSON.stringify(data);
        const size = jsonStr.length;
        const type = Array.isArray(data) ? 'array' : typeof data;
        const summary = {
            type,
            size,
            sizeKB: (size / 1024).toFixed(1) + 'KB',
            preview: jsonStr.substring(0, 200) + (size > 200 ? '...' : ''),
        };
        if (typeof data === 'object' && data !== null) {
            const keys = Object.keys(data);
            summary.structure = {
                keys: keys.slice(0, 50),
            };
            if (!Array.isArray(data)) {
                const methods = keys.filter((k) => typeof data[k] === 'function');
                const properties = keys.filter((k) => typeof data[k] !== 'function');
                summary.structure.methods = methods.slice(0, 30);
                summary.structure.properties = properties.slice(0, 30);
            }
            else {
                summary.structure.length = data.length;
            }
        }
        return summary;
    }
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [id, cached] of this.cache.entries()) {
            if (now > cached.expiresAt) {
                this.cache.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.debug(`Cleaned ${cleaned} expired detailed data entries`);
        }
    }
    evictLRU() {
        if (this.cache.size === 0)
            return;
        let oldestId = null;
        let oldestAccessTime = Infinity;
        for (const [id, entry] of this.cache.entries()) {
            if (entry.lastAccessedAt < oldestAccessTime) {
                oldestAccessTime = entry.lastAccessedAt;
                oldestId = id;
            }
        }
        if (oldestId) {
            const entry = this.cache.get(oldestId);
            this.cache.delete(oldestId);
            logger.info(`Evicted LRU entry: ${oldestId}, last accessed: ${new Date(entry.lastAccessedAt).toISOString()}, access count: ${entry.accessCount}`);
        }
    }
    extend(detailId, additionalTime) {
        const cached = this.cache.get(detailId);
        if (!cached) {
            throw new Error(`DetailId not found: ${detailId}`);
        }
        const now = Date.now();
        if (now > cached.expiresAt) {
            throw new Error(`DetailId already expired: ${detailId}`);
        }
        const extendBy = additionalTime || this.EXTEND_DURATION;
        const newExpiresAt = Math.min(cached.expiresAt + extendBy, now + this.MAX_TTL);
        cached.expiresAt = newExpiresAt;
        logger.info(`Extended detailId ${detailId} by ${extendBy / 1000}s, new expiry: ${new Date(newExpiresAt).toISOString()}`);
    }
    getStats() {
        let totalSize = 0;
        let totalAccessCount = 0;
        const entries = Array.from(this.cache.values());
        for (const entry of entries) {
            totalSize += entry.size;
            totalAccessCount += entry.accessCount;
        }
        return {
            cacheSize: this.cache.size,
            maxCacheSize: this.MAX_CACHE_SIZE,
            defaultTTLSeconds: this.DEFAULT_TTL / 1000,
            maxTTLSeconds: this.MAX_TTL / 1000,
            totalSizeKB: (totalSize / 1024).toFixed(1),
            avgAccessCount: entries.length > 0 ? (totalAccessCount / entries.length).toFixed(1) : '0',
            autoExtendEnabled: this.AUTO_EXTEND_ON_ACCESS,
            extendDurationSeconds: this.EXTEND_DURATION / 1000,
        };
    }
    getDetailedStats() {
        const now = Date.now();
        const entries = Array.from(this.cache.entries()).map(([id, entry]) => ({
            detailId: id,
            sizeKB: (entry.size / 1024).toFixed(1),
            createdAt: new Date(entry.createdAt).toISOString(),
            lastAccessedAt: new Date(entry.lastAccessedAt).toISOString(),
            expiresAt: new Date(entry.expiresAt).toISOString(),
            remainingSeconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
            accessCount: entry.accessCount,
            isExpired: now > entry.expiresAt,
        }));
        entries.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());
        return entries;
    }
    clear() {
        this.cache.clear();
        logger.info('Cleared all detailed data cache');
    }
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
}
//# sourceMappingURL=detailedDataManager.js.map
