// @ts-nocheck

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from './logger.js';
export class CacheManager {
    config;
    constructor(config) {
        this.config = config;
    }
    async init() {
        if (!this.config.enabled) {
            return;
        }
        try {
            await fs.mkdir(this.config.dir, { recursive: true });
            logger.debug(`Cache directory initialized: ${this.config.dir}`);
        }
        catch (error) {
            logger.error('Failed to initialize cache directory', error);
        }
    }
    generateKey(key) {
        return createHash('md5').update(key).digest('hex');
    }
    getCachePath(key) {
        const hashedKey = this.generateKey(key);
        return join(this.config.dir, `${hashedKey}.json`);
    }
    async get(key) {
        if (!this.config.enabled) {
            return null;
        }
        try {
            const cachePath = this.getCachePath(key);
            const data = await fs.readFile(cachePath, 'utf-8');
            const cached = JSON.parse(data);
            if (Date.now() - cached.timestamp > this.config.ttl * 1000) {
                await this.delete(key);
                return null;
            }
            logger.debug(`Cache hit: ${key}`);
            return cached.value;
        }
        catch (error) {
            logger.debug(`Cache miss: ${key}`);
            return null;
        }
    }
    async set(key, value) {
        if (!this.config.enabled) {
            return;
        }
        try {
            const cachePath = this.getCachePath(key);
            const data = {
                timestamp: Date.now(),
                value,
            };
            await fs.writeFile(cachePath, JSON.stringify(data), 'utf-8');
            logger.debug(`Cache set: ${key}`);
        }
        catch (error) {
            logger.error('Failed to set cache', error);
        }
    }
    async delete(key) {
        if (!this.config.enabled) {
            return;
        }
        try {
            const cachePath = this.getCachePath(key);
            await fs.unlink(cachePath);
            logger.debug(`Cache deleted: ${key}`);
        }
        catch (error) {
        }
    }
    async clear() {
        if (!this.config.enabled) {
            return;
        }
        try {
            const files = await fs.readdir(this.config.dir);
            await Promise.all(files.map((file) => fs.unlink(join(this.config.dir, file))));
            logger.info('Cache cleared');
        }
        catch (error) {
            logger.error('Failed to clear cache', error);
        }
    }
}
//# sourceMappingURL=cache.js.map