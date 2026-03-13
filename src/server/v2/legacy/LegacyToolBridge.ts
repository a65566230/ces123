// @ts-nocheck

import { MCPServer as LegacyMCPServer } from '../../MCPServer.js';
import { shouldExposeLegacyTool } from './legacyToolFilter.js';
export function formatLegacyToolDescription(description) {
    return `[legacy][compatibility-only] ${String(description || '').trim()}`;
}
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
        await this.surface.storage.init();
        await this.surface.registerCaches();
        await this.surface.cache.init();
        this.initialized = true;
    }
    getTools() {
        return this.surface.getTools().filter((tool) => shouldExposeLegacyTool(tool.name)).map((tool) => ({
            ...tool,
            description: formatLegacyToolDescription(tool.description),
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
