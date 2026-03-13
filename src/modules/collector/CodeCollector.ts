// @ts-nocheck

import { chromium } from 'playwright-core';
import { logger } from '../../utils/logger.js';
import { applyBasicNavigatorStealthInit } from '../stealth/basicNavigatorStealth.js';
import { CodeCache } from './CodeCache.js';
import { SmartCodeCollector } from './SmartCodeCollector.js';
import { CodeCompressor } from './CodeCompressor.js';
import { buildNavigationPlan, toPlaywrightWaitUntil } from '../../server/v2/browser/navigation.js';
import { resolveChromiumExecutablePath } from '../../utils/resolveChromiumExecutablePath.js';
import { addInitScriptCompat } from '../../utils/playwrightCompat.js';
export class CodeCollector {
    config;
    browser = null;
    context = null;
    collectedUrls = new Set();
    MAX_COLLECTED_URLS;
    MAX_FILES_PER_COLLECT;
    MAX_RESPONSE_SIZE;
    MAX_SINGLE_FILE_SIZE;
    viewport;
    userAgent;
    collectedFilesCache = new Map();
    cache;
    cacheEnabled = true;
    smartCollector;
    compressor;
    cdpSession = null;
    cdpListeners = {};
    constructor(config) {
        this.config = config;
        this.MAX_COLLECTED_URLS = config.maxCollectedUrls ?? 10000;
        this.MAX_FILES_PER_COLLECT = config.maxFilesPerCollect ?? 200;
        this.MAX_RESPONSE_SIZE = config.maxTotalContentSize ?? 512 * 1024;
        this.MAX_SINGLE_FILE_SIZE = config.maxSingleFileSize ?? 200 * 1024;
        this.viewport = config.viewport ?? { width: 1920, height: 1080 };
        this.userAgent = config.userAgent ??
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.cache = new CodeCache();
        this.smartCollector = new SmartCodeCollector();
        this.compressor = new CodeCompressor();
        logger.info(`📊 CodeCollector limits: maxCollect=${this.MAX_FILES_PER_COLLECT} files, maxResponse=${(this.MAX_RESPONSE_SIZE / 1024).toFixed(0)}KB, maxSingle=${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(0)}KB`);
        logger.info(`💡 Strategy: Collect ALL files → Cache → Return summary/partial data to fit MCP limits`);
    }
    setCacheEnabled(enabled) {
        this.cacheEnabled = enabled;
        logger.info(`Code cache ${enabled ? 'enabled' : 'disabled'}`);
    }
    async clearFileCache() {
        await this.cache.clear();
    }
    async getFileCacheStats() {
        return await this.cache.getStats();
    }
    async clearAllData() {
        logger.info('🧹 Clearing all collected data...');
        await this.cache.clear();
        this.compressor.clearCache();
        this.compressor.resetStats();
        this.collectedUrls.clear();
        logger.success('✅ All data cleared');
    }
    async getAllStats() {
        const cacheStats = await this.cache.getStats();
        const compressionStats = this.compressor.getStats();
        return {
            cache: cacheStats,
            compression: {
                ...compressionStats,
                cacheSize: this.compressor.getCacheSize(),
            },
            collector: {
                collectedUrls: this.collectedUrls.size,
                maxCollectedUrls: this.MAX_COLLECTED_URLS,
            },
        };
    }
    getCache() {
        return this.cache;
    }
    enhancePageCompatibility(page) {
        if (page.__jshookCompatibilityPatched) {
            return page;
        }
        page.__jshookCompatibilityPatched = true;
        if (typeof page.createCDPSession !== 'function' && typeof page.context === 'function') {
            const context = page.context();
            if (context && typeof context.newCDPSession === 'function') {
                page.createCDPSession = () => context.newCDPSession(page);
            }
        }
        if (typeof page.evaluateOnNewDocument !== 'function' && typeof page.addInitScript === 'function') {
            page.evaluateOnNewDocument = (script, arg) => page.addInitScript(script, arg);
        }
        if (typeof page.setUserAgent !== 'function') {
            page.setUserAgent = async (userAgent) => {
                if (typeof page.context === 'function') {
                    const context = page.context();
                    if (context && typeof context.newCDPSession === 'function') {
                        const cdp = await context.newCDPSession(page);
                        try {
                            await cdp.send('Emulation.setUserAgentOverride', { userAgent });
                        }
                        finally {
                            await cdp.detach?.().catch(() => undefined);
                        }
                    }
                }
                if (typeof page.addInitScript === 'function') {
                    await page.addInitScript((ua) => {
                        Object.defineProperty(navigator, 'userAgent', {
                            configurable: true,
                            get: () => ua,
                        });
                    }, userAgent);
                }
            };
        }
        if (typeof page.select !== 'function' && typeof page.selectOption === 'function') {
            page.select = (selector, ...values) => page.selectOption(selector, values.flat());
        }
        if (typeof page.setViewport !== 'function' && typeof page.setViewportSize === 'function') {
            page.setViewport = (viewport) => page.setViewportSize(viewport);
        }
        return page;
    }
    getCompressor() {
        return this.compressor;
    }
    cleanupCollectedUrls() {
        if (this.collectedUrls.size > this.MAX_COLLECTED_URLS) {
            logger.warn(`Collected URLs exceeded ${this.MAX_COLLECTED_URLS}, clearing...`);
            const urls = Array.from(this.collectedUrls);
            this.collectedUrls.clear();
            urls.slice(-Math.floor(this.MAX_COLLECTED_URLS / 2)).forEach(url => this.collectedUrls.add(url));
        }
    }
    async init() {
        if (this.browser) {
            return;
        }
        await this.cache.init();
        logger.info('Initializing browser with anti-detection...');
        this.browser = await chromium.launch({
            headless: this.config.headless,
            executablePath: resolveChromiumExecutablePath(this.config.executablePath),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                `--window-size=${this.viewport.width},${this.viewport.height}`,
                '--ignore-certificate-errors',
            ],
        });
        this.context = await this.browser.newContext({
            viewport: this.viewport,
            userAgent: this.userAgent,
        });
        this.browser.on('disconnected', () => {
            logger.warn('⚠️  Browser disconnected');
            this.browser = null;
            this.context = null;
            if (this.cdpSession) {
                this.cdpSession = null;
                this.cdpListeners = {};
            }
        });
        logger.success('Browser initialized with enhanced anti-detection');
    }
    async close() {
        await this.clearAllData();
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            logger.info('Browser closed and all data cleared');
        }
    }
    async getActivePage() {
        if (!this.browser) {
            await this.init();
        }
        const pages = await this.context.pages();
        if (pages.length === 0) {
            return this.enhancePageCompatibility(await this.context.newPage());
        }
        const lastPage = pages[pages.length - 1];
        if (!lastPage) {
            throw new Error('Failed to get active page');
        }
        return this.enhancePageCompatibility(lastPage);
    }
    async createPage(url) {
        if (!this.browser) {
            await this.init();
        }
        const page = this.enhancePageCompatibility(await this.context.newPage());
        await this.applyAntiDetection(page);
        if (url) {
            const plan = buildNavigationPlan({
                waitProfile: 'interactive',
                timeout: this.config.timeout,
            });
            await page.goto(url, {
                waitUntil: toPlaywrightWaitUntil(plan.attempts[0]?.waitUntil || 'domcontentloaded'),
                timeout: plan.attempts[0]?.timeout || this.config.timeout,
            });
        }
        logger.info(`New page created${url ? `: ${url}` : ''}`);
        return page;
    }
    async addInitScript(page, script, arg) {
        if (typeof page.addInitScript === 'function') {
            await page.addInitScript(script, arg);
            return;
        }
        if (typeof page.evaluateOnNewDocument === 'function') {
            await page.evaluateOnNewDocument(script, arg);
            return;
        }
        throw new Error('Page does not support init scripts');
    }
    async applyAntiDetection(page) {
        await this.addInitScript(page, applyBasicNavigatorStealthInit, {
            flagName: 'codeCollectorApplied',
            webdriverMode: 'false',
            pluginsMode: 'simple',
            languages: ['en-US', 'en'],
            notificationState: 'denied',
        });
    }
    async getStatus() {
        if (!this.browser) {
            return {
                running: false,
                pagesCount: 0,
            };
        }
        try {
            const pages = await this.context.pages();
            const version = await this.browser.version();
            return {
                running: true,
                pagesCount: pages.length,
                version,
            };
        }
        catch (error) {
            logger.debug('Browser not running or disconnected:', error);
            return {
                running: false,
                pagesCount: 0,
            };
        }
    }
    async collect(options) {
        const startTime = Date.now();
        logger.info(`Collecting code from: ${options.url}`);
        if (this.cacheEnabled) {
            const cached = await this.cache.get(options.url, options);
            if (cached) {
                logger.info(`✅ Cache hit for: ${options.url}`);
                return cached;
            }
        }
        await this.init();
        if (!this.browser) {
            throw new Error('Browser not initialized');
        }
        const page = await this.context.newPage();
        try {
            page.setDefaultTimeout(options.timeout || this.config.timeout);
            await this.applyAntiDetection(page);
            const files = [];
            let collectedExternalBytes = 0;
            let maxFilesWarningShown = false;
            const isSummaryMode = options.smartMode === 'summary';
            const summaryMaxFiles = isSummaryMode ? Math.min(this.MAX_FILES_PER_COLLECT, 80) : this.MAX_FILES_PER_COLLECT;
            const summaryMaxBytes = isSummaryMode
                ? Math.max(options.maxTotalSize || this.MAX_RESPONSE_SIZE, 256 * 1024)
                : Number.POSITIVE_INFINITY;
            this.cdpSession = await this.context.newCDPSession(page);
            await this.cdpSession.send('Network.enable');
            await this.cdpSession.send('Runtime.enable');
            this.cdpListeners.responseReceived = async (params) => {
                const { response, requestId, type } = params;
                const url = response.url;
                if (files.length >= summaryMaxFiles) {
                    if (!maxFilesWarningShown) {
                        logger.warn(`⚠️  Reached max files limit (${summaryMaxFiles}), will skip remaining files`);
                        maxFilesWarningShown = true;
                    }
                    return;
                }
                if (isSummaryMode && collectedExternalBytes >= summaryMaxBytes) {
                    return;
                }
                this.cleanupCollectedUrls();
                if (type === 'Script' ||
                    response.mimeType?.includes('javascript') ||
                    url.endsWith('.js')) {
                    try {
                        const { body, base64Encoded } = await this.cdpSession.send('Network.getResponseBody', {
                            requestId,
                        });
                        const content = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
                        const contentSize = content.length;
                        let finalContent = content;
                        let truncated = false;
                        if (contentSize > this.MAX_SINGLE_FILE_SIZE) {
                            finalContent = content.substring(0, this.MAX_SINGLE_FILE_SIZE);
                            truncated = true;
                            logger.warn(`[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`);
                        }
                        if (!this.collectedUrls.has(url)) {
                            this.collectedUrls.add(url);
                            const file = {
                                url,
                                content: finalContent,
                                size: finalContent.length,
                                type: 'external',
                                metadata: truncated ? {
                                    truncated: true,
                                    originalSize: contentSize,
                                    truncatedSize: finalContent.length,
                                } : undefined,
                            };
                            files.push(file);
                            collectedExternalBytes += finalContent.length;
                            this.collectedFilesCache.set(url, file);
                            logger.debug(`[CDP] Collected (${files.length}/${this.MAX_FILES_PER_COLLECT}): ${url} (${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`);
                        }
                    }
                    catch (error) {
                        logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
                    }
                }
            };
            this.cdpSession.on('Network.responseReceived', this.cdpListeners.responseReceived);
            logger.info(`Navigating to: ${options.url}`);
            await this.navigateWithRetry(page, options.url, {
                waitProfile: options.waitProfile,
                timeout: options.timeout || this.config.timeout,
            });
            if (options.includeInline !== false) {
                logger.info('Collecting inline scripts...');
                const inlineScripts = await this.collectInlineScripts(page);
                files.push(...inlineScripts);
            }
            if (options.includeServiceWorker !== false) {
                logger.info('Collecting Service Workers...');
                const serviceWorkers = await this.collectServiceWorkers(page);
                files.push(...serviceWorkers);
            }
            if (options.includeWebWorker !== false) {
                logger.info('Collecting Web Workers...');
                const webWorkers = await this.collectWebWorkers(page);
                files.push(...webWorkers);
            }
            if (options.includeDynamic) {
                logger.info('Waiting for dynamic scripts...');
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            if (this.cdpSession) {
                if (this.cdpListeners.responseReceived) {
                    this.cdpSession.off('Network.responseReceived', this.cdpListeners.responseReceived);
                }
                await this.cdpSession.detach();
                this.cdpSession = null;
                this.cdpListeners = {};
            }
            const collectTime = Date.now() - startTime;
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);
            const truncatedFiles = files.filter(f => f.metadata?.truncated);
            if (truncatedFiles.length > 0) {
                logger.warn(`⚠️  ${truncatedFiles.length} files were truncated due to size limits`);
                truncatedFiles.forEach(f => {
                    logger.warn(`  - ${f.url}: ${(f.metadata?.originalSize / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`);
                });
            }
            let processedFiles = files;
            if (options.smartMode && options.smartMode !== 'full') {
                try {
                    logger.info(`🧠 Applying smart collection mode: ${options.smartMode}`);
                    const smartOptions = {
                        mode: options.smartMode,
                        maxTotalSize: options.maxTotalSize,
                        maxFileSize: options.maxFileSize,
                        priorities: options.priorities,
                    };
                    const smartResult = await this.smartCollector.smartCollect(page, files, smartOptions);
                    if (options.smartMode === 'summary') {
                        logger.info(`📊 Returning ${smartResult.length} code summaries`);
                        if (Array.isArray(smartResult) && smartResult.length > 0 && smartResult[0] && 'hasEncryption' in smartResult[0]) {
                            return {
                                files: [],
                                summaries: smartResult,
                                dependencies: { nodes: [], edges: [] },
                                totalSize: 0,
                                collectTime: Date.now() - startTime,
                            };
                        }
                    }
                    if (Array.isArray(smartResult) && (smartResult.length === 0 || (smartResult[0] && 'content' in smartResult[0]))) {
                        processedFiles = smartResult;
                    }
                    else {
                        logger.warn('Smart collection returned unexpected type, using original files');
                        processedFiles = files;
                    }
                }
                catch (error) {
                    logger.error('Smart collection failed, using original files:', error);
                    processedFiles = files;
                }
            }
            if (options.compress) {
                try {
                    logger.info(`🗜️  Compressing ${processedFiles.length} files with enhanced compressor...`);
                    const filesToCompress = processedFiles
                        .filter(file => this.compressor.shouldCompress(file.content))
                        .map(file => ({
                        url: file.url,
                        content: file.content,
                    }));
                    if (filesToCompress.length === 0) {
                        logger.info('No files need compression (all below threshold)');
                    }
                    else {
                        const compressedResults = await this.compressor.compressBatch(filesToCompress, {
                            level: undefined,
                            useCache: true,
                            maxRetries: 3,
                            concurrency: 5,
                            onProgress: (progress) => {
                                if (progress % 25 === 0) {
                                    logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
                                }
                            },
                        });
                        const compressedMap = new Map(compressedResults.map(r => [r.url, r]));
                        for (const file of processedFiles) {
                            const compressed = compressedMap.get(file.url);
                            if (compressed) {
                                file.metadata = {
                                    ...file.metadata,
                                    compressed: true,
                                    originalSize: compressed.originalSize,
                                    compressedSize: compressed.compressedSize,
                                    compressionRatio: compressed.compressionRatio,
                                };
                            }
                        }
                        const stats = this.compressor.getStats();
                        logger.info(`✅ Compressed ${compressedResults.length}/${processedFiles.length} files`);
                        logger.info(`📊 Compression stats: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB -> ${(stats.totalCompressedSize / 1024).toFixed(2)} KB (${stats.averageRatio.toFixed(1)}% reduction)`);
                        logger.info(`⚡ Cache: ${stats.cacheHits} hits, ${stats.cacheMisses} misses (${stats.cacheHits > 0 ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) : 0}% hit rate)`);
                    }
                }
                catch (error) {
                    logger.error('Compression failed:', error);
                }
            }
            const dependencies = this.analyzeDependencies(processedFiles);
            logger.success(`Collected ${processedFiles.length} files (${(totalSize / 1024).toFixed(2)} KB) in ${collectTime}ms`);
            const result = {
                files: processedFiles,
                dependencies,
                totalSize,
                collectTime,
            };
            if (this.cacheEnabled) {
                await this.cache.set(options.url, result, options);
                logger.debug(`💾 Saved to cache: ${options.url}`);
            }
            return result;
        }
        catch (error) {
            logger.error('Code collection failed', error);
            throw error;
        }
        finally {
            await page.close();
        }
    }
    async collectInlineScripts(page) {
        const scripts = await page.evaluate((maxSingleSize) => {
            const scriptElements = Array.from(document.querySelectorAll('script'));
            return scriptElements
                .filter((script) => !script.src && script.textContent)
                .map((script, index) => {
                let content = script.textContent || '';
                const originalSize = content.length;
                let truncated = false;
                if (content.length > maxSingleSize) {
                    content = content.substring(0, maxSingleSize);
                    truncated = true;
                }
                return {
                    url: `inline-script-${index}`,
                    content,
                    size: content.length,
                    type: 'inline',
                    metadata: {
                        scriptType: script.type || 'text/javascript',
                        async: script.async,
                        defer: script.defer,
                        integrity: script.integrity || undefined,
                        truncated,
                        originalSize: truncated ? originalSize : undefined,
                    },
                };
            });
        }, this.MAX_SINGLE_FILE_SIZE);
        const limitedScripts = scripts.slice(0, this.MAX_FILES_PER_COLLECT);
        if (scripts.length > limitedScripts.length) {
            logger.warn(`⚠️  Found ${scripts.length} inline scripts, limiting to ${this.MAX_FILES_PER_COLLECT}`);
        }
        const truncatedCount = limitedScripts.filter(s => s.metadata?.truncated).length;
        if (truncatedCount > 0) {
            logger.warn(`⚠️  ${truncatedCount} inline scripts were truncated due to size limits`);
        }
        logger.debug(`Collected ${limitedScripts.length} inline scripts`);
        return limitedScripts;
    }
    async collectServiceWorkers(page) {
        try {
            const serviceWorkers = await page.evaluate(async () => {
                if (!('serviceWorker' in navigator)) {
                    return [];
                }
                const registrations = await navigator.serviceWorker.getRegistrations();
                const workers = [];
                for (const registration of registrations) {
                    const worker = registration.active || registration.installing || registration.waiting;
                    if (worker && worker.scriptURL) {
                        workers.push({
                            url: worker.scriptURL,
                            scope: registration.scope,
                            state: worker.state,
                        });
                    }
                }
                return workers;
            });
            const files = [];
            for (const worker of serviceWorkers) {
                try {
                    const content = await page.evaluate(async (url) => {
                        const response = await fetch(url);
                        return await response.text();
                    }, worker.url);
                    if (content) {
                        files.push({
                            url: worker.url,
                            content,
                            size: content.length,
                            type: 'service-worker',
                        });
                        logger.debug(`Collected Service Worker: ${worker.url}`);
                    }
                }
                catch (error) {
                    logger.warn(`Failed to collect Service Worker: ${worker.url}`, error);
                }
            }
            return files;
        }
        catch (error) {
            logger.warn('Service Worker collection failed', error);
            return [];
        }
    }
    async collectWebWorkers(page) {
        try {
            await addInitScriptCompat(page, () => {
                const originalWorker = window.Worker;
                const workerUrls = [];
                window.Worker = function (scriptURL, options) {
                    workerUrls.push(scriptURL);
                    window.__workerUrls = workerUrls;
                    return new originalWorker(scriptURL, options);
                };
            });
            const workerUrls = (await page.evaluate(() => window.__workerUrls || []));
            const files = [];
            for (const url of workerUrls) {
                try {
                    const absoluteUrl = new URL(url, page.url()).href;
                    const content = await page.evaluate(async (workerUrl) => {
                        const response = await fetch(workerUrl);
                        return await response.text();
                    }, absoluteUrl);
                    if (content) {
                        files.push({
                            url: absoluteUrl,
                            content,
                            size: content.length,
                            type: 'web-worker',
                        });
                        logger.debug(`Collected Web Worker: ${absoluteUrl}`);
                    }
                }
                catch (error) {
                    logger.warn(`Failed to collect Web Worker: ${url}`, error);
                }
            }
            return files;
        }
        catch (error) {
            logger.warn('Web Worker collection failed', error);
            return [];
        }
    }
    analyzeDependencies(files) {
        const nodes = [];
        const edges = [];
        files.forEach((file) => {
            nodes.push({
                id: file.url,
                url: file.url,
                type: file.type,
            });
        });
        files.forEach((file) => {
            const dependencies = this.extractDependencies(file.content);
            dependencies.forEach((dep) => {
                const targetFile = files.find((f) => f.url.includes(dep) || f.url.endsWith(dep) || f.url.endsWith(`${dep}.js`));
                if (targetFile) {
                    edges.push({
                        from: file.url,
                        to: targetFile.url,
                        type: 'import',
                    });
                }
            });
        });
        logger.debug(`Dependency graph: ${nodes.length} nodes, ${edges.length} edges`);
        return { nodes, edges };
    }
    extractDependencies(code) {
        const dependencies = [];
        const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            if (match[1])
                dependencies.push(match[1]);
        }
        const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((match = requireRegex.exec(code)) !== null) {
            if (match[1])
                dependencies.push(match[1]);
        }
        const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((match = dynamicImportRegex.exec(code)) !== null) {
            if (match[1])
                dependencies.push(match[1]);
        }
        return [...new Set(dependencies)];
    }
    shouldCollectUrl(url, filterRules) {
        if (!filterRules || filterRules.length === 0) {
            return true;
        }
        for (const rule of filterRules) {
            const regex = new RegExp(rule.replace(/\*/g, '.*'));
            if (regex.test(url)) {
                return true;
            }
        }
        return false;
    }
    async navigateWithRetry(page, url, options, maxRetries = 3) {
        let lastError = null;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const plan = buildNavigationPlan(options || {});
                let attemptError = null;
                for (const attempt of plan.attempts) {
                    try {
                        await page.goto(url, {
                            waitUntil: toPlaywrightWaitUntil(attempt.waitUntil),
                            timeout: attempt.timeout,
                        });
                        return;
                    }
                    catch (error) {
                        attemptError = error;
                    }
                }
                throw attemptError || new Error('Navigation failed');
            }
            catch (error) {
                lastError = error;
                logger.warn(`Navigation attempt ${i + 1}/${maxRetries} failed: ${error}`);
                if (i < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
                }
            }
        }
        throw lastError || new Error('Navigation failed after retries');
    }
    async getPerformanceMetrics(page) {
        try {
            const metrics = await page.evaluate(() => {
                const perf = performance.getEntriesByType('navigation')[0];
                return {
                    domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
                    loadComplete: perf.loadEventEnd - perf.loadEventStart,
                    domInteractive: perf.domInteractive - perf.fetchStart,
                    totalTime: perf.loadEventEnd - perf.fetchStart,
                };
            });
            return metrics;
        }
        catch (error) {
            logger.warn('Failed to get performance metrics', error);
            return {};
        }
    }
    async collectPageMetadata(page) {
        try {
            const metadata = await page.evaluate(() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    },
                    cookies: document.cookie,
                    localStorage: Object.keys(localStorage).length,
                    sessionStorage: Object.keys(sessionStorage).length,
                };
            });
            return metadata;
        }
        catch (error) {
            logger.warn('Failed to collect page metadata', error);
            return {};
        }
    }
    getBrowser() {
        return this.browser;
    }
    getCollectionStats() {
        return {
            totalCollected: this.collectedUrls.size,
            uniqueUrls: this.collectedUrls.size,
        };
    }
    clearCache() {
        this.collectedUrls.clear();
        logger.info('Collection cache cleared');
    }
    getCollectedFilesSummary() {
        const summaries = Array.from(this.collectedFilesCache.values()).map(file => ({
            url: file.url,
            size: file.size,
            type: file.type,
            truncated: typeof file.metadata?.truncated === 'boolean' ? file.metadata.truncated : undefined,
            originalSize: typeof file.metadata?.originalSize === 'number' ? file.metadata.originalSize : undefined,
        }));
        logger.info(`📋 Returning summary of ${summaries.length} collected files`);
        return summaries;
    }
    getFileByUrl(url) {
        const file = this.collectedFilesCache.get(url);
        if (file) {
            logger.info(`📄 Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`);
            return file;
        }
        logger.warn(`⚠️  File not found: ${url}`);
        return null;
    }
    getFilesByPattern(pattern, limit = 20, maxTotalSize = this.MAX_RESPONSE_SIZE) {
        const regex = new RegExp(pattern);
        const matched = [];
        for (const file of this.collectedFilesCache.values()) {
            if (regex.test(file.url)) {
                matched.push(file);
            }
        }
        const returned = [];
        let totalSize = 0;
        let truncated = false;
        for (let i = 0; i < matched.length && i < limit; i++) {
            const file = matched[i];
            if (file && totalSize + file.size <= maxTotalSize) {
                returned.push(file);
                totalSize += file.size;
            }
            else {
                truncated = true;
                break;
            }
        }
        if (truncated || matched.length > limit) {
            logger.warn(`⚠️  Pattern "${pattern}" matched ${matched.length} files, returning ${returned.length} (limited by size/count)`);
        }
        logger.info(`🔍 Pattern "${pattern}": matched ${matched.length}, returning ${returned.length} files (${(totalSize / 1024).toFixed(2)} KB)`);
        return {
            files: returned,
            totalSize,
            matched: matched.length,
            returned: returned.length,
            truncated,
        };
    }
    getTopPriorityFiles(topN = 10, maxTotalSize = this.MAX_RESPONSE_SIZE) {
        const allFiles = Array.from(this.collectedFilesCache.values());
        const scoredFiles = allFiles.map(file => ({
            file,
            score: this.calculatePriorityScore(file),
        }));
        scoredFiles.sort((a, b) => b.score - a.score);
        const selected = [];
        let totalSize = 0;
        for (let i = 0; i < Math.min(topN, scoredFiles.length); i++) {
            const item = scoredFiles[i];
            if (item && item.file && totalSize + item.file.size <= maxTotalSize) {
                selected.push(item.file);
                totalSize += item.file.size;
            }
            else {
                break;
            }
        }
        logger.info(`⭐ Returning top ${selected.length}/${allFiles.length} priority files (${(totalSize / 1024).toFixed(2)} KB)`);
        return {
            files: selected,
            totalSize,
            totalFiles: allFiles.length,
        };
    }
    calculatePriorityScore(file) {
        let score = 0;
        if (file.type === 'inline')
            score += 10;
        else if (file.type === 'external')
            score += 5;
        if (file.size < 10 * 1024)
            score += 15;
        else if (file.size < 50 * 1024)
            score += 10;
        else if (file.size > 200 * 1024)
            score -= 10;
        const url = file.url.toLowerCase();
        if (url.includes('main') || url.includes('index') || url.includes('app'))
            score += 20;
        if (url.includes('crypto') || url.includes('encrypt') || url.includes('sign'))
            score += 30;
        if (url.includes('api') || url.includes('request') || url.includes('ajax'))
            score += 25;
        if (url.includes('core') || url.includes('common') || url.includes('util'))
            score += 15;
        if (url.includes('vendor') || url.includes('lib') || url.includes('jquery') || url.includes('react'))
            score -= 20;
        if (url.includes('node_modules') || url.includes('bundle'))
            score -= 30;
        return score;
    }
    clearCollectedFilesCache() {
        const count = this.collectedFilesCache.size;
        this.collectedFilesCache.clear();
        logger.info(`🧹 Cleared collected files cache (${count} files)`);
    }
}
//# sourceMappingURL=CodeCollector.js.map
