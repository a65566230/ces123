// @ts-nocheck

import { BundleFingerprintService } from '../analysis/BundleFingerprintService.js';
import { FunctionRanker } from '../analysis/FunctionRanker.js';
import { ScriptDiffService } from '../analysis/ScriptDiffService.js';
import { SourceMapAnalyzer } from '../analysis/SourceMapAnalyzer.js';
import { BrowserPool } from '../../../services/BrowserPool.js';
import { RuntimeMonitorService } from '../../../services/RuntimeMonitorService.js';
import { StorageService } from '../../../services/StorageService.js';
import { ToolRateLimiter } from '../../../services/ToolRateLimiter.js';
import { WorkerService } from '../../../services/WorkerService.js';
import { ArtifactStore } from './ArtifactStore.js';
import { EvidenceStore } from './EvidenceStore.js';
import { SessionLifecycleManager } from './SessionLifecycleManager.js';
export class ToolRuntimeContext {
    config;
    options;
    ready;
    browserPool;
    workerService;
    runtimeMonitor;
    toolRateLimiter;
    artifacts = new ArtifactStore();
    evidence = new EvidenceStore();
    storage;
    sessions;
    bundleFingerprints = new BundleFingerprintService();
    sourceMaps = new SourceMapAnalyzer();
    scriptDiff = new ScriptDiffService();
    functionRanker = new FunctionRanker();
    constructor(config, options) {
        this.config = config;
        this.options = options;
        this.storage = new StorageService({
            databasePath: config.storage.path,
            cacheSize: config.storage.cacheSize,
        });
        this.browserPool = new BrowserPool({
            headless: config.puppeteer.headless,
            maxContexts: Number(process.env.BROWSER_POOL_MAX_CONTEXTS || 8),
            executablePath: options.playwrightExecutablePath,
            viewport: options.viewport,
            userAgent: options.userAgent,
            launchArgs: options.browserArgs,
        });
        this.workerService = new WorkerService({
            maxWorkers: config.worker.maxWorkers,
            taskTimeoutMs: config.worker.taskTimeoutMs,
        });
        this.runtimeMonitor = new RuntimeMonitorService();
        this.toolRateLimiter = new ToolRateLimiter({
            maxCalls: config.rateLimit.maxCalls,
            windowMs: config.rateLimit.windowMs,
        });
        this.ready = this.storage.init();
        void this.runtimeMonitor.start();
        this.sessions = new SessionLifecycleManager(config, options, this.storage, this.browserPool);
    }
    async close() {
        await this.ready;
        await this.sessions.closeAll();
        await this.browserPool.close();
        await this.workerService.close();
        await this.runtimeMonitor.close();
        await this.storage.close();
    }
}
//# sourceMappingURL=ToolRuntimeContext.js.map
