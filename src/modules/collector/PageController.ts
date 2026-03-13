// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { buildNavigationPlan, toPlaywrightWaitUntil } from '../../server/v2/browser/navigation.js';
import { createCDPSessionForPage } from '../../utils/playwrightCompat.js';
export class PageController {
    collector;
    debuggerManager;
    constructor(collector, debuggerManager) {
        this.collector = collector;
        this.debuggerManager = debuggerManager;
    }
    async applyUserAgentOverride(page, userAgent) {
        if (typeof page.setUserAgent === 'function') {
            await page.setUserAgent(userAgent);
            return;
        }
        if (typeof page.context === 'function') {
            const context = page.context();
            if (context && typeof context.newCDPSession === 'function') {
                const cdp = await context.newCDPSession(page);
                await cdp.send('Emulation.setUserAgentOverride', {
                    userAgent,
                });
                return;
            }
        }
        throw new Error('Page does not support user agent overrides');
    }
    async applyViewport(page, viewport) {
        if (typeof page.setViewport === 'function') {
            await page.setViewport(viewport);
            return;
        }
        if (typeof page.setViewportSize === 'function') {
            await page.setViewportSize(viewport);
            return;
        }
        throw new Error('Page does not support viewport emulation');
    }
    async getPageCookies(page) {
        if (typeof page.cookies === 'function') {
            return await page.cookies();
        }
        if (typeof page.context === 'function') {
            return await page.context().cookies();
        }
        throw new Error('Page does not support cookie inspection');
    }
    async createPauseMonitor(page, timeoutMs) {
        if (this.debuggerManager?.isEnabled?.()) {
            return {
                pausedPromise: this.debuggerManager.waitForPaused(timeoutMs).then((state) => ({
                    reason: state?.reason,
                    hitBreakpoints: state?.hitBreakpoints,
                    callFrames: state?.callFrames,
                })),
                cleanup: async () => undefined,
            };
        }
        let cdp;
        try {
            cdp = await createCDPSessionForPage(page);
        }
        catch {
            return {
                pausedPromise: null,
                cleanup: async () => undefined,
            };
        }
        const listeners = [];
        const attach = (event, handler) => {
            cdp.on?.(event, handler);
            listeners.push({ event, handler });
        };
        try {
            await cdp.send('Debugger.enable');
        }
        catch {
            return {
                pausedPromise: null,
                cleanup: async () => {
                    for (const listener of listeners) {
                        cdp.off?.(listener.event, listener.handler);
                    }
                    await cdp.detach?.().catch(() => undefined);
                },
            };
        }
        const pausedPromise = new Promise((resolve) => {
            attach('Debugger.paused', (params) => resolve(params));
        });
        return {
            pausedPromise,
            cleanup: async () => {
                for (const listener of listeners) {
                    cdp.off?.(listener.event, listener.handler);
                }
                await cdp.send('Debugger.disable').catch(() => undefined);
                await cdp.detach?.().catch(() => undefined);
            },
        };
    }
    async buildNavigationSnapshot(page, url, startTime, extra = {}) {
        const { skipTitle, ...rest } = extra || {};
        let title = '';
        if (skipTitle !== true) {
            try {
                title = await Promise.race([
                    page.title(),
                    new Promise((resolve) => setTimeout(() => resolve(''), 750)),
                ]);
            }
            catch {
                title = '';
            }
        }
        return {
            url: page.url() || url,
            title,
            loadTime: Date.now() - startTime,
            ...rest,
        };
    }
    async navigate(url, options) {
        const page = await this.collector.getActivePage();
        const startTime = Date.now();
        const plan = buildNavigationPlan(options || {});
        const diagnostics = [];
        let lastError = null;
        for (const attempt of plan.attempts) {
            const pauseMonitor = await this.createPauseMonitor(page, attempt.timeout || 30000);
            try {
                const navigationPromise = page.goto(url, {
                    waitUntil: toPlaywrightWaitUntil(attempt.waitUntil),
                    timeout: attempt.timeout || 30000,
                }).then(() => ({ kind: 'completed' })).catch((error) => ({ kind: 'error', error }));
                const raceResult = pauseMonitor.pausedPromise
                    ? await Promise.race([
                        navigationPromise,
                        pauseMonitor.pausedPromise.then((params) => ({ kind: 'paused', params })),
                    ])
                    : await navigationPromise;
                if (raceResult?.kind === 'paused') {
                    const snapshot = await this.buildNavigationSnapshot(page, url, startTime, {
                        waitProfile: plan.waitProfile,
                        waitUntil: attempt.waitUntil,
                        navigationAttempts: diagnostics.length + 1,
                        diagnostics,
                        interruptedByDebuggerPause: true,
                        skipTitle: true,
                        pausedState: {
                            reason: raceResult.params?.reason,
                            location: raceResult.params?.callFrames?.[0]?.location,
                            hitBreakpoints: raceResult.params?.hitBreakpoints,
                        },
                    });
                    logger.info(`Navigation interrupted by debugger pause: ${url}`);
                    return snapshot;
                }
                if (raceResult?.kind === 'error') {
                    throw raceResult.error;
                }
                const snapshot = await this.buildNavigationSnapshot(page, url, startTime, {
                    waitProfile: plan.waitProfile,
                    waitUntil: attempt.waitUntil,
                    navigationAttempts: diagnostics.length + 1,
                    diagnostics,
                });
                logger.info(`Navigated to: ${url}`);
                return snapshot;
            }
            catch (error) {
                lastError = error;
                diagnostics.push({
                    waitUntil: attempt.waitUntil,
                    timeout: attempt.timeout || 30000,
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            finally {
                await pauseMonitor.cleanup();
            }
        }
        throw lastError || new Error('Navigation failed');
    }
    async reload(options) {
        const page = await this.collector.getActivePage();
        const plan = buildNavigationPlan(options && Object.keys(options).length > 0
            ? options
            : { waitProfile: 'interactive', timeout: 10000 });
        let lastError = null;
        for (const attempt of plan.attempts) {
            const pauseMonitor = await this.createPauseMonitor(page, attempt.timeout || 30000);
            try {
                const reloadPromise = page.reload({
                    waitUntil: toPlaywrightWaitUntil(attempt.waitUntil),
                    timeout: attempt.timeout || 30000,
                }).then(() => ({ kind: 'completed' })).catch((error) => ({ kind: 'error', error }));
                const raceResult = pauseMonitor.pausedPromise
                    ? await Promise.race([
                        reloadPromise,
                        pauseMonitor.pausedPromise.then((params) => ({ kind: 'paused', params })),
                    ])
                    : await reloadPromise;
                if (raceResult?.kind === 'paused') {
                    logger.info('Page reload interrupted by debugger pause');
                    return {
                        interruptedByDebuggerPause: true,
                        pausedState: {
                            reason: raceResult.params?.reason,
                            location: raceResult.params?.callFrames?.[0]?.location,
                            hitBreakpoints: raceResult.params?.hitBreakpoints,
                        },
                    };
                }
                if (raceResult?.kind === 'error') {
                    throw raceResult.error;
                }
                logger.info('Page reloaded');
                return;
            }
            catch (error) {
                lastError = error;
            }
            finally {
                await pauseMonitor.cleanup();
            }
        }
        throw lastError || new Error('Reload failed');
    }
    async goBack() {
        const page = await this.collector.getActivePage();
        await Promise.race([
            page.goBack({
                waitUntil: 'domcontentloaded',
                timeout: 10000,
            }).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 12000)),
        ]);
        logger.info('Navigated back');
    }
    async goForward() {
        const page = await this.collector.getActivePage();
        await Promise.race([
            page.goForward({
                waitUntil: 'domcontentloaded',
                timeout: 10000,
            }).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 12000)),
        ]);
        logger.info('Navigated forward');
    }
    async click(selector, options) {
        const page = await this.collector.getActivePage();
        await page.click(selector, {
            button: options?.button || 'left',
            clickCount: options?.clickCount || 1,
            delay: options?.delay,
        });
        logger.info(`Clicked: ${selector}`);
    }
    async type(selector, text, options) {
        const page = await this.collector.getActivePage();
        if (options?.replace === true) {
            await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (element && 'value' in element) {
                    element.value = '';
                }
            }, selector);
        }
        await page.type(selector, text, {
            delay: options?.delay,
        });
        logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
    }
    async select(selector, ...values) {
        const page = await this.collector.getActivePage();
        if (typeof page.select === 'function') {
            await page.select(selector, ...values);
        }
        else if (typeof page.selectOption === 'function') {
            await page.selectOption(selector, values.flat());
        }
        else {
            throw new Error('Page does not support select interactions');
        }
        logger.info(`Selected in ${selector}: ${values.join(', ')}`);
    }
    async hover(selector) {
        const page = await this.collector.getActivePage();
        await page.hover(selector);
        logger.info(`Hovered: ${selector}`);
    }
    async scroll(options) {
        const page = await this.collector.getActivePage();
        await page.evaluate((opts) => {
            window.scrollTo(opts.x || 0, opts.y || 0);
        }, options);
        logger.info(`Scrolled to: x=${options.x || 0}, y=${options.y || 0}`);
    }
    async waitForSelector(selector, timeout) {
        try {
            const page = await this.collector.getActivePage();
            await page.waitForSelector(selector, {
                timeout: timeout || 30000,
            });
            const element = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el)
                    return null;
                return {
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || undefined,
                    className: el.className || undefined,
                    textContent: el.textContent?.trim().substring(0, 100) || undefined,
                    attributes: Array.from(el.attributes).reduce((acc, attr) => {
                        acc[attr.name] = attr.value;
                        return acc;
                    }, {}),
                };
            }, selector);
            logger.info(`Selector appeared: ${selector}`);
            return {
                success: true,
                element,
                message: `Selector appeared: ${selector}`,
            };
        }
        catch (error) {
            logger.error(`waitForSelector timeout for ${selector}:`, error);
            return {
                success: false,
                message: `Timeout waiting for selector: ${selector}`,
            };
        }
    }
    async waitForNavigation(timeout) {
        const page = await this.collector.getActivePage();
        if (typeof page.waitForNavigation === 'function') {
            await page.waitForNavigation({
                waitUntil: 'load',
                timeout: timeout || 30000,
            });
        }
        else if (typeof page.waitForLoadState === 'function') {
            await page.waitForLoadState('load', {
                timeout: timeout || 30000,
            });
        }
        else {
            throw new Error('Page does not support navigation waiting');
        }
        logger.info('Navigation completed');
    }
    async evaluate(code) {
        const page = await this.collector.getActivePage();
        const result = await page.evaluate(code);
        logger.info('JavaScript executed');
        return result;
    }
    async getURL() {
        const page = await this.collector.getActivePage();
        return page.url();
    }
    async getTitle() {
        const page = await this.collector.getActivePage();
        return await page.title();
    }
    async getContent() {
        const page = await this.collector.getActivePage();
        return await page.content();
    }
    async screenshot(options) {
        const page = await this.collector.getActivePage();
        const buffer = await page.screenshot({
            path: options?.path,
            type: options?.type || 'png',
            quality: options?.quality,
            fullPage: options?.fullPage || false,
        });
        logger.info(`Screenshot taken${options?.path ? `: ${options.path}` : ''}`);
        return buffer;
    }
    async getPerformanceMetrics() {
        const page = await this.collector.getActivePage();
        const metrics = await page.evaluate(() => {
            const perf = performance.getEntriesByType('navigation')[0];
            return {
                domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
                loadComplete: perf.loadEventEnd - perf.loadEventStart,
                dns: perf.domainLookupEnd - perf.domainLookupStart,
                tcp: perf.connectEnd - perf.connectStart,
                request: perf.responseStart - perf.requestStart,
                response: perf.responseEnd - perf.responseStart,
                total: perf.loadEventEnd - perf.fetchStart,
                resources: performance.getEntriesByType('resource').length,
            };
        });
        logger.info('Performance metrics retrieved');
        return metrics;
    }
    async injectScript(scriptContent) {
        const page = await this.collector.getActivePage();
        await page.evaluate((script) => {
            const scriptElement = document.createElement('script');
            scriptElement.textContent = script;
            document.head.appendChild(scriptElement);
        }, scriptContent);
        logger.info('Script injected into page');
    }
    async setCookies(cookies) {
        const page = await this.collector.getActivePage();
        if (typeof page.setCookie === 'function') {
            await page.setCookie(...cookies);
        }
        else if (typeof page.context === 'function') {
            await page.context().addCookies(cookies);
        }
        else {
            throw new Error('Page does not support cookie injection');
        }
        logger.info(`Set ${cookies.length} cookies`);
    }
    async getCookies() {
        const page = await this.collector.getActivePage();
        const cookies = await this.getPageCookies(page);
        logger.info(`Retrieved ${cookies.length} cookies`);
        return cookies;
    }
    async clearCookies() {
        const page = await this.collector.getActivePage();
        const cookies = await this.getPageCookies(page);
        if (typeof page.deleteCookie === 'function') {
            await page.deleteCookie(...cookies);
        }
        else if (typeof page.context === 'function') {
            await page.context().clearCookies();
        }
        else {
            throw new Error('Page does not support cookie clearing');
        }
        logger.info('All cookies cleared');
    }
    async setViewport(width, height) {
        const page = await this.collector.getActivePage();
        await this.applyViewport(page, { width, height });
        logger.info(`Viewport set to ${width}x${height}`);
    }
    async emulateDevice(deviceName) {
        const page = await this.collector.getActivePage();
        const devices = {
            iPhone: {
                viewport: { width: 375, height: 812, isMobile: true },
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
            },
            iPad: {
                viewport: { width: 768, height: 1024, isMobile: true },
                userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
            },
            Android: {
                viewport: { width: 360, height: 640, isMobile: true },
                userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120',
            },
        };
        const device = devices[deviceName];
        await this.applyViewport(page, device.viewport);
        await this.applyUserAgentOverride(page, device.userAgent);
        logger.info(`Emulating ${deviceName}`);
    }
    async waitForNetworkIdle(timeout = 30000) {
        const page = await this.collector.getActivePage();
        if (typeof page.waitForNetworkIdle === 'function') {
            await page.waitForNetworkIdle({ timeout });
        }
        else if (typeof page.waitForLoadState === 'function') {
            await page.waitForLoadState('networkidle', { timeout });
        }
        else {
            throw new Error('Page does not support network-idle waiting');
        }
        logger.info('Network is idle');
    }
    async getLocalStorage() {
        return this.getStorage('local');
    }
    async getSessionStorage() {
        return this.getStorage('session');
    }
    async getStorage(kind) {
        const page = await this.collector.getActivePage();
        const storage = await page.evaluate((storageKind) => {
            const target = storageKind === 'session' ? sessionStorage : localStorage;
            const items = {};
            for (let i = 0; i < target.length; i++) {
                const key = target.key(i);
                if (key) {
                    items[key] = target.getItem(key) || '';
                }
            }
            return items;
        }, kind);
        logger.info(`Retrieved ${Object.keys(storage).length} ${kind}Storage items`);
        return storage;
    }
    async setLocalStorage(key, value) {
        await this.setStorageEntries('local', { [key]: value });
        logger.info(`Set localStorage: ${key}`);
    }
    async setSessionStorage(key, value) {
        await this.setStorageEntries('session', { [key]: value });
        logger.info(`Set sessionStorage: ${key}`);
    }
    async setStorageEntries(kind, entries) {
        const page = await this.collector.getActivePage();
        await page.evaluate(({ storageKind, storageEntries }) => {
            const target = storageKind === 'session' ? sessionStorage : localStorage;
            Object.entries(storageEntries || {}).forEach(([storageKey, storageValue]) => {
                target.setItem(storageKey, String(storageValue));
            });
        }, { storageKind: kind, storageEntries: entries });
        logger.info(`Set ${Object.keys(entries || {}).length} ${kind}Storage entries`);
    }
    async clearLocalStorage() {
        await this.clearStorage('local');
        logger.info('LocalStorage cleared');
    }
    async clearSessionStorage() {
        await this.clearStorage('session');
        logger.info('SessionStorage cleared');
    }
    async clearStorage(kind) {
        const page = await this.collector.getActivePage();
        await page.evaluate((storageKind) => {
            const target = storageKind === 'session' ? sessionStorage : localStorage;
            target.clear();
        }, kind);
        logger.info(`${kind}Storage cleared`);
    }
    async pressKey(key) {
        const page = await this.collector.getActivePage();
        await page.keyboard.press(key);
        logger.info(`Pressed key: ${key}`);
    }
    async uploadFile(selector, filePath) {
        const page = await this.collector.getActivePage();
        const input = await page.$(selector);
        if (!input) {
            throw new Error(`File input not found: ${selector}`);
        }
        await input.uploadFile(filePath);
        logger.info(`File uploaded: ${filePath}`);
    }
    async getAllLinks() {
        const page = await this.collector.getActivePage();
        const links = await page.evaluate(() => {
            const anchors = document.querySelectorAll('a[href]');
            const result = [];
            for (let i = 0; i < anchors.length; i++) {
                const anchor = anchors[i];
                result.push({
                    text: anchor.textContent?.trim() || '',
                    href: anchor.href,
                });
            }
            return result;
        });
        logger.info(`Found ${links.length} links`);
        return links;
    }
    async getPage() {
        return await this.collector.getActivePage();
    }
}
//# sourceMappingURL=PageController.js.map
