// @ts-nocheck

import { logger } from '../../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WatchExpressionManager } from './WatchExpressionManager.js';
import { XHRBreakpointManager } from './XHRBreakpointManager.js';
import { EventBreakpointManager } from './EventBreakpointManager.js';
import { BlackboxManager } from './BlackboxManager.js';
export class DebuggerManager {
    collector;
    storage;
    sessionId;
    cdpSession = null;
    enabled = false;
    breakpoints = new Map();
    pausedState = null;
    pausedResolvers = [];
    breakpointHitCallbacks = new Set();
    pauseOnExceptionsState = 'none';
    _watchManager = null;
    _xhrManager = null;
    _eventManager = null;
    _blackboxManager = null;
    pausedListener = null;
    resumedListener = null;
    breakpointResolvedListener = null;
    constructor(collector, storage, sessionId) {
        this.collector = collector;
        this.storage = storage;
        this.sessionId = sessionId;
    }
    getCDPSession() {
        if (!this.cdpSession || !this.enabled) {
            throw new Error('Debugger not enabled. Call init() or enable() first to get CDP session.');
        }
        return this.cdpSession;
    }
    getWatchManager() {
        if (!this._watchManager) {
            throw new Error('WatchExpressionManager not initialized. Call initAdvancedFeatures() first.');
        }
        return this._watchManager;
    }
    getXHRManager() {
        if (!this._xhrManager) {
            throw new Error('XHRBreakpointManager not initialized. Call initAdvancedFeatures() first.');
        }
        return this._xhrManager;
    }
    getEventManager() {
        if (!this._eventManager) {
            throw new Error('EventBreakpointManager not initialized. Call initAdvancedFeatures() first.');
        }
        return this._eventManager;
    }
    getBlackboxManager() {
        if (!this._blackboxManager) {
            throw new Error('BlackboxManager not initialized. Call initAdvancedFeatures() first.');
        }
        return this._blackboxManager;
    }
    async init() {
        if (this.enabled) {
            logger.warn('Debugger already enabled');
            return;
        }
        try {
            const page = await this.collector.getActivePage();
            this.cdpSession = await page.createCDPSession();
            await this.cdpSession.send('Debugger.enable');
            this.enabled = true;
            this.pausedListener = (params) => this.handlePaused(params);
            this.resumedListener = () => this.handleResumed();
            this.breakpointResolvedListener = (params) => this.handleBreakpointResolved(params);
            this.cdpSession.on('Debugger.paused', this.pausedListener);
            this.cdpSession.on('Debugger.resumed', this.resumedListener);
            this.cdpSession.on('Debugger.breakpointResolved', this.breakpointResolvedListener);
            logger.info('Debugger enabled successfully');
        }
        catch (error) {
            logger.error('Failed to enable debugger:', error);
            throw error;
        }
    }
    async enable() {
        return this.init();
    }
    async initAdvancedFeatures(runtimeInspector) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger must be enabled before initializing advanced features. Call init() first.');
        }
        try {
            if (runtimeInspector) {
                this._watchManager = new WatchExpressionManager(runtimeInspector);
                logger.info('WatchExpressionManager initialized');
            }
            this._xhrManager = new XHRBreakpointManager(this.cdpSession);
            logger.info('XHRBreakpointManager initialized');
            this._eventManager = new EventBreakpointManager(this.cdpSession);
            logger.info('EventBreakpointManager initialized');
            this._blackboxManager = new BlackboxManager(this.cdpSession);
            logger.info('BlackboxManager initialized');
            logger.info('All advanced debugging features initialized');
        }
        catch (error) {
            logger.error('Failed to initialize advanced features:', error);
            throw error;
        }
    }
    async disable() {
        if (!this.enabled || !this.cdpSession) {
            logger.warn('Debugger not enabled');
            return;
        }
        try {
            if (this._xhrManager) {
                await this._xhrManager.close();
                this._xhrManager = null;
            }
            if (this._eventManager) {
                await this._eventManager.close();
                this._eventManager = null;
            }
            if (this._blackboxManager) {
                await this._blackboxManager.close();
                this._blackboxManager = null;
            }
            if (this._watchManager) {
                this._watchManager.clearAll();
                this._watchManager = null;
            }
            if (this.pausedListener) {
                this.cdpSession.off('Debugger.paused', this.pausedListener);
                this.pausedListener = null;
            }
            if (this.resumedListener) {
                this.cdpSession.off('Debugger.resumed', this.resumedListener);
                this.resumedListener = null;
            }
            if (this.breakpointResolvedListener) {
                this.cdpSession.off('Debugger.breakpointResolved', this.breakpointResolvedListener);
                this.breakpointResolvedListener = null;
            }
            await this.cdpSession.send('Debugger.disable');
        }
        catch (error) {
            logger.error('Failed to disable debugger:', error);
        }
        finally {
            this.enabled = false;
            this.breakpoints.clear();
            this.pausedState = null;
            this.pausedResolvers = [];
            if (this.cdpSession) {
                try {
                    await this.cdpSession.detach();
                }
                catch (e) {
                    logger.warn('Failed to detach CDP session:', e);
                }
                this.cdpSession = null;
            }
            logger.info('Debugger disabled and cleaned up');
        }
    }
    isEnabled() {
        return this.enabled;
    }
    async setBreakpointByUrl(params) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger is not enabled. Call init() or enable() first.');
        }
        if (!params.url) {
            throw new Error('url parameter is required');
        }
        if (params.lineNumber < 0) {
            throw new Error('lineNumber must be a non-negative number');
        }
        if (params.columnNumber !== undefined && params.columnNumber < 0) {
            throw new Error('columnNumber must be a non-negative number');
        }
        try {
            const result = await this.cdpSession.send('Debugger.setBreakpointByUrl', {
                url: params.url,
                lineNumber: params.lineNumber,
                columnNumber: params.columnNumber,
                condition: params.condition,
            });
            const breakpointInfo = {
                breakpointId: result.breakpointId,
                location: {
                    url: params.url,
                    lineNumber: params.lineNumber,
                    columnNumber: params.columnNumber,
                },
                condition: params.condition,
                enabled: true,
                hitCount: 0,
                createdAt: Date.now(),
            };
            this.breakpoints.set(result.breakpointId, breakpointInfo);
            if (this.storage && this.sessionId) {
                await this.storage.recordBreakpoint(this.sessionId, {
                    breakpointId: result.breakpointId,
                    location: breakpointInfo.location,
                    condition: breakpointInfo.condition,
                    enabled: true,
                    hitCount: breakpointInfo.hitCount,
                    payload: breakpointInfo,
                    updatedAt: Date.now(),
                });
            }
            logger.info(`Breakpoint set: ${params.url}:${params.lineNumber}`, {
                breakpointId: result.breakpointId,
                condition: params.condition,
            });
            return breakpointInfo;
        }
        catch (error) {
            logger.error('Failed to set breakpoint:', error);
            throw error;
        }
    }
    async setBreakpoint(params) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger is not enabled. Call init() or enable() first.');
        }
        if (!params.scriptId) {
            throw new Error('scriptId parameter is required');
        }
        if (params.lineNumber < 0) {
            throw new Error('lineNumber must be a non-negative number');
        }
        if (params.columnNumber !== undefined && params.columnNumber < 0) {
            throw new Error('columnNumber must be a non-negative number');
        }
        try {
            const result = await this.cdpSession.send('Debugger.setBreakpoint', {
                location: {
                    scriptId: params.scriptId,
                    lineNumber: params.lineNumber,
                    columnNumber: params.columnNumber,
                },
                condition: params.condition,
            });
            const breakpointInfo = {
                breakpointId: result.breakpointId,
                location: {
                    scriptId: params.scriptId,
                    lineNumber: params.lineNumber,
                    columnNumber: params.columnNumber,
                },
                condition: params.condition,
                enabled: true,
                hitCount: 0,
                createdAt: Date.now(),
            };
            this.breakpoints.set(result.breakpointId, breakpointInfo);
            if (this.storage && this.sessionId) {
                await this.storage.recordBreakpoint(this.sessionId, {
                    breakpointId: result.breakpointId,
                    location: breakpointInfo.location,
                    condition: breakpointInfo.condition,
                    enabled: true,
                    hitCount: breakpointInfo.hitCount,
                    payload: breakpointInfo,
                    updatedAt: Date.now(),
                });
            }
            logger.info(`Breakpoint set: scriptId=${params.scriptId}:${params.lineNumber}`, {
                breakpointId: result.breakpointId,
            });
            return breakpointInfo;
        }
        catch (error) {
            logger.error('Failed to set breakpoint:', error);
            throw error;
        }
    }
    async removeBreakpoint(breakpointId) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger is not enabled. Call init() or enable() first.');
        }
        if (!breakpointId) {
            throw new Error('breakpointId parameter is required');
        }
        if (!this.breakpoints.has(breakpointId)) {
            throw new Error(`Breakpoint not found: ${breakpointId}. Use listBreakpoints() to see active breakpoints.`);
        }
        try {
            await this.cdpSession.send('Debugger.removeBreakpoint', { breakpointId });
            this.breakpoints.delete(breakpointId);
            if (this.storage && this.sessionId) {
                await this.storage.recordBreakpoint(this.sessionId, {
                    breakpointId,
                    location: { removed: true },
                    enabled: false,
                    hitCount: 0,
                    updatedAt: Date.now(),
                });
            }
            logger.info(`Breakpoint removed: ${breakpointId}`);
        }
        catch (error) {
            logger.error(`Failed to remove breakpoint ${breakpointId}:`, error);
            throw error;
        }
    }
    listBreakpoints() {
        return Array.from(this.breakpoints.values());
    }
    getBreakpoint(breakpointId) {
        return this.breakpoints.get(breakpointId);
    }
    async clearAllBreakpoints() {
        const breakpointIds = Array.from(this.breakpoints.keys());
        for (const id of breakpointIds) {
            await this.removeBreakpoint(id);
        }
        logger.info(`Cleared ${breakpointIds.length} breakpoints`);
    }
    async setPauseOnExceptions(state) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.setPauseOnExceptions', { state });
            this.pauseOnExceptionsState = state;
            logger.info(`Pause on exceptions set to: ${state}`);
        }
        catch (error) {
            logger.error('Failed to set pause on exceptions:', error);
            throw error;
        }
    }
    getPauseOnExceptionsState() {
        return this.pauseOnExceptionsState;
    }
    async pause() {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.pause');
            logger.info('Execution paused');
        }
        catch (error) {
            logger.error('Failed to pause execution:', error);
            throw error;
        }
    }
    async resume() {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.resume');
            logger.info('Execution resumed');
        }
        catch (error) {
            logger.error('Failed to resume execution:', error);
            throw error;
        }
    }
    async stepInto() {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.stepInto');
            logger.info('Step into');
        }
        catch (error) {
            logger.error('Failed to step into:', error);
            throw error;
        }
    }
    async stepOver() {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.stepOver');
            logger.info('Step over');
        }
        catch (error) {
            logger.error('Failed to step over:', error);
            throw error;
        }
    }
    async stepOut() {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        try {
            await this.cdpSession.send('Debugger.stepOut');
            logger.info('Step out');
        }
        catch (error) {
            logger.error('Failed to step out:', error);
            throw error;
        }
    }
    getPausedState() {
        return this.pausedState;
    }
    isPaused() {
        return this.pausedState !== null;
    }
    async waitForPaused(timeout = 30000) {
        if (this.pausedState) {
            return this.pausedState;
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const index = this.pausedResolvers.indexOf(resolve);
                if (index > -1) {
                    this.pausedResolvers.splice(index, 1);
                }
                reject(new Error('Timeout waiting for paused event'));
            }, timeout);
            this.pausedResolvers.push((state) => {
                clearTimeout(timer);
                resolve(state);
            });
        });
    }
    async evaluateOnCallFrame(params) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        if (!this.pausedState) {
            throw new Error('Not in paused state');
        }
        try {
            const result = await this.cdpSession.send('Debugger.evaluateOnCallFrame', {
                callFrameId: params.callFrameId,
                expression: params.expression,
                returnByValue: params.returnByValue !== false,
            });
            logger.info(`Evaluated on call frame: ${params.expression}`, {
                result: result.result.value,
            });
            return result.result;
        }
        catch (error) {
            logger.error('Failed to evaluate on call frame:', error);
            throw error;
        }
    }
    async getScopeVariables(options = {}) {
        if (!this.enabled || !this.cdpSession) {
            throw new Error('Debugger not enabled');
        }
        if (!this.pausedState) {
            throw new Error('Not in paused state. Use pause() or set a breakpoint first.');
        }
        const { callFrameId, includeObjectProperties = false, maxDepth = 1, skipErrors = true, } = options;
        try {
            const targetFrame = callFrameId
                ? this.pausedState.callFrames.find(f => f.callFrameId === callFrameId)
                : this.pausedState.callFrames[0];
            if (!targetFrame) {
                throw new Error(`Call frame not found: ${callFrameId || 'top frame'}`);
            }
            const variables = [];
            const errors = [];
            let successfulScopes = 0;
            for (const scope of targetFrame.scopeChain) {
                try {
                    if (scope.object.objectId) {
                        const properties = await this.cdpSession.send('Runtime.getProperties', {
                            objectId: scope.object.objectId,
                            ownProperties: true,
                        });
                        for (const prop of properties.result) {
                            if (prop.name === '__proto__')
                                continue;
                            const variable = {
                                name: prop.name,
                                value: prop.value?.value,
                                type: prop.value?.type || 'unknown',
                                scope: scope.type,
                                writable: prop.writable,
                                configurable: prop.configurable,
                                enumerable: prop.enumerable,
                                objectId: prop.value?.objectId,
                            };
                            variables.push(variable);
                            if (includeObjectProperties && prop.value?.objectId && maxDepth > 0) {
                                try {
                                    const nestedProps = await this.getObjectProperties(prop.value.objectId, maxDepth - 1);
                                    for (const nested of nestedProps) {
                                        variables.push({
                                            ...nested,
                                            name: `${prop.name}.${nested.name}`,
                                            scope: scope.type,
                                        });
                                    }
                                }
                                catch (nestedError) {
                                    logger.debug(`Failed to get nested properties for ${prop.name}:`, nestedError);
                                }
                            }
                        }
                        successfulScopes++;
                    }
                }
                catch (error) {
                    const errorMsg = error.message || String(error);
                    logger.warn(`Failed to get properties for scope ${scope.type}:`, errorMsg);
                    errors.push({
                        scope: scope.type,
                        error: errorMsg,
                    });
                    if (!skipErrors) {
                        throw error;
                    }
                }
            }
            const result = {
                success: true,
                variables,
                callFrameId: targetFrame.callFrameId,
                callFrameInfo: {
                    functionName: targetFrame.functionName || '(anonymous)',
                    location: `${targetFrame.url}:${targetFrame.location.lineNumber}:${targetFrame.location.columnNumber}`,
                },
                totalScopes: targetFrame.scopeChain.length,
                successfulScopes,
            };
            if (errors.length > 0) {
                result.errors = errors;
            }
            logger.info(`Got ${variables.length} variables from ${successfulScopes}/${targetFrame.scopeChain.length} scopes`, {
                callFrameId: targetFrame.callFrameId,
                functionName: targetFrame.functionName,
                errors: errors.length,
            });
            return result;
        }
        catch (error) {
            logger.error('Failed to get scope variables:', error);
            throw error;
        }
    }
    async getObjectProperties(objectId, maxDepth) {
        if (maxDepth <= 0 || !this.cdpSession) {
            return [];
        }
        try {
            const properties = await this.cdpSession.send('Runtime.getProperties', {
                objectId,
                ownProperties: true,
            });
            const variables = [];
            for (const prop of properties.result) {
                if (prop.name === '__proto__')
                    continue;
                variables.push({
                    name: prop.name,
                    value: prop.value?.value,
                    type: prop.value?.type || 'unknown',
                    scope: 'local',
                    objectId: prop.value?.objectId,
                });
            }
            return variables;
        }
        catch (error) {
            logger.debug(`Failed to get object properties for ${objectId}:`, error);
            return [];
        }
    }
    onBreakpointHit(callback) {
        this.breakpointHitCallbacks.add(callback);
        logger.info('Breakpoint hit callback registered', {
            totalCallbacks: this.breakpointHitCallbacks.size,
        });
    }
    offBreakpointHit(callback) {
        this.breakpointHitCallbacks.delete(callback);
        logger.info('Breakpoint hit callback removed', {
            totalCallbacks: this.breakpointHitCallbacks.size,
        });
    }
    clearBreakpointHitCallbacks() {
        this.breakpointHitCallbacks.clear();
        logger.info('All breakpoint hit callbacks cleared');
    }
    getBreakpointHitCallbackCount() {
        return this.breakpointHitCallbacks.size;
    }
    async handlePaused(params) {
        this.pausedState = {
            callFrames: params.callFrames,
            reason: params.reason,
            data: params.data,
            hitBreakpoints: params.hitBreakpoints,
            timestamp: Date.now(),
        };
        if (params.hitBreakpoints) {
            for (const breakpointId of params.hitBreakpoints) {
                const bp = this.breakpoints.get(breakpointId);
                if (bp) {
                    bp.hitCount++;
                }
            }
        }
        logger.info('Execution paused', {
            reason: params.reason,
            location: params.callFrames[0]?.location,
            hitBreakpoints: params.hitBreakpoints,
        });
        if (params.hitBreakpoints && params.hitBreakpoints.length > 0 && this.breakpointHitCallbacks.size > 0) {
            const topFrame = params.callFrames[0];
            let variables;
            try {
                const result = await this.getScopeVariables({ skipErrors: true });
                variables = result.variables;
            }
            catch (error) {
                logger.debug('Failed to auto-fetch variables for breakpoint hit callback:', error);
            }
            const event = {
                breakpointId: params.hitBreakpoints[0],
                breakpointInfo: this.breakpoints.get(params.hitBreakpoints[0]),
                location: {
                    scriptId: topFrame.location.scriptId,
                    lineNumber: topFrame.location.lineNumber,
                    columnNumber: topFrame.location.columnNumber,
                    url: topFrame.url,
                },
                callFrames: params.callFrames,
                timestamp: Date.now(),
                variables,
                reason: params.reason,
            };
            for (const callback of this.breakpointHitCallbacks) {
                try {
                    await Promise.resolve(callback(event));
                }
                catch (error) {
                    logger.error('Breakpoint hit callback error:', error);
                }
            }
        }
        for (const resolver of this.pausedResolvers) {
            resolver(this.pausedState);
        }
        this.pausedResolvers = [];
    }
    handleResumed() {
        this.pausedState = null;
        logger.info('Execution resumed');
    }
    handleBreakpointResolved(params) {
        const bp = this.breakpoints.get(params.breakpointId);
        if (bp) {
            logger.info('Breakpoint resolved', {
                breakpointId: params.breakpointId,
                location: params.location,
            });
        }
    }
    exportSession(metadata) {
        const session = {
            version: '1.0',
            timestamp: Date.now(),
            breakpoints: Array.from(this.breakpoints.values()).map(bp => ({
                location: {
                    scriptId: bp.location.scriptId,
                    url: bp.location.url,
                    lineNumber: bp.location.lineNumber,
                    columnNumber: bp.location.columnNumber,
                },
                condition: bp.condition,
                enabled: bp.enabled,
            })),
            pauseOnExceptions: this.pauseOnExceptionsState,
            metadata: metadata || {},
        };
        logger.info('Session exported', {
            breakpointCount: session.breakpoints.length,
            pauseOnExceptions: session.pauseOnExceptions,
        });
        return session;
    }
    async saveSession(filePath, metadata) {
        const session = this.exportSession(metadata);
        if (!filePath) {
            const sessionsDir = path.join(process.cwd(), 'debugger-sessions');
            await fs.mkdir(sessionsDir, { recursive: true });
            filePath = path.join(sessionsDir, `session-${Date.now()}.json`);
        }
        else {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
        }
        await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
        logger.info(`Session saved to ${filePath}`, {
            breakpointCount: session.breakpoints.length,
        });
        return filePath;
    }
    async loadSessionFromFile(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        const session = JSON.parse(content);
        await this.importSession(session);
        logger.info(`Session loaded from ${filePath}`, {
            breakpointCount: session.breakpoints.length,
        });
    }
    async importSession(sessionData) {
        if (!this.enabled) {
            throw new Error('Debugger must be enabled before importing session. Call init() or enable() first.');
        }
        const session = typeof sessionData === 'string'
            ? JSON.parse(sessionData)
            : sessionData;
        if (session.version !== '1.0') {
            logger.warn(`Session version mismatch: ${session.version} (expected 1.0)`);
        }
        logger.info('Importing session...', {
            breakpointCount: session.breakpoints.length,
            pauseOnExceptions: session.pauseOnExceptions,
            timestamp: new Date(session.timestamp).toISOString(),
        });
        await this.clearAllBreakpoints();
        let successCount = 0;
        let failCount = 0;
        for (const bp of session.breakpoints) {
            try {
                if (bp.location.url) {
                    await this.setBreakpointByUrl({
                        url: bp.location.url,
                        lineNumber: bp.location.lineNumber,
                        columnNumber: bp.location.columnNumber,
                        condition: bp.condition,
                    });
                    successCount++;
                }
                else if (bp.location.scriptId) {
                    await this.setBreakpoint({
                        scriptId: bp.location.scriptId,
                        lineNumber: bp.location.lineNumber,
                        columnNumber: bp.location.columnNumber,
                        condition: bp.condition,
                    });
                    successCount++;
                }
                else {
                    logger.warn('Breakpoint has neither url nor scriptId, skipping', bp);
                    failCount++;
                }
            }
            catch (error) {
                logger.error('Failed to restore breakpoint:', error, bp);
                failCount++;
            }
        }
        if (session.pauseOnExceptions) {
            await this.setPauseOnExceptions(session.pauseOnExceptions);
        }
        logger.info('Session imported', {
            totalBreakpoints: session.breakpoints.length,
            successCount,
            failCount,
            pauseOnExceptions: session.pauseOnExceptions,
        });
    }
    async listSavedSessions() {
        const sessionsDir = path.join(process.cwd(), 'debugger-sessions');
        try {
            await fs.access(sessionsDir);
        }
        catch {
            return [];
        }
        const files = await fs.readdir(sessionsDir);
        const sessions = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(sessionsDir, file);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const session = JSON.parse(content);
                    sessions.push({
                        path: filePath,
                        timestamp: session.timestamp,
                        metadata: session.metadata,
                    });
                }
                catch (error) {
                    logger.warn(`Failed to read session file ${file}:`, error);
                }
            }
        }
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        return sessions;
    }
    async close() {
        if (this.enabled) {
            await this.disable();
        }
        if (this.cdpSession) {
            await this.cdpSession.detach();
            this.cdpSession = null;
        }
        logger.info('Debugger manager closed');
    }
}
//# sourceMappingURL=DebuggerManager.js.map
