// @ts-nocheck

import { BrowserPool } from '../../services/BrowserPool.js';
import { logger } from '../../utils/logger.js';

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
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          loadTimes() {},
          csi() {},
          app: {},
        };
      }
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'denied' });
        }
        return originalQuery(parameters);
      };
    });
    logger.info('Playwright anti-detection scripts installed');
  }
}
