// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { errorResponse } from './response.js';
export class ToolExecutor {
    registry;
    runtime;
    constructor(registry, runtime) {
        this.registry = registry;
        this.runtime = runtime;
    }
    resolveTimeoutMs() {
        const override = Number(process.env.TOOL_EXECUTOR_TIMEOUT_MS || 0);
        if (Number.isFinite(override) && override > 0) {
            return Math.trunc(override);
        }
        const browserTimeout = Number(this.runtime?.config?.browser?.timeout || 0);
        const workerTimeout = Number(this.runtime?.config?.worker?.taskTimeoutMs || 0);
        return Math.max(browserTimeout, workerTimeout, 30000);
    }
    resolveSessionId(args) {
        return typeof args?.sessionId === 'string' && args.sessionId.length > 0
            ? args.sessionId
            : undefined;
    }
    enforceGlobalRateLimit(name, args) {
        const sessionId = this.resolveSessionId(args);
        if (!sessionId || !this.runtime?.toolRateLimiter?.check) {
            return;
        }
        const result = this.runtime.toolRateLimiter.check(`exec:${sessionId}:${name}`);
        if (result.allowed) {
            return;
        }
        const error = new Error(`rate limit exceeded for ${name}; retry after ${result.resetInMs}ms`);
        error.code = 'tool-rate-limit';
        error.resetInMs = result.resetInMs;
        error.sessionId = sessionId;
        throw error;
    }
    async executeWithTimeout(name, args, descriptor) {
        const timeoutMs = this.resolveTimeoutMs();
        const controller = new AbortController();
        const execution = Promise.resolve(descriptor.execute(args, {
            runtime: this.runtime,
            descriptor,
            signal: controller.signal,
        }));
        if (!(timeoutMs > 0)) {
            return execution;
        }
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const timeoutError = new Error(`tool ${name} timed out after ${timeoutMs}ms`);
                timeoutError.code = 'tool-timeout';
                timeoutError.timeoutMs = timeoutMs;
                timeoutError.sessionId = this.resolveSessionId(args);
                controller.abort(timeoutError);
                reject(timeoutError);
            }, timeoutMs);
            execution
                .then(resolve, reject)
                .finally(() => clearTimeout(timer));
        });
    }
    toErrorResponse(name, error, args) {
        const diagnostics = [];
        const nextActions = [];
        const sessionId = this.resolveSessionId(args);
        if (error?.code === 'tool-timeout') {
            diagnostics.push({
                kind: 'tool-timeout',
                tool: name,
                timeoutMs: error.timeoutMs,
            });
            nextActions.push(sessionId
                ? 'Retry the tool or inspect browser.status; use browser.recover if the session is degraded.'
                : 'Retry the tool with a smaller scope or increase the executor timeout if this path is expected to be slow.');
            return errorResponse(`Tool ${name} timed out`, error, {
                sessionId,
                diagnostics,
                nextActions,
            });
        }
        if (error?.code === 'tool-rate-limit') {
            diagnostics.push({
                kind: 'tool-rate-limit',
                tool: name,
                resetInMs: error.resetInMs,
            });
            nextActions.push(`Wait ${Number(error.resetInMs || 0)}ms before retrying ${name}.`);
            return errorResponse(`Tool ${name} rate limited`, error, {
                sessionId,
                diagnostics,
                nextActions,
            });
        }
        return errorResponse(`Tool ${name} failed`, error, {
            sessionId,
        });
    }
    async execute(name, args) {
        const descriptor = this.registry.get(name);
        if (!descriptor) {
            return errorResponse(`Unknown tool: ${name}`, new Error('Tool is not registered'));
        }
        try {
            if (this.runtime.ready) {
                await this.runtime.ready;
            }
            this.enforceGlobalRateLimit(name, args);
            return await this.executeWithTimeout(name, args, descriptor);
        }
        catch (error) {
            logger.error(`Tool execution failed: ${name}`, error);
            return this.toErrorResponse(name, error, args);
        }
    }
}
//# sourceMappingURL=ToolExecutor.js.map
