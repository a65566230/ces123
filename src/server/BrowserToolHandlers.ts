// @ts-nocheck

import { AICaptchaDetector } from '../modules/captcha/AICaptchaDetector.js';
import { StealthScripts2025 } from '../modules/stealth/StealthScripts2025.js';
import { DetailedDataManager } from '../utils/detailedDataManager.js';
import { logger } from '../utils/logger.js';
export class BrowserToolHandlers {
    collector;
    pageController;
    domInspector;
    scriptManager;
    consoleMonitor;
    captchaDetector;
    autoDetectCaptcha = true;
    autoSwitchHeadless = true;
    captchaTimeout = 300000;
    detailedDataManager;
    constructor(collector, pageController, domInspector, scriptManager, consoleMonitor, llmService) {
        this.collector = collector;
        this.pageController = pageController;
        this.domInspector = domInspector;
        this.scriptManager = scriptManager;
        this.consoleMonitor = consoleMonitor;
        const screenshotDir = process.env.CAPTCHA_SCREENSHOT_DIR || './screenshots';
        this.captchaDetector = new AICaptchaDetector(llmService, screenshotDir);
        this.detailedDataManager = DetailedDataManager.getInstance();
    }
    async handleGetDetailedData(args) {
        try {
            const detailId = args.detailId;
            const path = args.path;
            const data = this.detailedDataManager.retrieve(detailId, path);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            detailId,
                            path: path || 'full',
                            data,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to get detailed data:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                            hint: 'DetailId may have expired (TTL: 10 minutes) or is invalid',
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleBrowserLaunch(_args) {
        await this.collector.init();
        const status = await this.collector.getStatus();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Browser launched successfully',
                        status,
                    }, null, 2),
                }],
        };
    }
    async handleBrowserClose(_args) {
        await this.collector.close();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Browser closed successfully',
                    }, null, 2),
                }],
        };
    }
    async handleBrowserStatus(_args) {
        const status = await this.collector.getStatus();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(status, null, 2),
                }],
        };
    }
    async handlePageNavigate(args) {
        const url = args.url;
        const waitUntil = args.waitUntil;
        const timeout = args.timeout;
        const enableNetworkMonitoring = args.enableNetworkMonitoring;
        let networkMonitoringEnabled = false;
        if (enableNetworkMonitoring) {
            if (!this.consoleMonitor.isNetworkEnabled()) {
                try {
                    await this.consoleMonitor.enable({
                        enableNetwork: true,
                        enableExceptions: true,
                    });
                    networkMonitoringEnabled = true;
                    logger.info('✅ Network monitoring auto-enabled before navigation');
                }
                catch (error) {
                    logger.warn('Failed to auto-enable network monitoring:', error);
                }
            }
            else {
                networkMonitoringEnabled = true;
                logger.info('✅ Network monitoring already enabled');
            }
        }
        await this.pageController.navigate(url, { waitUntil, timeout });
        if (this.autoDetectCaptcha) {
            const page = await this.pageController.getPage();
            if (page) {
                const captchaResult = await this.captchaDetector.detect(page);
                if (captchaResult.detected) {
                    logger.warn(`⚠️ 检测到验证码 (类型: ${captchaResult.type}, 置信度: ${captchaResult.confidence}%)`);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    success: true,
                                    captcha_detected: true,
                                    captcha_info: captchaResult,
                                    url: await this.pageController.getURL(),
                                    title: await this.pageController.getTitle(),
                                    message: '检测到验证码，请使用 captcha_handle 工具处理或手动完成验证',
                                    network_monitoring_enabled: networkMonitoringEnabled,
                                }, null, 2),
                            }],
                    };
                }
            }
        }
        const currentUrl = await this.pageController.getURL();
        const title = await this.pageController.getTitle();
        const result = {
            success: true,
            captcha_detected: false,
            url: currentUrl,
            title,
        };
        if (networkMonitoringEnabled) {
            const networkStatus = this.consoleMonitor.getNetworkStatus();
            result.network_monitoring = {
                enabled: true,
                auto_enabled: true,
                message: '✅ Network monitoring is active. Use network_get_requests to retrieve captured requests.',
                requestCount: networkStatus.requestCount,
                responseCount: networkStatus.responseCount,
            };
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handlePageReload(_args) {
        await this.pageController.reload();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Page reloaded',
                    }, null, 2),
                }],
        };
    }
    async handlePageBack(_args) {
        await this.pageController.goBack();
        const url = await this.pageController.getURL();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        url,
                    }, null, 2),
                }],
        };
    }
    async handlePageForward(_args) {
        await this.pageController.goForward();
        const url = await this.pageController.getURL();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        url,
                    }, null, 2),
                }],
        };
    }
    async handleDOMQuerySelector(args) {
        const selector = args.selector;
        const getAttributes = args.getAttributes ?? true;
        const element = await this.domInspector.querySelector(selector, getAttributes);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(element, null, 2),
                }],
        };
    }
    async handleDOMQueryAll(args) {
        const selector = args.selector;
        const limit = args.limit ?? 100;
        const elements = await this.domInspector.querySelectorAll(selector, limit);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: elements.length,
                        elements,
                    }, null, 2),
                }],
        };
    }
    async handleDOMGetStructure(args) {
        const maxDepth = args.maxDepth ?? 3;
        const includeText = args.includeText ?? true;
        const structure = await this.domInspector.getStructure(maxDepth, includeText);
        const processedStructure = this.detailedDataManager.smartHandle(structure, 51200);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(processedStructure, null, 2),
                },
            ],
        };
    }
    async handleDOMFindClickable(args) {
        const filterText = args.filterText;
        const clickable = await this.domInspector.findClickable(filterText);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: clickable.length,
                        elements: clickable,
                    }, null, 2),
                }],
        };
    }
    async handlePageClick(args) {
        const selector = args.selector;
        const button = args.button;
        const clickCount = args.clickCount;
        const delay = args.delay;
        await this.pageController.click(selector, { button, clickCount, delay });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Clicked: ${selector}`,
                    }, null, 2),
                }],
        };
    }
    async handlePageType(args) {
        const selector = args.selector;
        const text = args.text;
        const delay = args.delay;
        await this.pageController.type(selector, text, { delay });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Typed into ${selector}`,
                    }, null, 2),
                }],
        };
    }
    async handlePageSelect(args) {
        const selector = args.selector;
        const values = args.values;
        await this.pageController.select(selector, ...values);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Selected in ${selector}: ${values.join(', ')}`,
                    }, null, 2),
                }],
        };
    }
    async handlePageHover(args) {
        const selector = args.selector;
        await this.pageController.hover(selector);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Hovered: ${selector}`,
                    }, null, 2),
                }],
        };
    }
    async handlePageScroll(args) {
        const x = args.x;
        const y = args.y;
        await this.pageController.scroll({ x, y });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Scrolled to: x=${x || 0}, y=${y || 0}`,
                    }, null, 2),
                }],
        };
    }
    async handlePageWaitForSelector(args) {
        const selector = args.selector;
        const timeout = args.timeout;
        const result = await this.pageController.waitForSelector(selector, timeout);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
        };
    }
    async handlePageEvaluate(args) {
        const code = args.code;
        const autoSummarize = args.autoSummarize ?? true;
        const maxSize = args.maxSize ?? 51200;
        const result = await this.pageController.evaluate(code);
        const processedResult = autoSummarize
            ? this.detailedDataManager.smartHandle(result, maxSize)
            : result;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        result: processedResult,
                    }, null, 2),
                },
            ],
        };
    }
    async handlePageScreenshot(args) {
        const path = args.path;
        const type = args.type;
        const quality = args.quality;
        const fullPage = args.fullPage;
        const buffer = await this.pageController.screenshot({ path, type, quality, fullPage });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Screenshot taken${path ? `: ${path}` : ''}`,
                        size: buffer.length,
                    }, null, 2),
                }],
        };
    }
    async handleGetAllScripts(args) {
        const includeSource = args.includeSource ?? false;
        const scripts = await this.scriptManager.getAllScripts(includeSource);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: scripts.length,
                        scripts,
                    }, null, 2),
                }],
        };
    }
    async handleGetScriptSource(args) {
        const scriptId = args.scriptId;
        const url = args.url;
        const preview = args.preview ?? false;
        const maxLines = args.maxLines ?? 100;
        const startLine = args.startLine;
        const endLine = args.endLine;
        const script = await this.scriptManager.getScriptSource(scriptId, url);
        if (!script) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            message: 'Script not found',
                        }, null, 2),
                    },
                ],
            };
        }
        if (preview || startLine !== undefined || endLine !== undefined) {
            const source = script.source || '';
            const lines = source.split('\n');
            const totalLines = lines.length;
            const size = source.length;
            let previewContent;
            let actualStartLine;
            let actualEndLine;
            if (startLine !== undefined && endLine !== undefined) {
                actualStartLine = Math.max(1, startLine);
                actualEndLine = Math.min(totalLines, endLine);
                previewContent = lines.slice(actualStartLine - 1, actualEndLine).join('\n');
            }
            else {
                actualStartLine = 1;
                actualEndLine = Math.min(maxLines, totalLines);
                previewContent = lines.slice(0, maxLines).join('\n');
            }
            const result = {
                success: true,
                scriptId: script.scriptId,
                url: script.url,
                preview: true,
                totalLines,
                size,
                sizeKB: (size / 1024).toFixed(1) + 'KB',
                showingLines: `${actualStartLine}-${actualEndLine}`,
                content: previewContent,
                hint: size > 51200
                    ? `⚠️ Script is large (${(size / 1024).toFixed(1)}KB). Use startLine/endLine to get specific sections, or set preview=false to get full source (will return detailId).`
                    : 'Set preview=false to get full source',
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        const processedScript = this.detailedDataManager.smartHandle(script, 51200);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(processedScript, null, 2),
                },
            ],
        };
    }
    async handleConsoleEnable(_args) {
        await this.consoleMonitor.enable();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Console monitoring enabled',
                    }, null, 2),
                }],
        };
    }
    async handleConsoleGetLogs(args) {
        const type = args.type;
        const limit = args.limit;
        const since = args.since;
        const logs = this.consoleMonitor.getLogs({ type, limit, since });
        const result = {
            count: logs.length,
            logs,
        };
        const processedResult = this.detailedDataManager.smartHandle(result, 51200);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(processedResult, null, 2),
                },
            ],
        };
    }
    async handleConsoleExecute(args) {
        const expression = args.expression;
        const result = await this.consoleMonitor.execute(expression);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        result,
                    }, null, 2),
                }],
        };
    }
    async handleDOMGetComputedStyle(args) {
        const selector = args.selector;
        const styles = await this.domInspector.getComputedStyle(selector);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        selector,
                        styles,
                    }, null, 2),
                }],
        };
    }
    async handleDOMFindByText(args) {
        const text = args.text;
        const tag = args.tag;
        const elements = await this.domInspector.findByText(text, tag);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: elements.length,
                        elements,
                    }, null, 2),
                }],
        };
    }
    async handleDOMGetXPath(args) {
        const selector = args.selector;
        const xpath = await this.domInspector.getXPath(selector);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        selector,
                        xpath,
                    }, null, 2),
                }],
        };
    }
    async handleDOMIsInViewport(args) {
        const selector = args.selector;
        const inViewport = await this.domInspector.isInViewport(selector);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        selector,
                        inViewport,
                    }, null, 2),
                }],
        };
    }
    async handlePageGetPerformance(_args) {
        const metrics = await this.pageController.getPerformanceMetrics();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        metrics,
                    }, null, 2),
                }],
        };
    }
    async handlePageInjectScript(args) {
        const script = args.script;
        await this.pageController.injectScript(script);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Script injected',
                    }, null, 2),
                }],
        };
    }
    async handlePageSetCookies(args) {
        const cookies = args.cookies;
        await this.pageController.setCookies(cookies);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: `Set ${cookies.length} cookies`,
                    }, null, 2),
                }],
        };
    }
    async handlePageGetCookies(_args) {
        const cookies = await this.pageController.getCookies();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: cookies.length,
                        cookies,
                    }, null, 2),
                }],
        };
    }
    async handlePageClearCookies(_args) {
        await this.pageController.clearCookies();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: 'Cookies cleared',
                    }, null, 2),
                }],
        };
    }
    async handlePageSetViewport(args) {
        const width = args.width;
        const height = args.height;
        await this.pageController.setViewport(width, height);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        viewport: { width, height },
                    }, null, 2),
                }],
        };
    }
    async handlePageEmulateDevice(args) {
        const device = args.device;
        await this.pageController.emulateDevice(device);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        device,
                    }, null, 2),
                }],
        };
    }
    async handlePageGetLocalStorage(_args) {
        const storage = await this.pageController.getLocalStorage();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: Object.keys(storage).length,
                        storage,
                    }, null, 2),
                }],
        };
    }
    async handlePageSetLocalStorage(args) {
        const key = args.key;
        const value = args.value;
        await this.pageController.setLocalStorage(key, value);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        key,
                    }, null, 2),
                }],
        };
    }
    async handlePagePressKey(args) {
        const key = args.key;
        await this.pageController.pressKey(key);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        key,
                    }, null, 2),
                }],
        };
    }
    async handlePageGetAllLinks(_args) {
        const links = await this.pageController.getAllLinks();
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: links.length,
                        links,
                    }, null, 2),
                }],
        };
    }
    async handleCaptchaDetect(_args) {
        const page = await this.pageController.getPage();
        const result = await this.captchaDetector.detect(page);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        captcha_detected: result.detected,
                        captcha_info: result,
                    }, null, 2),
                }],
        };
    }
    async handleCaptchaWait(args) {
        const timeout = args.timeout || this.captchaTimeout;
        const page = await this.pageController.getPage();
        logger.info('⏳ 等待用户完成验证码...');
        const completed = await this.captchaDetector.waitForCompletion(page, timeout);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: completed,
                        message: completed ? '✅ 验证码已完成' : '❌ 验证码完成超时',
                    }, null, 2),
                }],
        };
    }
    async handleCaptchaConfig(args) {
        if (args.autoDetectCaptcha !== undefined) {
            this.autoDetectCaptcha = args.autoDetectCaptcha;
        }
        if (args.autoSwitchHeadless !== undefined) {
            this.autoSwitchHeadless = args.autoSwitchHeadless;
        }
        if (args.captchaTimeout !== undefined) {
            this.captchaTimeout = args.captchaTimeout;
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        config: {
                            autoDetectCaptcha: this.autoDetectCaptcha,
                            autoSwitchHeadless: this.autoSwitchHeadless,
                            captchaTimeout: this.captchaTimeout,
                        },
                    }, null, 2),
                }],
        };
    }
    async handleStealthInject(_args) {
        const page = await this.pageController.getPage();
        await StealthScripts2025.injectAll(page);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: '🛡️ 反检测脚本已注入',
                    }, null, 2),
                }],
        };
    }
    async handleStealthSetUserAgent(args) {
        const platform = args.platform || 'windows';
        const page = await this.pageController.getPage();
        await StealthScripts2025.setRealisticUserAgent(page, platform);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        platform,
                        message: `User-Agent已设置为${platform}平台`,
                    }, null, 2),
                }],
        };
    }
}
//# sourceMappingURL=BrowserToolHandlers.js.map