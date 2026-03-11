import type { EngineCapabilities, NavigationDiagnostic, SessionSnapshot, SessionHealth } from '../contracts.js';

export interface BrowserEngineStatus {
  health: SessionHealth;
  recoverable: boolean;
  lastFailure?: {
    code: string;
    message: string;
    recoverable: boolean;
    timestamp: string;
  } | null;
  currentUrl?: string | null;
  pageAvailable?: boolean;
  launched?: boolean;
}

export interface BrowserEngineNavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  waitProfile?: 'interactive' | 'network-quiet' | 'spa' | 'streaming';
  timeout?: number;
}

export interface BrowserEngineNavigateResult {
  url: string;
  title: string;
  loadTime: number;
  waitProfile?: string;
  waitUntil?: string;
  navigationAttempts?: number;
  diagnostics?: NavigationDiagnostic[];
}

export interface BrowserEngineScript {
  scriptId: string;
  url: string;
  source?: string;
  sourceLength?: number;
}

export type BrowserEngineSnapshot = SessionSnapshot;

export interface BrowserEngine {
  type: 'puppeteer' | 'playwright';
  launch(): Promise<void>;
  attach(target?: string): Promise<void>;
  newPage(url?: string): Promise<void>;
  navigate(url: string, options?: BrowserEngineNavigateOptions): Promise<BrowserEngineNavigateResult>;
  getScripts(options?: { includeSource?: boolean; maxScripts?: number }): Promise<BrowserEngineScript[]>;
  inspectRuntime(expression: string): Promise<unknown>;
  collectNetwork(options?: Record<string, unknown>): Promise<unknown>;
  injectHook(code: string, options?: { onNewDocument?: boolean }): Promise<void>;
  captureSnapshot(previousSnapshot?: BrowserEngineSnapshot): Promise<BrowserEngineSnapshot>;
  restoreSnapshot(snapshot?: BrowserEngineSnapshot): Promise<void>;
  getStatus(): Promise<BrowserEngineStatus & { engineCapabilities?: EngineCapabilities }>;
  close(): Promise<void>;
}
