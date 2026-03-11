// @ts-nocheck

import { MCPServer as LegacyMCPServer } from '../../MCPServer.js';
export class LegacyToolBridge {
    legacyServer;
    initialized = false;
    constructor(config) {
        this.legacyServer = new LegacyMCPServer(config);
    }
    get surface() {
        return this.legacyServer;
    }
    async init() {
        if (this.initialized) {
            return;
        }
        await this.surface.registerCaches();
        await this.surface.cache.init();
        this.initialized = true;
    }
    getTools() {
        return this.surface.getTools().map((tool) => ({
            ...tool,
            description: `[legacy] ${tool.description}`,
        }));
    }
    async execute(name, args) {
        await this.init();
        return this.surface.executeToolWithTracking(name, args);
    }
    async close() {
        await this.legacyServer.close();
    }
}
//# sourceMappingURL=LegacyToolBridge.js.map