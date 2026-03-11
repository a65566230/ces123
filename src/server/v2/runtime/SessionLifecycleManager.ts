// @ts-nocheck

import { DOMInspector } from '../../../modules/collector/DOMInspector.js';
import { PageController } from '../../../modules/collector/PageController.js';
import { PlaywrightCompatibilityCollector } from '../../../modules/collector/PlaywrightCompatibilityCollector.js';
import { CodeAnalyzer } from '../../../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../../../modules/crypto/CryptoDetector.js';
import { DebuggerManager } from '../../../modules/debugger/DebuggerManager.js';
import { RuntimeInspector } from '../../../modules/debugger/RuntimeInspector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { AdvancedDeobfuscator } from '../../../modules/deobfuscator/AdvancedDeobfuscator.js';
import { Deobfuscator } from '../../../modules/deobfuscator/Deobfuscator.js';
import { HookManager } from '../../../modules/hook/HookManager.js';
import { AIHookGenerator } from '../../../modules/hook/AIHookGenerator.js';
import { HookRAG } from '../../../modules/hook/rag.js';
import { ConsoleMonitor } from '../../../modules/monitor/ConsoleMonitor.js';
import { LLMService } from '../../../services/LLMService.js';
import { logger } from '../../../utils/logger.js';
import { ObfuscationAnalysisService } from '../analysis/ObfuscationAnalysisService.js';
import { PlaywrightEngineAdapter } from '../browser/PlaywrightEngineAdapter.js';
import { SessionScriptInventory } from './SessionScriptInventory.js';

let sessionCounter = 0;

function nextSessionId() {
  sessionCounter += 1;
  return `session_${Date.now()}_${sessionCounter}`;
}

export class SessionLifecycleManager {
  config;
  options;
  storage;
  browserPool;
  sessions = new Map();

  constructor(config, options, storage, browserPool) {
    this.config = config;
    this.options = options;
    this.storage = storage;
    this.browserPool = browserPool;
  }

  resolveEngineChoice(engineType, reason = 'explicit-request') {
    return {
      engineType: 'playwright',
      autoEngine: engineType === 'auto',
      engineSelectionReason: engineType === 'auto'
        ? (reason === 'explicit-request' ? 'playwright-default' : reason)
        : reason,
    };
  }

  buildEngineCapabilities(engineType) {
    return {
      scriptSearch: true,
      functionTree: true,
      debugger: true,
      sourceMaps: true,
      runtimeEval: true,
      recovery: true,
    };
  }

  createSessionFailure(code, error, recoverable = true) {
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      recoverable,
      timestamp: new Date().toISOString(),
    };
  }

  async createSession(engineType = this.options.defaultBrowserEngine, label) {
    const sessionId = nextSessionId();
    const timestamp = new Date().toISOString();
    const choice = this.resolveEngineChoice(engineType, 'fresh-site-triage');
    const session = await this.buildSession({
      sessionId,
      engineType: choice.engineType,
      autoEngine: choice.autoEngine,
      engineSelectionReason: choice.engineSelectionReason,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      label,
      recoveryCount: 0,
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  async buildSession(seed) {
    const timestamp = new Date().toISOString();
    const llm = new LLMService(this.config.llm, undefined, {
      storage: this.storage,
      llmCache: this.config.llmCache,
    });
    const deobfuscator = new Deobfuscator(llm);
    const advancedDeobfuscator = new AdvancedDeobfuscator(llm);
    const analyzer = new CodeAnalyzer(llm);
    const cryptoDetector = new CryptoDetector(llm);
    const hookManager = new HookManager(this.storage, seed.sessionId);
    const aiHookGenerator = new AIHookGenerator({
      llm,
      rag: new HookRAG(this.storage),
    });
    const scriptInventory = new SessionScriptInventory(seed.sessionId, this.storage);
    const obfuscationAnalysis = new ObfuscationAnalysisService(llm, {
      deobfuscator,
      advancedDeobfuscator,
    });

    const collector = new PlaywrightCompatibilityCollector({
      sessionId: seed.sessionId,
      browserPool: this.browserPool,
      userAgent: this.options.userAgent,
      viewport: this.options.viewport,
    });
    const pageController = new PageController(collector);
    const domInspector = new DOMInspector(collector);
    const scriptManager = new ScriptManager(collector);
    const debuggerManager = new DebuggerManager(collector, this.storage, seed.sessionId);
    const runtimeInspector = new RuntimeInspector(collector, debuggerManager);
    const consoleMonitor = new ConsoleMonitor(collector, this.storage, seed.sessionId);
    const engine = new PlaywrightEngineAdapter(collector, pageController, scriptManager, consoleMonitor);
    await engine.launch();
    if (seed.snapshot) {
      await engine.restoreSnapshot(seed.snapshot);
    }

    return {
      sessionId: seed.sessionId,
      engineType: seed.engineType,
      autoEngine: seed.autoEngine === true,
      engineSelectionReason: seed.engineSelectionReason,
      createdAt: seed.createdAt,
      lastActivityAt: seed.lastActivityAt || timestamp,
      label: seed.label,
      llm,
      deobfuscator,
      advancedDeobfuscator,
      analyzer,
      cryptoDetector,
      hookManager,
      aiHookGenerator,
      obfuscationAnalysis,
      scriptInventory,
      engineCapabilities: this.buildEngineCapabilities(seed.engineType),
      engine,
      collector,
      pageController,
      domInspector,
      scriptManager,
      debuggerManager,
      runtimeInspector,
      consoleMonitor,
      health: 'ready',
      recoverable: true,
      recoveryCount: seed.recoveryCount || 0,
      lastFailure: seed.lastFailure,
      snapshot: seed.snapshot,
      siteProfile: seed.siteProfile || scriptInventory.getSiteProfile(),
    };
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
    }
    return session;
  }

  async refreshSnapshot(session) {
    try {
      const snapshot = await session.engine.captureSnapshot(session.snapshot);
      session.snapshot = snapshot;
      session.recoverable = true;
      return snapshot;
    } catch (error) {
      session.lastFailure = this.createSessionFailure('snapshot-capture-failed', error, true);
      session.health = 'degraded';
      logger.warn('Failed to refresh session snapshot', error);
      return session.snapshot;
    }
  }

  updateSiteProfile(session, nextProfile) {
    session.siteProfile = {
      ...(session.siteProfile || session.scriptInventory.getSiteProfile()),
      ...nextProfile,
    };
    return session.siteProfile;
  }

  async recoverSession(sessionId, preferredEngineType, reason = 'manual-recovery') {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.health = 'recovering';
    const snapshot = await this.refreshSnapshot(session);
    const choice = this.resolveEngineChoice(preferredEngineType || (session.autoEngine ? 'auto' : session.engineType), reason);
    const currentProfile = session.siteProfile;
    const currentFailure = session.lastFailure;

    try {
      await this.teardownSession(session);

      const rebuilt = await this.buildSession({
        sessionId: session.sessionId,
        engineType: choice.engineType,
        autoEngine: session.autoEngine || preferredEngineType === 'auto',
        engineSelectionReason: choice.engineSelectionReason,
        createdAt: session.createdAt,
        lastActivityAt: new Date().toISOString(),
        label: session.label,
        recoveryCount: (session.recoveryCount || 0) + 1,
        snapshot,
        lastFailure: currentFailure,
        siteProfile: currentProfile,
      });

      this.sessions.set(sessionId, rebuilt);
      return rebuilt;
    } catch (error) {
      session.health = 'degraded';
      session.lastFailure = this.createSessionFailure('recovery-failed', error, false);
      this.sessions.set(sessionId, session);
      throw error;
    }
  }

  async maybeUpgradeSessionEngine(sessionId, capability) {
    const session = this.sessions.get(sessionId);
    if (!session || session.autoEngine !== true) {
      return session;
    }

    return this.recoverSession(sessionId, 'playwright', `capability:${capability}`);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      engine: session.engineType,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      label: session.label,
      health: session.health,
      recoverable: session.recoverable,
      recoveryCount: session.recoveryCount || 0,
      engineSelectionReason: session.engineSelectionReason,
    }));
  }

  async teardownSession(session) {
    try {
      await session.runtimeInspector?.disable();
    } catch (error) {
      logger.warn('Failed to disable runtime inspector during session teardown', error);
    }

    try {
      await session.debuggerManager?.close();
    } catch (error) {
      logger.warn('Failed to close debugger manager during session teardown', error);
    }

    try {
      await session.consoleMonitor?.disable();
    } catch (error) {
      logger.warn('Failed to disable console monitor during session teardown', error);
    }

    try {
      await session.engine.close();
    } catch (error) {
      logger.warn('Failed to close engine during session teardown', error);
    }
  }

  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    await this.teardownSession(session);
    session.health = 'closed';
    this.sessions.delete(sessionId);
    return true;
  }

  async closeAll() {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }
  }
}
