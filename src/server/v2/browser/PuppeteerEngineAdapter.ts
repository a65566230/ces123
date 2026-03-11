// @ts-nocheck

export class PuppeteerEngineAdapter {
  collector;
  pageController;
  scriptManager;
  consoleMonitor;
  type = 'puppeteer';
  persistentScripts = [];
  runtimeScripts = [];
  health = 'ready';
  recoverable = true;
  lastFailure = null;

  constructor(collector, pageController, scriptManager, consoleMonitor) {
    this.collector = collector;
    this.pageController = pageController;
    this.scriptManager = scriptManager;
    this.consoleMonitor = consoleMonitor;
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

  async installPageListeners() {
    const page = await this.pageController.getPage();
    if (page.__jshookListenersInstalled) {
      return;
    }

    page.__jshookListenersInstalled = true;
    page.on('close', () => {
      this.markFailure('page-closed', new Error('Puppeteer page closed'), true);
    });
    page.on('error', (error) => {
      this.markFailure('page-error', error, true);
    });
  }

  async launch() {
    await this.collector.init();
    const browser = this.collector.getBrowser();
    if (browser && !browser.__jshookDisconnectionListenerInstalled) {
      browser.__jshookDisconnectionListenerInstalled = true;
      browser.on('disconnected', () => {
        this.markFailure('browser-disconnected', new Error('Puppeteer browser disconnected'), true);
      });
    }
    await this.installPageListeners();
    this.health = 'ready';
  }

  async attach(_target) {
    await this.launch();
  }

  async newPage(url) {
    await this.collector.createPage(url);
    await this.installPageListeners();
  }

  async navigate(url, options) {
    await this.scriptManager.init();
    try {
      const result = await this.pageController.navigate(url, options);
      this.health = 'ready';
      return result;
    } catch (error) {
      this.markFailure('navigation-failed', error, true);
      throw error;
    }
  }

  async getScripts(options) {
    await this.scriptManager.init();
    const scripts = await this.scriptManager.getAllScripts(options?.includeSource ?? false, options?.maxScripts ?? 250);
    if (scripts.length === 0) {
      return this.getScriptsFromDom(options);
    }
    return scripts.map((script) => ({
      scriptId: script.scriptId,
      url: script.url,
      source: script.source,
      sourceLength: script.sourceLength,
    }));
  }

  async inspectRuntime(expression) {
    return this.consoleMonitor.execute(expression);
  }

  async collectNetwork(options) {
    await this.consoleMonitor.enable({
      enableNetwork: true,
      enableExceptions: true,
    });
    const requests = this.consoleMonitor.getNetworkRequests(options);
    const responses = this.consoleMonitor.getNetworkResponses({
      url: options?.url,
      limit: options?.limit,
    });
    const stats = this.consoleMonitor.getNetworkStats();
    const exceptions = this.consoleMonitor.getExceptions({
      limit: options?.limit,
    });
    if (options?.requestId) {
      const body = await this.consoleMonitor.getResponseBody(options.requestId);
      return {
        requests,
        responses,
        exceptions,
        stats: {
          ...stats,
          responseBody: body,
        },
      };
    }
    return {
      requests,
      responses,
      exceptions,
      stats,
    };
  }

  async injectHook(code, options) {
    const page = await this.pageController.getPage();
    if (options?.onNewDocument) {
      this.persistentScripts.push(code);
      await page.evaluateOnNewDocument(code);
      return;
    }
    this.runtimeScripts.push(code);
    await page.evaluate(code);
  }

  async captureSnapshot(previousSnapshot) {
    try {
      const page = await this.pageController.getPage();
      const [cookies, storage] = await Promise.all([
        page.cookies(),
        page.evaluate(() => {
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
        }),
      ]);

      return {
        url: page.url(),
        cookies,
        localStorage: storage.localStorageEntries,
        sessionStorage: storage.sessionStorageEntries,
        viewport: storage.viewport,
        userAgent: storage.userAgent,
        initScripts: [...this.persistentScripts],
        runtimeScripts: [...this.runtimeScripts],
        capturedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.markFailure('snapshot-capture-failed', error, true);
      return previousSnapshot || {
        initScripts: [...this.persistentScripts],
        runtimeScripts: [...this.runtimeScripts],
      };
    }
  }

  async restoreSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    await this.launch();
    this.persistentScripts = [...(snapshot.initScripts || [])];
    this.runtimeScripts = [...(snapshot.runtimeScripts || [])];

    const page = await this.pageController.getPage();
    for (const script of this.persistentScripts) {
      await page.evaluateOnNewDocument(script);
    }

    if (snapshot.cookies?.length) {
      await page.setCookie(...snapshot.cookies);
    }

    if (snapshot.url) {
      await this.navigate(snapshot.url, {
        waitProfile: 'interactive',
        timeout: 15_000,
      });
    }

    if (snapshot.localStorage || snapshot.sessionStorage) {
      await page.evaluate((payload) => {
        Object.entries(payload.localStorage || {}).forEach(([key, value]) => {
          localStorage.setItem(key, String(value));
        });
        Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => {
          sessionStorage.setItem(key, String(value));
        });
      }, snapshot);
    }

    for (const script of this.runtimeScripts) {
      await page.evaluate(script);
    }

    this.health = 'ready';
  }

  async getStatus() {
    const status = await this.collector.getStatus();
    return {
      ...status,
      network: this.consoleMonitor.getNetworkStatus(),
      health: this.health,
      recoverable: this.recoverable,
      lastFailure: this.lastFailure,
    };
  }

  async close() {
    await this.collector.close();
    this.health = 'closed';
  }

  async getScriptsFromDom(options) {
    const page = await this.pageController.getPage();
    const includeSource = options?.includeSource ?? false;
    const maxScripts = options?.maxScripts ?? 250;
    const scripts = await page.evaluate(
      async ({ shouldIncludeSource, limit }) => {
        const nodes = Array.from(document.scripts).slice(0, limit);
        return Promise.all(
          nodes.map(async (script, index) => {
            const resolvedUrl = script.src ? new URL(script.src, window.location.href).toString() : `inline:${index}`;
            let source;
            if (shouldIncludeSource) {
              if (script.src) {
                try {
                  const response = await fetch(resolvedUrl);
                  source = response.ok ? await response.text() : undefined;
                } catch {
                  source = undefined;
                }
              } else {
                source = script.textContent || undefined;
              }
            }
            return {
              scriptId: `dom_script_${index}`,
              url: resolvedUrl,
              source,
              sourceLength: source?.length,
            };
          })
        );
      },
      { shouldIncludeSource: includeSource, limit: maxScripts }
    );
    return scripts;
  }
}
