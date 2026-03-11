import { chromium } from 'playwright-core';
import { resolveChromiumExecutablePath } from '../utils/resolveChromiumExecutablePath.js';

export interface BrowserPoolOptions {
  headless: boolean;
  maxContexts?: number;
  executablePath?: string;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  launchArgs?: string[];
}

export interface BrowserPoolAcquireOptions {
  sessionId: string;
  purpose: 'collect' | 'inspect' | 'debug' | 'hook' | 'default';
  persistent?: boolean;
}

export interface BrowserPoolLease {
  sessionId: string;
  purpose: string;
  page: PlaywrightPageFacade;
  release(): Promise<void>;
}

interface SessionHandle {
  sessionId: string;
  context: import('playwright-core').BrowserContext;
  page: import('playwright-core').Page;
  facade: PlaywrightPageFacade;
  purpose: string;
  persistent: boolean;
  acquiredAt: number;
  lastUsedAt: number;
}

class PlaywrightElementHandleFacade {
  private readonly handle: import('playwright-core').ElementHandle<HTMLElement | SVGElement>;

  public constructor(handle: import('playwright-core').ElementHandle<HTMLElement | SVGElement>) {
    this.handle = handle;
  }

  public async uploadFile(filePath: string): Promise<void> {
    await this.handle.setInputFiles(filePath);
  }
}

export class PlaywrightPageFacade {
  private readonly page: import('playwright-core').Page;
  private readonly context: import('playwright-core').BrowserContext;
  private readonly pool: BrowserPool;
  private readonly sessionId: string;

  public readonly keyboard: import('playwright-core').Keyboard;

  public constructor(
    page: import('playwright-core').Page,
    context: import('playwright-core').BrowserContext,
    pool: BrowserPool,
    sessionId: string,
  ) {
    this.page = page;
    this.context = context;
    this.pool = pool;
    this.sessionId = sessionId;
    this.keyboard = page.keyboard;
  }

  public on(eventName: string, listener: (...args: unknown[]) => void): void {
    this.page.on(eventName as never, listener as never);
  }

  public off(eventName: string, listener: (...args: unknown[]) => void): void {
    this.page.off(eventName as never, listener as never);
  }

  public async goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown> {
    return this.page.goto(url, {
      waitUntil: this.normalizeWaitUntil(options?.waitUntil),
      timeout: options?.timeout,
    });
  }

  public async reload(options?: { waitUntil?: string; timeout?: number }): Promise<unknown> {
    return this.page.reload({
      waitUntil: this.normalizeWaitUntil(options?.waitUntil),
      timeout: options?.timeout,
    });
  }

  public async goBack(): Promise<unknown> {
    return this.page.goBack();
  }

  public async goForward(): Promise<unknown> {
    return this.page.goForward();
  }

  public async click(selector: string, options?: Record<string, unknown>): Promise<void> {
    await this.page.click(selector, options);
  }

  public async type(selector: string, text: string, options?: { delay?: number }): Promise<void> {
    await this.page.locator(selector).type(text, options);
  }

  public async select(selector: string, ...values: string[]): Promise<string[]> {
    return this.page.selectOption(selector, values);
  }

  public async hover(selector: string): Promise<void> {
    await this.page.hover(selector);
  }

  public async waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown> {
    return this.page.waitForSelector(selector, options);
  }

  public async waitForNavigation(options?: { waitUntil?: string; timeout?: number }): Promise<unknown> {
    return this.page.waitForNavigation({
      waitUntil: this.normalizeWaitUntil(options?.waitUntil),
      timeout: options?.timeout,
    });
  }

  public async waitForNetworkIdle(options?: { timeout?: number }): Promise<void> {
    await this.page.waitForLoadState('networkidle', {
      timeout: options?.timeout,
    });
  }

  public async evaluate<R>(pageFunction: ((...args: unknown[]) => R) | string, ...args: unknown[]): Promise<R> {
    if (typeof pageFunction === 'string') {
      return this.page.evaluate((expression) => {
        // eslint-disable-next-line no-eval
        return eval(expression) as R;
      }, pageFunction);
    }
    if (args.length <= 1) {
      return this.page.evaluate(pageFunction, args[0]);
    }
    const fnSource = pageFunction.toString();
    return this.page.evaluate(({ expressionSource, expressionArgs }) => {
      // eslint-disable-next-line no-eval
      const expression = eval(`(${expressionSource})`) as (...values: unknown[]) => R;
      return expression(...expressionArgs);
    }, {
      expressionSource: fnSource,
      expressionArgs: args,
    });
  }

  public async evaluateOnNewDocument(script: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<void> {
    await this.page.addInitScript(script as never, ...args as []);
    this.pool.registerInitScript(this.sessionId, script, args);
  }

  public async addInitScript(script: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<void> {
    await this.page.addInitScript(script as never, ...args as []);
    this.pool.registerInitScript(this.sessionId, script, args);
  }

  public async createCDPSession(): Promise<import('playwright-core').CDPSession> {
    return this.context.newCDPSession(this.page);
  }

  public async setUserAgent(userAgent: string): Promise<void> {
    if (!userAgent) {
      return;
    }
    this.pool.setSessionUserAgent(this.sessionId, userAgent);
    const cdp = await this.createCDPSession();
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent,
    });
  }

  public async setViewport(viewport: { width: number; height: number }): Promise<void> {
    this.pool.setSessionViewport(this.sessionId, viewport);
    await this.page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
  }

  public async setCookie(...cookies: Array<Record<string, unknown>>): Promise<void> {
    await this.context.addCookies(cookies as Array<any>);
  }

  public async cookies(): Promise<Array<Record<string, unknown>>> {
    return (await this.context.cookies()) as unknown as Array<Record<string, unknown>>;
  }

  public async deleteCookie(...cookies: Array<Record<string, unknown>>): Promise<void> {
    if (cookies.length === 0) {
      await this.context.clearCookies();
      return;
    }

    const expiredCookies = cookies.map((cookie) => ({
      ...cookie,
      expires: 0,
      value: '',
    }));
    await this.context.addCookies(expiredCookies as Array<any>);
  }

  public async title(): Promise<string> {
    return this.page.title();
  }

  public url(): string {
    return this.page.url();
  }

  public async content(): Promise<string> {
    return this.page.content();
  }

  public async screenshot(options?: Record<string, unknown>): Promise<Buffer> {
    return this.page.screenshot(options as never) as Promise<Buffer>;
  }

  public async $(selector: string): Promise<PlaywrightElementHandleFacade | null> {
    const handle = await this.page.$(selector);
    return handle ? new PlaywrightElementHandleFacade(handle as import('playwright-core').ElementHandle<HTMLElement | SVGElement>) : null;
  }

  public setDefaultTimeout(timeout: number): void {
    this.page.setDefaultTimeout(timeout);
  }

  public get raw(): import('playwright-core').Page {
    return this.page;
  }

  private normalizeWaitUntil(waitUntil?: string): 'load' | 'domcontentloaded' | 'networkidle' | 'commit' {
    if (waitUntil === 'domcontentloaded') {
      return 'domcontentloaded';
    }
    if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2' || waitUntil === 'networkidle') {
      return 'networkidle';
    }
    return 'load';
  }
}

export class BrowserPool {
  private readonly options: Required<BrowserPoolOptions>;
  private browser: import('playwright-core').Browser | null = null;
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly initScripts = new Map<string, Array<{ script: string | ((...args: unknown[]) => unknown); args: unknown[] }>>();
  private readonly sessionMetadata = new Map<string, { userAgent?: string; viewport?: { width: number; height: number } }>();

  public constructor(options: BrowserPoolOptions) {
    this.options = {
      headless: options.headless,
      maxContexts: options.maxContexts ?? 8,
      executablePath: options.executablePath ?? '',
      viewport: options.viewport ?? { width: 1440, height: 900 },
      userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      launchArgs: options.launchArgs ?? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--ignore-certificate-errors',
      ],
    };
  }

  public async init(): Promise<void> {
    if (this.browser) {
      return;
    }

    this.browser = await chromium.launch({
      headless: this.options.headless,
      executablePath: resolveChromiumExecutablePath(this.options.executablePath),
      args: this.options.launchArgs,
    });
  }

  public async acquire(options: BrowserPoolAcquireOptions): Promise<BrowserPoolLease> {
    await this.init();

    const handle = await this.ensureSessionHandle(options.sessionId, options.purpose, options.persistent === true);
    handle.lastUsedAt = Date.now();

    return {
      sessionId: handle.sessionId,
      purpose: handle.purpose,
      page: handle.facade,
      release: async () => {
        if (!handle.persistent) {
          await this.closeSession(handle.sessionId);
        }
      },
    };
  }

  public async ensureSessionPage(sessionId: string, purpose: BrowserPoolAcquireOptions['purpose'] = 'default'): Promise<PlaywrightPageFacade> {
    const handle = await this.ensureSessionHandle(sessionId, purpose, true);
    handle.lastUsedAt = Date.now();
    return handle.facade;
  }

  public async release(lease: { sessionId: string } | string): Promise<void> {
    const sessionId = typeof lease === 'string' ? lease : lease.sessionId;
    await this.closeSession(sessionId);
  }

  public async getSessionPage(sessionId: string): Promise<PlaywrightPageFacade | null> {
    const handle = this.sessions.get(sessionId);
    return handle?.facade ?? null;
  }

  public async closeSession(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      return;
    }

    await handle.page.close().catch(() => undefined);
    await handle.context.close().catch(() => undefined);
    this.sessions.delete(sessionId);
    this.initScripts.delete(sessionId);
    this.sessionMetadata.delete(sessionId);
  }

  public getStats(): { activeContexts: number; activePages: number; maxContexts: number } {
    return {
      activeContexts: this.sessions.size,
      activePages: Array.from(this.sessions.values()).filter((session) => !session.page.isClosed()).length,
      maxContexts: this.options.maxContexts,
    };
  }

  public getBrowser(): import('playwright-core').Browser | null {
    return this.browser;
  }

  public registerInitScript(sessionId: string, script: string | ((...args: unknown[]) => unknown), args: unknown[] = []): void {
    if (!this.initScripts.has(sessionId)) {
      this.initScripts.set(sessionId, []);
    }
    this.initScripts.get(sessionId)!.push({ script, args });
  }

  public setSessionUserAgent(sessionId: string, userAgent: string): void {
    const current = this.sessionMetadata.get(sessionId) ?? {};
    current.userAgent = userAgent;
    this.sessionMetadata.set(sessionId, current);
  }

  public setSessionViewport(sessionId: string, viewport: { width: number; height: number }): void {
    const current = this.sessionMetadata.get(sessionId) ?? {};
    current.viewport = viewport;
    this.sessionMetadata.set(sessionId, current);
  }

  public async getBrowserVersion(): Promise<string | null> {
    if (!this.browser) {
      return null;
    }
    return this.browser.version();
  }

  public async close(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }

    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  private async ensureSessionHandle(
    sessionId: string,
    purpose: BrowserPoolAcquireOptions['purpose'],
    persistent: boolean,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing && !existing.page.isClosed()) {
      existing.persistent = existing.persistent || persistent;
      existing.purpose = purpose;
      return existing;
    }

    if (this.sessions.size >= this.options.maxContexts) {
      const evictable = Array.from(this.sessions.values())
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (evictable) {
        await this.closeSession(evictable.sessionId);
      }
    }

    const metadata = this.sessionMetadata.get(sessionId);
    const context = await this.browser!.newContext({
      viewport: metadata?.viewport ?? this.options.viewport,
      userAgent: metadata?.userAgent ?? this.options.userAgent,
    });
    const page = await context.newPage();
    const facade = new PlaywrightPageFacade(page, context, this, sessionId);

    const scripts = this.initScripts.get(sessionId) ?? [];
    for (const item of scripts) {
      await page.addInitScript(item.script as never, ...item.args as []);
    }

    const handle: SessionHandle = {
      sessionId,
      context,
      page,
      facade,
      purpose,
      persistent,
      acquiredAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.sessions.set(sessionId, handle);
    return handle;
  }
}
