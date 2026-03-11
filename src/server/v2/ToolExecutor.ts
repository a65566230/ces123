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
    async execute(name, args) {
        const descriptor = this.registry.get(name);
        if (!descriptor) {
            return errorResponse(`Unknown tool: ${name}`, new Error('Tool is not registered'));
        }
        try {
            if (this.runtime.ready) {
                await this.runtime.ready;
            }
            return await descriptor.execute(args, {
                runtime: this.runtime,
                descriptor,
            });
        }
        catch (error) {
            logger.error(`Tool execution failed: ${name}`, error);
            return errorResponse(`Tool ${name} failed`, error);
        }
    }
}
//# sourceMappingURL=ToolExecutor.js.map
