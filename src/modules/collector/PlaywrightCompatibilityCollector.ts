// @ts-nocheck

import { BrowserPool } from '../../services/BrowserPool.js';
import { logger } from '../../utils/logger.js';
import { applyBasicNavigatorStealthInit } from '../stealth/basicNavigatorStealth.js';

export class PlaywrightCompatibilityCollector {
  sessionId;
  browserPool;
  userAgent;
  viewport;
  initialized = false;

  constructor(options) {
    this.sessionId = options.sessionId;
    this.browserPool = options.browserPool;
    this.userAgent = options.userAgent;
    this.viewport = options.viewport;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    await this.browserPool.init();
    const page = await this.browserPool.ensureSessionPage(this.sessionId, 'inspect');
    await page.setUserAgent(this.userAgent);
    await this.applyAntiDetection(page);
    this.initialized = true;
  }

  async close() {
    await this.browserPool.closeSession(this.sessionId);
    this.initialized = false;
  }

  async getActivePage() {
    await this.init();
    return this.browserPool.ensureSessionPage(this.sessionId, 'inspect');
  }

  async createPage(url) {
    await this.browserPool.closeSession(this.sessionId);
    const page = await this.browserPool.ensureSessionPage(this.sessionId, 'collect');
    await page.setUserAgent(this.userAgent);
    await this.applyAntiDetection(page);
    if (url) {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }
    return page;
  }

  async getStatus() {
    const stats = this.browserPool.getStats();
    const version = await this.browserPool.getBrowserVersion();
    return {
      running: Boolean(this.browserPool.getBrowser()),
      pagesCount: stats.activePages,
      contextsCount: stats.activeContexts,
      maxContexts: stats.maxContexts,
      version,
    };
  }

  getBrowser() {
    return this.browserPool.getBrowser();
  }

  async applyAntiDetection(page) {
    await page.evaluateOnNewDocument(applyBasicNavigatorStealthInit, {
      flagName: 'playwrightCollectorApplied',
      webdriverMode: 'false',
      pluginsMode: 'simple',
      languages: ['en-US', 'en'],
      notificationState: 'denied',
    });
    logger.info('Playwright anti-detection scripts installed');
  }
}
