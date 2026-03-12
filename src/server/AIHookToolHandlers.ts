// @ts-nocheck

import { AIHookGenerator } from '../modules/hook/AIHookGenerator.js';
import { HookRAG } from '../modules/hook/rag.js';
import { logger } from '../utils/logger.js';

export class AIHookToolHandlers {
    pageController;
    hookGenerator;
    injectedHooks = new Map();
    constructor(pageController) {
        this.pageController = pageController;
        this.hookGenerator = new AIHookGenerator({
            rag: new HookRAG(),
        });
    }
    async handleAIHookGenerate(args) {
        try {
            const request = {
                description: args.description,
                target: args.target,
                behavior: args.behavior,
                condition: args.condition,
                customCode: args.customCode,
                context: args.context,
            };
            const response = await this.hookGenerator.generateHook(request);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: response.success,
                            hookId: response.hookId,
                            generatedCode: response.generatedCode,
                            explanation: response.explanation,
                            injectionMethod: response.injectionMethod,
                            strategy: response.strategy,
                            target: response.target,
                            behavior: response.behavior,
                            warnings: response.warnings,
                            usage: `Use ai_hook_inject(hookId: "${response.hookId}") to inject this hook`,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('AI Hook generation failed', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookInject(args) {
        try {
            const hookId = args.hookId;
            const code = args.code;
            const method = args.method || 'evaluate';
            const page = await this.pageController.getPage();
            if (method === 'evaluateOnNewDocument') {
                await page.evaluateOnNewDocument(code);
                logger.info(`Hook injected (evaluateOnNewDocument): ${hookId}`);
            }
            else {
                await page.evaluate(code);
                logger.info(`Hook injected (evaluate): ${hookId}`);
            }
            this.injectedHooks.set(hookId, {
                code,
                injectionTime: Date.now(),
            });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            hookId,
                            message: `Hook injected (method: ${method})`,
                            injectionTime: new Date().toISOString(),
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Hook injection failed', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookGetData(args) {
        try {
            const hookId = args.hookId;
            const page = await this.pageController.getPage();
            const hookData = await page.evaluate((id) => {
                if (!window.__aiHooks || !window.__aiHooks[id]) {
                    return null;
                }
                return {
                    hookId: id,
                    metadata: window.__aiHookMetadata?.[id],
                    records: window.__aiHooks[id],
                    totalRecords: window.__aiHooks[id].length,
                };
            }, hookId);
            if (!hookData) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                message: `Hook not found or no data captured: ${hookId}`,
                            }, null, 2),
                        }],
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            ...hookData,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Failed to get hook data', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookList(_args) {
        try {
            const page = await this.pageController.getPage();
            const allHooks = await page.evaluate(() => {
                if (!window.__aiHookMetadata) {
                    return [];
                }
                return Object.keys(window.__aiHookMetadata).map(hookId => ({
                    hookId,
                    metadata: window.__aiHookMetadata[hookId],
                    recordCount: window.__aiHooks?.[hookId]?.length || 0,
                }));
            });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            totalHooks: allHooks.length,
                            hooks: allHooks,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Failed to list hooks', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookClear(args) {
        try {
            const hookId = args.hookId;
            const page = await this.pageController.getPage();
            if (hookId) {
                await page.evaluate((id) => {
                    if (window.__aiHooks && window.__aiHooks[id]) {
                        window.__aiHooks[id] = [];
                    }
                }, hookId);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Hook data cleared: ${hookId}`,
                            }, null, 2),
                        }],
                };
            }
            await page.evaluate(() => {
                if (window.__aiHooks) {
                    for (const key in window.__aiHooks) {
                        window.__aiHooks[key] = [];
                    }
                }
            });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'All hook data cleared',
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Failed to clear hook data', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookToggle(args) {
        try {
            const hookId = args.hookId;
            const enabled = args.enabled;
            const page = await this.pageController.getPage();
            await page.evaluate(({ hookId: id, enabled: enable }) => {
                if (window.__aiHookMetadata && window.__aiHookMetadata[id]) {
                    window.__aiHookMetadata[id].enabled = enable;
                }
            }, { hookId, enabled });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            hookId,
                            enabled,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Failed to toggle hook', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
    async handleAIHookExport(args) {
        try {
            const hookId = args.hookId;
            const page = await this.pageController.getPage();
            const exportData = await page.evaluate((id) => {
                if (!window.__aiHooks || !window.__aiHooks[id]) {
                    return null;
                }
                return {
                    hookId: id,
                    metadata: window.__aiHookMetadata?.[id],
                    records: window.__aiHooks[id],
                };
            }, hookId);
            if (!exportData) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                message: `No export data for hook: ${hookId}`,
                            }, null, 2),
                        }],
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            data: exportData,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            logger.error('Failed to export hook data', error);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
            };
        }
    }
}
