// @ts-nocheck

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import { ToolExecutor } from './v2/ToolExecutor.js';
import { ToolRegistry } from './v2/ToolRegistry.js';
import { LegacyToolBridge } from './v2/legacy/LegacyToolBridge.js';
import { ToolRuntimeContext } from './v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from './v2/runtime/runtimeOptions.js';
import { createV2Tools } from './v2/tools/createV2Tools.js';
export class V2MCPServer {
    server;
    runtime;
    registry;
    executor;
    legacyBridge;
    constructor(config) {
        const options = resolveRuntimeOptions(config);
        this.runtime = new ToolRuntimeContext(config, options);
        this.legacyBridge = options.enableLegacyTools ? new LegacyToolBridge(config) : undefined;
        const descriptors = [
            ...createV2Tools(this.runtime, options.toolProfile),
            ...(this.legacyBridge
                ? this.legacyBridge.getTools().map((tool) => ({
                    ...tool,
                    group: 'legacy',
                    lifecycle: 'none',
                    legacy: true,
                    execute: async (args) => {
                        const result = await this.legacyBridge.execute(tool.name, args);
                        if (!Array.isArray(result?.content)) {
                            return {
                                content: [{
                                        type: 'text',
                                        text: JSON.stringify(result, null, 2),
                                    }],
                                isError: result?.success === false || result?.isError === true,
                            };
                        }
                        return {
                            content: result.content.map((item) => ({
                                type: 'text',
                                text: item.text,
                            })),
                            isError: result.isError,
                        };
                    },
                }))
                : []),
        ];
        this.registry = new ToolRegistry(descriptors);
        this.executor = new ToolExecutor(this.registry, this.runtime);
        this.server = new Server({
            name: config.mcp.name,
            version: config.mcp.version,
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
        logger.info(`V2 MCP server initialized with ${this.registry.size} tools`);
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.registry.listTools(),
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            return this.executor.execute(name, (args || {}));
        });
    }
    async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.success('V2 MCP server connected to stdio transport');
    }
    async close() {
        await this.runtime.close();
        await this.legacyBridge?.close();
        await this.server.close();
    }
}
//# sourceMappingURL=V2MCPServer.js.map
