// @ts-nocheck

export class ToolRegistry {
    tools = new Map();
    constructor(descriptors) {
        for (const descriptor of descriptors) {
            if (this.tools.has(descriptor.name)) {
                throw new Error(`Duplicate tool registration: ${descriptor.name}`);
            }
            this.tools.set(descriptor.name, descriptor);
        }
    }
    listTools() {
        return Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
        }));
    }
    get(name) {
        return this.tools.get(name);
    }
    get size() {
        return this.tools.size;
    }
}
//# sourceMappingURL=ToolRegistry.js.map