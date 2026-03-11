// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { buildNavigationPlan } from '../../server/v2/browser/navigation.js';
export class PageController {
    collector;
    constructor(collector) {
        this.collector = collector;
    }
    async navigate(url, options) {
        const page = await this.collector.getActivePage();
        const startTime = Date.now();
        const plan = buildNavigationPlan(options || {});
        const diagnostics = [];
        let lastError = null;
        for (const attempt of plan.attempts) {
            try {
                await page.goto(url, {
                    waitUntil: attempt.waitUntil,
                    timeout: attempt.timeout || 30000,
                });
                const loadTime = Date.now() - startTime;
                const title = await page.title();
                const currentUrl = page.url();
                logger.info(`Navigated to: ${url}`);
                return {
                    url: currentUrl,
                    title,
                    loadTime,
                    waitProfile: plan.waitProfile,
                    waitUntil: attempt.waitUntil,
                    navigationAttempts: diagnostics.length + 1,
                    diagnostics,
                };
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
        }
        throw lastError || new Error('Navigation failed');
    }
    async reload(options) {
        const page = await this.collector.getActivePage();
        const plan = buildNavigationPlan(options || {});
        await page.reload({
            waitUntil: plan.attempts[0]?.waitUntil || 'networkidle2',
            timeout: plan.attempts[0]?.timeout || 30000,
        });
        logger.info('Page reloaded');
    }
    async goBack() {
        const page = await this.collector.getActivePage();
        await page.goBack();
        logger.info('Navigated back');
    }
    async goForward() {
        const page = await this.collector.getActivePage();
        await page.goForward();
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
        await page.type(selector, text, {
            delay: options?.delay,
        });
        logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
    }
    async select(selector, ...values) {
        const page = await this.collector.getActivePage();
        await page.select(selector, ...values);
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
        await page.waitForNavigation({
            waitUntil: 'load',
            timeout: timeout || 30000,
        });
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
        await page.setCookie(...cookies);
        logger.info(`Set ${cookies.length} cookies`);
    }
    async getCookies() {
        const page = await this.collector.getActivePage();
        const cookies = await page.cookies();
        logger.info(`Retrieved ${cookies.length} cookies`);
        return cookies;
    }
    async clearCookies() {
        const page = await this.collector.getActivePage();
        const cookies = await page.cookies();
        await page.deleteCookie(...cookies);
        logger.info('All cookies cleared');
    }
    async setViewport(width, height) {
        const page = await this.collector.getActivePage();
        await page.setViewport({ width, height });
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
        await page.setViewport(device.viewport);
        await page.setUserAgent(device.userAgent);
        logger.info(`Emulating ${deviceName}`);
    }
    async waitForNetworkIdle(timeout = 30000) {
        const page = await this.collector.getActivePage();
        await page.waitForNetworkIdle({ timeout });
        logger.info('Network is idle');
    }
    async getLocalStorage() {
        const page = await this.collector.getActivePage();
        const storage = await page.evaluate(() => {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    items[key] = localStorage.getItem(key) || '';
                }
            }
            return items;
        });
        logger.info(`Retrieved ${Object.keys(storage).length} localStorage items`);
        return storage;
    }
    async setLocalStorage(key, value) {
        const page = await this.collector.getActivePage();
        await page.evaluate((k, v) => {
            localStorage.setItem(k, v);
        }, key, value);
        logger.info(`Set localStorage: ${key}`);
    }
    async clearLocalStorage() {
        const page = await this.collector.getActivePage();
        await page.evaluate(() => {
            localStorage.clear();
        });
        logger.info('LocalStorage cleared');
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
