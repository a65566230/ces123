// @ts-nocheck

import { logger } from './logger.js';
export async function parallelExecute(items, executor, options = {}) {
    const { maxConcurrency = 3, timeout = 60000, retryOnError = false, maxRetries = 2, } = options;
    const results = [];
    const executing = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === undefined)
            continue;
        const task = (async () => {
            const startTime = Date.now();
            let lastError;
            for (let attempt = 0; attempt <= (retryOnError ? maxRetries : 0); attempt++) {
                try {
                    const result = await Promise.race([
                        executor(item, i),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Task timeout')), timeout)),
                    ]);
                    results[i] = {
                        success: true,
                        data: result,
                        duration: Date.now() - startTime,
                    };
                    return;
                }
                catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    if (attempt < (retryOnError ? maxRetries : 0)) {
                        logger.warn(`Task ${i} failed, retrying (${attempt + 1}/${maxRetries})...`);
                        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
                    }
                }
            }
            results[i] = {
                success: false,
                error: lastError,
                duration: Date.now() - startTime,
            };
        })();
        executing.push(task);
        if (executing.length >= maxConcurrency) {
            await Promise.race(executing);
            executing.splice(executing.findIndex((p) => p === task), 1);
        }
    }
    await Promise.all(executing);
    return results;
}
export async function batchProcess(items, executor, batchSize = 10) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);
        try {
            const batchResults = await executor(batch);
            results.push(...batchResults);
        }
        catch (error) {
            logger.error(`Batch processing failed at index ${i}`, error);
            throw error;
        }
    }
    return results;
}
export class TaskQueue {
    queue = [];
    running = 0;
    maxConcurrency;
    executor;
    constructor(executor, maxConcurrency = 3) {
        this.executor = executor;
        this.maxConcurrency = maxConcurrency;
    }
    async add(item) {
        return new Promise((resolve, reject) => {
            this.queue.push({ item, resolve, reject });
            this.process();
        });
    }
    async process() {
        if (this.running >= this.maxConcurrency || this.queue.length === 0) {
            return;
        }
        const task = this.queue.shift();
        if (!task)
            return;
        this.running++;
        try {
            const result = await this.executor(task.item);
            task.resolve(result);
        }
        catch (error) {
            task.reject(error instanceof Error ? error : new Error(String(error)));
        }
        finally {
            this.running--;
            this.process();
        }
    }
    getStatus() {
        return {
            queueLength: this.queue.length,
            running: this.running,
            maxConcurrency: this.maxConcurrency,
        };
    }
    clear() {
        this.queue.forEach((task) => {
            task.reject(new Error('Queue cleared'));
        });
        this.queue = [];
    }
}
export class RateLimiter {
    tokens;
    maxTokens;
    refillRate;
    lastRefill;
    constructor(maxTokens, refillRate) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRate = refillRate;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    async acquire(tokens = 1) {
        while (true) {
            this.refill();
            if (this.tokens >= tokens) {
                this.tokens -= tokens;
                return;
            }
            const waitTime = ((tokens - this.tokens) / this.refillRate) * 1000;
            await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 1000)));
        }
    }
    getTokens() {
        this.refill();
        return this.tokens;
    }
}
//# sourceMappingURL=parallel.js.map