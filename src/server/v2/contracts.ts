export type SessionHealth = 'ready' | 'degraded' | 'recovering' | 'closed';

export type WaitProfile = 'interactive' | 'network-quiet' | 'spa' | 'streaming';

export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

export type ScriptSearchMode = 'indexed' | 'substring' | 'regex';

export type ScriptIndexPolicy = 'metadata-only' | 'hot-sources' | 'deep';

export interface SessionFailure {
  code: string;
  message: string;
  recoverable: boolean;
  timestamp: string;
}

export interface EngineCapabilities {
  scriptSearch: boolean;
  functionTree: boolean;
  debugger: boolean;
  sourceMaps: boolean;
  runtimeEval: boolean;
  recovery: boolean;
}

export interface NavigationAttempt {
  waitUntil: BrowserWaitUntil;
  timeout?: number;
}

export interface NavigationDiagnostic {
  waitUntil: BrowserWaitUntil;
  timeout?: number;
  ok: boolean;
  message: string;
}

export interface NavigationPlan {
  waitProfile: WaitProfile;
  attempts: NavigationAttempt[];
}

export interface SessionSnapshot {
  url?: string;
  cookies?: Array<Record<string, unknown>>;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  initScripts?: string[];
  runtimeScripts?: string[];
  capturedAt?: string;
}

export interface ScriptChunk {
  scriptId: string;
  chunkIndex: number;
  chunkRef: string;
  content: string;
  size: number;
}

export interface ScriptInventoryEntry {
  scriptId: string;
  url: string;
  source?: string;
  sourceLength?: number;
  sourceLoadedAt?: string;
}

export interface SiteProfile {
  origin?: string;
  totalScripts: number;
  inlineScripts: number;
  externalScripts: number;
  indexedScripts: number;
  chunkCount: number;
  largeScripts: number;
}

export interface ManifestBudgets {
  maxScripts: number;
  maxBytes: number;
  maxRequests: number;
}
