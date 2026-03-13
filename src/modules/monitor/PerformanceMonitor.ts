// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { createCDPSessionForPage } from '../../utils/playwrightCompat.js';
export class PerformanceMonitor {
    collector;
    cdpSession = null;
    coverageEnabled = false;
    profilerEnabled = false;
    coverageStartedAt = null;
    lastCoverage = null;
    lastCoverageCollectedAt = null;
    constructor(collector) {
        this.collector = collector;
    }
    getCoverageState() {
        return {
            active: this.coverageEnabled,
            startedAt: this.coverageStartedAt,
            collectedAt: this.lastCoverageCollectedAt,
            hasCoverageResult: Array.isArray(this.lastCoverage) && this.lastCoverage.length > 0,
            totalScripts: Array.isArray(this.lastCoverage) ? this.lastCoverage.length : 0,
        };
    }
    getLastCoverage() {
        return Array.isArray(this.lastCoverage) ? this.lastCoverage : [];
    }
    async ensureCDPSession() {
        if (!this.cdpSession) {
            const page = await this.collector.getActivePage();
            this.cdpSession = await createCDPSessionForPage(page);
        }
        return this.cdpSession;
    }
    async getPerformanceMetrics() {
        const page = await this.collector.getActivePage();
        const metrics = await page.evaluate(() => {
            const result = {};
            const navTiming = performance.getEntriesByType('navigation')[0];
            if (navTiming) {
                result.domContentLoaded = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
                result.loadComplete = navTiming.loadEventEnd - navTiming.fetchStart;
                result.ttfb = navTiming.responseStart - navTiming.requestStart;
            }
            const paintEntries = performance.getEntriesByType('paint');
            const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
            if (fcpEntry) {
                result.fcp = fcpEntry.startTime;
            }
            const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
            if (lcpEntries.length > 0) {
                const lastLCP = lcpEntries[lcpEntries.length - 1];
                result.lcp = lastLCP.renderTime || lastLCP.loadTime;
            }
            let clsValue = 0;
            const layoutShiftEntries = performance.getEntriesByType('layout-shift');
            for (const entry of layoutShiftEntries) {
                if (!entry.hadRecentInput) {
                    clsValue += entry.value;
                }
            }
            result.cls = clsValue;
            if (performance.memory) {
                const memory = performance.memory;
                result.jsHeapSizeLimit = memory.jsHeapSizeLimit;
                result.totalJSHeapSize = memory.totalJSHeapSize;
                result.usedJSHeapSize = memory.usedJSHeapSize;
            }
            return result;
        });
        logger.info('Performance metrics collected', {
            fcp: metrics.fcp,
            lcp: metrics.lcp,
            cls: metrics.cls,
        });
        return metrics;
    }
    async getPerformanceTimeline() {
        const page = await this.collector.getActivePage();
        const timeline = await page.evaluate(() => {
            return performance.getEntries().map(entry => ({
                name: entry.name,
                entryType: entry.entryType,
                startTime: entry.startTime,
                duration: entry.duration,
            }));
        });
        logger.info(`Performance timeline collected: ${timeline.length} entries`);
        return timeline;
    }
    async startCoverage(options) {
        if (this.coverageEnabled) {
            logger.warn('Code coverage collection already started');
            return this.getCoverageState();
        }
        const cdp = await this.ensureCDPSession();
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.startPreciseCoverage', {
            callCount: true,
            detailed: true,
            allowTriggeredUpdates: false,
            ...options,
        });
        this.coverageEnabled = true;
        this.coverageStartedAt = new Date().toISOString();
        this.lastCoverage = null;
        this.lastCoverageCollectedAt = null;
        logger.info('Code coverage collection started');
        return this.getCoverageState();
    }
    async stopCoverage() {
        if (!this.coverageEnabled) {
            throw new Error('Coverage not enabled. Call startCoverage() first.');
        }
        const cdp = await this.ensureCDPSession();
        const { result } = await cdp.send('Profiler.takePreciseCoverage');
        await cdp.send('Profiler.stopPreciseCoverage');
        await cdp.send('Profiler.disable');
        this.coverageEnabled = false;
        const coverageInfo = result.map((entry) => {
            const totalBytes = entry.functions.reduce((sum, func) => {
                return sum + func.ranges.reduce((rangeSum, range) => {
                    return rangeSum + (range.endOffset - range.startOffset);
                }, 0);
            }, 0);
            const usedBytes = entry.functions.reduce((sum, func) => {
                return sum + func.ranges.reduce((rangeSum, range) => {
                    return range.count > 0 ? rangeSum + (range.endOffset - range.startOffset) : rangeSum;
                }, 0);
            }, 0);
            return {
                url: entry.url,
                ranges: entry.functions.flatMap((func) => func.ranges.map((range) => ({
                    start: range.startOffset,
                    end: range.endOffset,
                    count: range.count,
                }))),
                totalBytes,
                usedBytes,
                coveragePercentage: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
            };
        });
        this.lastCoverage = coverageInfo;
        this.lastCoverageCollectedAt = new Date().toISOString();
        logger.success(`Code coverage collected: ${coverageInfo.length} scripts`, {
            totalScripts: coverageInfo.length,
            avgCoverage: coverageInfo.length > 0
                ? coverageInfo.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverageInfo.length
                : 0,
        });
        return coverageInfo;
    }
    async startCPUProfiling() {
        const cdp = await this.ensureCDPSession();
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        this.profilerEnabled = true;
        logger.info('CPU profiling started');
    }
    async stopCPUProfiling() {
        if (!this.profilerEnabled) {
            throw new Error('CPU profiling not enabled. Call startCPUProfiling() first.');
        }
        const cdp = await this.ensureCDPSession();
        const { profile } = await cdp.send('Profiler.stop');
        await cdp.send('Profiler.disable');
        this.profilerEnabled = false;
        logger.success('CPU profiling stopped', {
            nodes: profile.nodes.length,
            samples: profile.samples?.length || 0,
        });
        return profile;
    }
    async takeHeapSnapshot() {
        const cdp = await this.ensureCDPSession();
        await cdp.send('HeapProfiler.enable');
        let snapshotData = '';
        cdp.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
            snapshotData += params.chunk;
        });
        await cdp.send('HeapProfiler.takeHeapSnapshot', {
            reportProgress: false,
            treatGlobalObjectsAsRoots: true,
        });
        await cdp.send('HeapProfiler.disable');
        logger.success('Heap snapshot taken', {
            size: snapshotData.length,
        });
        return snapshotData;
    }
    async close() {
        if (this.cdpSession) {
            if (this.coverageEnabled) {
                await this.stopCoverage();
            }
            if (this.profilerEnabled) {
                await this.stopCPUProfiling();
            }
            await this.cdpSession.detach();
            this.cdpSession = null;
        }
        this.coverageEnabled = false;
        this.coverageStartedAt = null;
        logger.info('PerformanceMonitor closed');
    }
}
//# sourceMappingURL=PerformanceMonitor.js.map
