// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class WatchExpressionManager {
    runtimeInspector;
    watches = new Map();
    watchCounter = 0;
    constructor(runtimeInspector) {
        this.runtimeInspector = runtimeInspector;
    }
    addWatch(expression, name) {
        const watchId = `watch_${++this.watchCounter}`;
        this.watches.set(watchId, {
            id: watchId,
            expression,
            name: name || expression,
            enabled: true,
            lastValue: undefined,
            lastError: null,
            valueHistory: [],
            createdAt: Date.now(),
        });
        logger.info(`Watch expression added: ${watchId}`, { expression, name });
        return watchId;
    }
    removeWatch(watchId) {
        const deleted = this.watches.delete(watchId);
        if (deleted) {
            logger.info(`Watch expression removed: ${watchId}`);
        }
        return deleted;
    }
    setWatchEnabled(watchId, enabled) {
        const watch = this.watches.get(watchId);
        if (!watch)
            return false;
        watch.enabled = enabled;
        logger.info(`Watch expression ${enabled ? 'enabled' : 'disabled'}: ${watchId}`);
        return true;
    }
    getAllWatches() {
        return Array.from(this.watches.values());
    }
    getWatch(watchId) {
        return this.watches.get(watchId);
    }
    async evaluateAll(callFrameId, timeout = 5000) {
        const results = [];
        for (const watch of this.watches.values()) {
            if (!watch.enabled)
                continue;
            try {
                const value = await Promise.race([
                    this.runtimeInspector.evaluate(watch.expression, callFrameId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error(`Evaluation timeout after ${timeout}ms`)), timeout)),
                ]);
                const valueChanged = !this.deepEqual(value, watch.lastValue);
                if (valueChanged) {
                    watch.valueHistory.push({
                        value,
                        timestamp: Date.now(),
                    });
                    if (watch.valueHistory.length > 100) {
                        watch.valueHistory.shift();
                    }
                }
                watch.lastValue = value;
                watch.lastError = null;
                results.push({
                    watchId: watch.id,
                    name: watch.name,
                    expression: watch.expression,
                    value,
                    error: null,
                    valueChanged,
                    timestamp: Date.now(),
                });
            }
            catch (error) {
                watch.lastError = error;
                results.push({
                    watchId: watch.id,
                    name: watch.name,
                    expression: watch.expression,
                    value: null,
                    error: error,
                    valueChanged: false,
                    timestamp: Date.now(),
                });
            }
        }
        return results;
    }
    clearAll() {
        this.watches.clear();
        logger.info('All watch expressions cleared');
    }
    getValueHistory(watchId) {
        const watch = this.watches.get(watchId);
        return watch ? watch.valueHistory : null;
    }
    deepEqual(a, b) {
        if (a === b)
            return true;
        if (a == null || b == null)
            return false;
        if (typeof a !== 'object' || typeof b !== 'object')
            return false;
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length)
            return false;
        for (const key of keysA) {
            if (!keysB.includes(key))
                return false;
            if (!this.deepEqual(a[key], b[key]))
                return false;
        }
        return true;
    }
    exportWatches() {
        return Array.from(this.watches.values()).map(watch => ({
            expression: watch.expression,
            name: watch.name,
            enabled: watch.enabled,
        }));
    }
    importWatches(watches) {
        for (const watch of watches) {
            const watchId = this.addWatch(watch.expression, watch.name);
            if (watch.enabled === false) {
                this.setWatchEnabled(watchId, false);
            }
        }
        logger.info(`Imported ${watches.length} watch expressions`);
    }
}
//# sourceMappingURL=WatchExpressionManager.js.map