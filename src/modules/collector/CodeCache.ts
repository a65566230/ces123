// @ts-nocheck

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
export class CodeCache {
    cacheDir;
    maxAge;
    maxSize;
    memoryCache = new Map();
    MAX_MEMORY_CACHE_SIZE = 100;
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(process.cwd(), '.cache', 'code');
        this.maxAge = options.maxAge || 24 * 60 * 60 * 1000;
        this.maxSize = options.maxSize || 100 * 1024 * 1024;
    }
    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            logger.debug(`Cache directory initialized: ${this.cacheDir}`);
        }
        catch (error) {
            logger.error('Failed to initialize cache directory:', error);
        }
    }
    generateKey(url, options) {
        const data = JSON.stringify({ url, options });
        return crypto.createHash('md5').update(data).digest('hex');
    }
    getCachePath(key) {
        return path.join(this.cacheDir, `${key}.json`);
    }
    isExpired(entry) {
        return Date.now() - entry.timestamp > this.maxAge;
    }
    async get(url, options) {
        const key = this.generateKey(url, options);
        if (this.memoryCache.has(key)) {
            const entry = this.memoryCache.get(key);
            if (!this.isExpired(entry)) {
                logger.debug(`Cache hit (memory): ${url}`);
                return {
                    files: entry.files,
                    dependencies: { nodes: [], edges: [] },
                    totalSize: entry.totalSize,
                    collectTime: entry.collectTime,
                };
            }
            else {
                this.memoryCache.delete(key);
            }
        }
        try {
            const cachePath = this.getCachePath(key);
            const data = await fs.readFile(cachePath, 'utf-8');
            const entry = JSON.parse(data);
            if (this.isExpired(entry)) {
                logger.debug(`Cache expired: ${url}`);
                await fs.unlink(cachePath);
                return null;
            }
            this.memoryCache.set(key, entry);
            logger.debug(`Cache hit (disk): ${url}`);
            return {
                files: entry.files,
                dependencies: { nodes: [], edges: [] },
                totalSize: entry.totalSize,
                collectTime: entry.collectTime,
            };
        }
        catch (error) {
            return null;
        }
    }
    async set(url, result, options) {
        const key = this.generateKey(url, options);
        const hash = crypto.createHash('md5').update(JSON.stringify(result.files)).digest('hex');
        const entry = {
            url,
            files: result.files,
            totalSize: result.totalSize,
            collectTime: result.collectTime,
            timestamp: Date.now(),
            hash,
        };
        this.memoryCache.set(key, entry);
        if (this.memoryCache.size > this.MAX_MEMORY_CACHE_SIZE) {
            const firstKey = this.memoryCache.keys().next().value;
            if (firstKey) {
                this.memoryCache.delete(firstKey);
                logger.debug(`Memory cache evicted: ${firstKey}`);
            }
        }
        try {
            const cachePath = this.getCachePath(key);
            await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
            logger.debug(`Cache saved: ${url} (${(result.totalSize / 1024).toFixed(2)} KB)`);
        }
        catch (error) {
            logger.error('Failed to save cache:', error);
        }
        await this.cleanup();
    }
    async cleanup() {
        try {
            const files = await fs.readdir(this.cacheDir);
            let totalSize = 0;
            const entries = [];
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
                entries.push({
                    file: filePath,
                    mtime: stats.mtime,
                    size: stats.size,
                });
            }
            if (totalSize > this.maxSize) {
                entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
                let removedSize = 0;
                for (const entry of entries) {
                    if (totalSize - removedSize <= this.maxSize * 0.8)
                        break;
                    await fs.unlink(entry.file);
                    removedSize += entry.size;
                    logger.debug(`Removed old cache: ${entry.file}`);
                }
                logger.info(`Cache cleanup: removed ${removedSize} bytes`);
            }
        }
        catch (error) {
            logger.error('Failed to cleanup cache:', error);
        }
    }
    async clear() {
        try {
            this.memoryCache.clear();
            const files = await fs.readdir(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    await fs.unlink(path.join(this.cacheDir, file));
                }
            }
            logger.info('All cache cleared');
        }
        catch (error) {
            logger.error('Failed to clear cache:', error);
        }
    }
    async getStats() {
        try {
            const files = await fs.readdir(this.cacheDir);
            let totalSize = 0;
            let diskEntries = 0;
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
                diskEntries++;
            }
            return {
                memoryEntries: this.memoryCache.size,
                diskEntries,
                totalSize,
            };
        }
        catch (error) {
            logger.error('Failed to get cache stats:', error);
            return {
                memoryEntries: this.memoryCache.size,
                diskEntries: 0,
                totalSize: 0,
            };
        }
    }
    async warmup(urls) {
        logger.info(`Warming up cache for ${urls.length} URLs...`);
        for (const url of urls) {
            await this.get(url);
        }
        logger.info('Cache warmup completed');
    }
}
//# sourceMappingURL=CodeCache.js.map