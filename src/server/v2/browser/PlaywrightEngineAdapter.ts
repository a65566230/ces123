// @ts-nocheck

import puppeteer from 'puppeteer';
import { buildNavigationPlan, toPlaywrightWaitUntil } from './navigation.js';

export class PlaywrightEngineAdapter {
  options;
  type = 'playwright';
  browser = null;
  context = null;
  page = null;
  requests = new Map();
  responses = new Map();
  requestCounter = 0;
  persistentScripts = [];
  runtimeScripts = [];
  health = 'ready';
  recoverable = true;
  lastFailure = null;

  constructor(options) {
    this.options = options;
  }

  markFailure(code, error, recoverable = true) {
    this.health = recoverable ? 'degraded' : 'closed';
    this.recoverable = recoverable;
    this.lastFailure = {
      code,
      message: error instanceof Error ? error.message : String(error),
      recoverable,
      timestamp: new Date().toISOString(),
    };
  }

  registerPageListeners(page) {
    page.on('close', () => {
      this.markFailure('page-closed', new Error('Playwright page closed'), true);
    });

    page.on('crash', () => {
      this.markFailure('page-crashed', new Error('Playwright page crashed'), true);
    });

    page.on('pageerror', (error) => {
      this.lastFailure = {
        code: 'page-error',
        message: error.message,
        recoverable: true,
        timestamp: new Date().toISOString(),
      };
    });
  }

  async launch() {
    if (this.browser) {
      return;
    }

    const { chromium } = await import('playwright-core');
    const executablePath = this.options.executablePath || puppeteer.executablePath();
    this.browser = await chromium.launch({
      headless: this.options.headless,
      executablePath,
    });
    this.browser.on('disconnected', () => {
      this.markFailure('browser-disconnected', new Error('Playwright browser disconnected'), true);
      this.browser = null;
    });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport,
      userAgent: this.options.userAgent,
    });
    await this.newPage();
    this.health = 'ready';
  }

  async attach(_target) {
    await this.launch();
  }

  async newPage(url) {
    if (!this.browser || !this.context) {
      await this.launch();
    }

    this.page = await this.context.newPage();
    this.registerPageListeners(this.page);
    this.page.on('request', (request) => {
      const requestId = `pw_req_${++this.requestCounter}`;
      this.requests.set(requestId, {
        requestId,
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: Date.now(),
      });
      request.__jshookRequestId = requestId;
    });
    this.page.on('response', async (response) => {
      const request = response.request();
      const requestId = request.__jshookRequestId || `pw_req_${++this.requestCounter}`;
      this.responses.set(requestId, {
        requestId,
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: await response.allHeaders(),
        mimeType: response.headers()['content-type'] || 'unknown',
        timestamp: Date.now(),
      });
    });

    for (const script of this.persistentScripts) {
      await this.page.addInitScript(script);
    }

    if (url) {
      await this.navigate(url);
    }
  }

  async navigate(url, options) {
    if (!this.page) {
      await this.newPage();
    }

    const plan = buildNavigationPlan(options || {});
    const diagnostics = [];
    const startTime = Date.now();
    let lastError = null;

    for (const attempt of plan.attempts) {
      try {
        await this.page.goto(url, {
          waitUntil: toPlaywrightWaitUntil(attempt.waitUntil),
          timeout: attempt.timeout,
        });
        const title = await this.page.title();
        this.health = 'ready';
        return {
          url: this.page.url(),
          title,
          loadTime: Date.now() - startTime,
          waitProfile: plan.waitProfile,
          waitUntil: attempt.waitUntil,
          navigationAttempts: diagnostics.length + 1,
          diagnostics,
        };
      } catch (error) {
        lastError = error;
        diagnostics.push({
          waitUntil: attempt.waitUntil,
          timeout: attempt.timeout,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.markFailure('navigation-failed', lastError || new Error('Navigation failed'), true);
    throw lastError || new Error('Navigation failed');
  }

  async getScripts(options) {
    if (!this.page) {
      await this.newPage();
    }

    const includeSource = options?.includeSource ?? false;
    const maxScripts = options?.maxScripts ?? 100;
    return this.page.evaluate(
      async ({ shouldIncludeSource, limit }) => {
        const scriptNodes = Array.from(document.scripts).slice(0, limit);
        const scripts = [];

        for (let index = 0; index < scriptNodes.length; index += 1) {
          const script = scriptNodes[index];
          const resolvedUrl = script.src ? new URL(script.src, window.location.href).toString() : `inline:${index}`;
          let source;

          if (shouldIncludeSource) {
            if (script.src) {
              try {
                source = await fetch(resolvedUrl).then((response) => response.text());
              } catch {
                source = undefined;
              }
            } else {
              source = script.textContent || undefined;
            }
          }

          scripts.push({
            scriptId: `pw_script_${index}`,
            url: resolvedUrl,
            source,
            sourceLength: source?.length,
          });
        }

        return scripts;
      },
      { shouldIncludeSource: includeSource, limit: maxScripts }
    );
  }

  async inspectRuntime(expression) {
    if (!this.page) {
      await this.newPage();
    }

    try {
      return await this.page.evaluate((runtimeExpression) => eval(runtimeExpression), expression);
    } catch (error) {
      this.markFailure('runtime-eval-failed', error, true);
      throw error;
    }
  }

  async collectNetwork(options) {
    let requests = Array.from(this.requests.values());
    let responses = Array.from(this.responses.values());

    if (options?.url) {
      requests = requests.filter((request) => request.url.includes(options.url));
      responses = responses.filter((response) => response.url.includes(options.url));
    }

    if (options?.method) {
      requests = requests.filter((request) => request.method === options.method);
    }

    if (options?.limit) {
      requests = requests.slice(-options.limit);
      responses = responses.slice(-options.limit);
    }

    return {
      requests,
      responses,
      stats: {
        totalRequests: this.requests.size,
        totalResponses: this.responses.size,
      },
    };
  }

  async injectHook(code, options) {
    if (!this.page) {
      await this.newPage();
    }

    if (options?.onNewDocument) {
      this.persistentScripts.push(code);
      await this.page.addInitScript(code);
      return;
    }

    this.runtimeScripts.push(code);
    await this.page.evaluate((runtimeCode) => {
      eval(runtimeCode);
    }, code);
  }

  async captureSnapshot(previousSnapshot) {
    if (!this.page) {
      return previousSnapshot || {
        initScripts: [...this.persistentScripts],
        runtimeScripts: [...this.runtimeScripts],
      };
    }

    const storage = await this.page.evaluate(() => {
      const localStorageEntries = {};
      const sessionStorageEntries = {};

      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) {
          localStorageEntries[key] = localStorage.getItem(key) || '';
        }
      }

      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key) {
          sessionStorageEntries[key] = sessionStorage.getItem(key) || '';
        }
      }

      return {
        localStorageEntries,
        sessionStorageEntries,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      };
    });

    return {
      url: this.page.url(),
      cookies: await this.context.cookies(),
      localStorage: storage.localStorageEntries,
      sessionStorage: storage.sessionStorageEntries,
      userAgent: storage.userAgent,
      viewport: storage.viewport,
      initScripts: [...this.persistentScripts],
      runtimeScripts: [...this.runtimeScripts],
      capturedAt: new Date().toISOString(),
    };
  }

  async restoreSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    await this.launch();
    this.persistentScripts = [...(snapshot.initScripts || [])];
    this.runtimeScripts = [...(snapshot.runtimeScripts || [])];

    if (!this.page) {
      await this.newPage();
    }

    if (snapshot.cookies?.length) {
      await this.context.addCookies(snapshot.cookies);
    }

    for (const script of this.persistentScripts) {
      await this.page.addInitScript(script);
    }

    if (snapshot.url) {
      await this.navigate(snapshot.url, {
        waitProfile: 'interactive',
        timeout: 15_000,
      });
    }

    if (snapshot.localStorage || snapshot.sessionStorage) {
      await this.page.evaluate((payload) => {
        Object.entries(payload.localStorage || {}).forEach(([key, value]) => {
          localStorage.setItem(key, String(value));
        });
        Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => {
          sessionStorage.setItem(key, String(value));
        });
      }, snapshot);
    }

    for (const script of this.runtimeScripts) {
      await this.page.evaluate((runtimeCode) => {
        eval(runtimeCode);
      }, script);
    }

    this.health = 'ready';
  }

  async getStatus() {
    return {
      launched: Boolean(this.browser),
      pageAvailable: Boolean(this.page),
      currentUrl: this.page?.url() || null,
      requestCount: this.requests.size,
      responseCount: this.responses.size,
      health: this.health,
      recoverable: this.recoverable,
      lastFailure: this.lastFailure,
    };
  }

  async close() {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
    this.health = 'closed';
  }
}
