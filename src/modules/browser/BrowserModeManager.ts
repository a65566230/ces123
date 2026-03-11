// @ts-nocheck

import { chromium } from 'playwright-core';
import { logger } from '../../utils/logger.js';
import { CaptchaDetector } from '../captcha/CaptchaDetector.js';
import { resolveChromiumExecutablePath } from '../../utils/resolveChromiumExecutablePath.js';
export class BrowserModeManager {
    browser = null;
    context = null;
    currentPage = null;
    isHeadless = true;
    config;
    captchaDetector;
    launchOptions;
    sessionData = {};
    constructor(config = {}, launchOptions = {}) {
        this.config = {
            autoDetectCaptcha: config.autoDetectCaptcha ?? true,
            autoSwitchHeadless: config.autoSwitchHeadless ?? true,
            captchaTimeout: config.captchaTimeout ?? 300000,
            defaultHeadless: config.defaultHeadless ?? true,
            askBeforeSwitchBack: config.askBeforeSwitchBack ?? true,
        };
        this.isHeadless = this.config.defaultHeadless;
        this.captchaDetector = new CaptchaDetector();
        this.launchOptions = launchOptions;
    }
    async launch() {
        const headlessMode = this.isHeadless;
        logger.info(`🚀 启动浏览器 (${headlessMode ? '无头' : '有头'}模式)...`);
        const options = {
            ...this.launchOptions,
            headless: headlessMode,
            args: [
                ...(this.launchOptions.args || []),
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        };
        this.browser = await chromium.launch({
            ...options,
            executablePath: resolveChromiumExecutablePath(options.executablePath),
        });
        this.context = await this.browser.newContext();
        logger.info('✅ 浏览器启动成功');
        return this.browser;
    }
    async newPage() {
        if (!this.browser) {
            await this.launch();
        }
        const page = await this.context.newPage();
        this.currentPage = page;
        await this.injectAntiDetectionScripts(page);
        if (this.sessionData.cookies && this.sessionData.cookies.length > 0) {
            await page.context().addCookies(this.sessionData.cookies);
        }
        return page;
    }
    async goto(url, page) {
        const targetPage = page || this.currentPage;
        if (!targetPage) {
            throw new Error('No page available. Call newPage() first.');
        }
        logger.info(`🌐 导航到: ${url}`);
        await targetPage.goto(url, { waitUntil: 'networkidle' });
        if (this.config.autoDetectCaptcha) {
            await this.checkAndHandleCaptcha(targetPage, url);
        }
        return targetPage;
    }
    async checkAndHandleCaptcha(page, originalUrl) {
        const captchaResult = await this.captchaDetector.detect(page);
        if (captchaResult.detected) {
            logger.warn(`⚠️ 检测到验证码 (类型: ${captchaResult.type}, 置信度: ${captchaResult.confidence}%)`);
            if (captchaResult.vendor) {
                logger.warn(`   厂商: ${captchaResult.vendor}`);
            }
            if (this.config.autoSwitchHeadless && this.isHeadless) {
                await this.switchToHeaded(page, originalUrl, captchaResult);
            }
            else {
                logger.info('💡 提示: 请手动完成验证码');
                await this.captchaDetector.waitForCompletion(page, this.config.captchaTimeout);
            }
        }
    }
    async switchToHeaded(currentPage, url, captchaInfo) {
        logger.info('🔄 切换到有头模式以完成验证码...');
        await this.saveSessionData(currentPage);
        await this.browser?.close();
        this.isHeadless = false;
        await this.launch();
        const newPage = await this.newPage();
        await newPage.goto(url, { waitUntil: 'networkidle' });
        this.showCaptchaPrompt(captchaInfo);
        const completed = await this.captchaDetector.waitForCompletion(newPage, this.config.captchaTimeout);
        if (completed) {
            logger.info('✅ 验证完成，继续执行...');
            if (this.config.askBeforeSwitchBack && this.config.defaultHeadless) {
                logger.info('💡 保持有头模式，方便后续操作');
            }
        }
        else {
            logger.error('❌ 验证码完成超时');
            throw new Error('Captcha completion timeout');
        }
    }
    showCaptchaPrompt(captchaInfo) {
        console.log('\n' + '='.repeat(60));
        console.log('⚠️  检测到验证码，请手动完成验证');
        console.log('='.repeat(60));
        console.log(`类型: ${captchaInfo.type}`);
        if (captchaInfo.vendor) {
            console.log(`厂商: ${captchaInfo.vendor}`);
        }
        console.log(`置信度: ${captchaInfo.confidence}%`);
        console.log('\n💡 提示:');
        console.log('   1. 浏览器窗口已自动打开');
        console.log('   2. 请在浏览器中完成验证码');
        console.log('   3. 验证完成后，脚本将自动继续执行');
        console.log('   4. 超时时间: ' + (this.config.captchaTimeout / 1000) + '秒');
        console.log('='.repeat(60) + '\n');
    }
    async saveSessionData(page) {
        try {
            this.sessionData.cookies = await page.context().cookies();
            const storageData = await page.evaluate(() => {
                const local = {};
                const session = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key) {
                        local[key] = localStorage.getItem(key) || '';
                    }
                }
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key) {
                        session[key] = sessionStorage.getItem(key) || '';
                    }
                }
                return { local, session };
            });
            this.sessionData.localStorage = storageData.local;
            this.sessionData.sessionStorage = storageData.session;
            logger.info('💾 会话数据已保存');
        }
        catch (error) {
            logger.error('保存会话数据失败', error);
        }
    }
    async injectAntiDetectionScripts(page) {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
            window.chrome = {
                runtime: {
                    connect: () => { },
                    sendMessage: () => { },
                    onMessage: {
                        addListener: () => { },
                        removeListener: () => { },
                    },
                },
                loadTimes: function () {
                    return {
                        commitLoadTime: Date.now() / 1000,
                        connectionInfo: 'http/1.1',
                        finishDocumentLoadTime: Date.now() / 1000,
                        finishLoadTime: Date.now() / 1000,
                        firstPaintAfterLoadTime: 0,
                        firstPaintTime: Date.now() / 1000,
                        navigationType: 'Other',
                        npnNegotiatedProtocol: 'unknown',
                        requestTime: 0,
                        startLoadTime: Date.now() / 1000,
                        wasAlternateProtocolAvailable: false,
                        wasFetchedViaSpdy: false,
                        wasNpnNegotiated: false,
                    };
                },
                csi: function () {
                    return {
                        onloadT: Date.now(),
                        pageT: Date.now(),
                        startE: Date.now(),
                        tran: 15,
                    };
                },
            };
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    {
                        0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                        description: 'Portable Document Format',
                        filename: 'internal-pdf-viewer',
                        length: 1,
                        name: 'Chrome PDF Plugin',
                    },
                    {
                        0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' },
                        description: '',
                        filename: 'internal-pdf-viewer',
                        length: 1,
                        name: 'Chrome PDF Viewer',
                    },
                    {
                        0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
                        1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
                        description: '',
                        filename: 'internal-nacl-plugin',
                        length: 2,
                        name: 'Native Client',
                    },
                ],
            });
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
        });
        logger.info('🛡️ 反检测脚本已注入');
    }
    async close() {
        if (this.browser) {
            await this.context?.close();
            this.context = null;
            await this.browser.close();
            this.browser = null;
            this.currentPage = null;
            logger.info('🔒 浏览器已关闭');
        }
    }
    getBrowser() {
        return this.browser;
    }
    getCurrentPage() {
        return this.currentPage;
    }
    isHeadlessMode() {
        return this.isHeadless;
    }
}
//# sourceMappingURL=BrowserModeManager.js.map
