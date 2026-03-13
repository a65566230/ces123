// @ts-nocheck

export function measureToolCatalog(tools) {
    const serialized = JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
    })));
    const count = tools.length;
    return {
        count,
        bytes: serialized.length,
        avgBytesPerTool: count > 0 ? Math.round(serialized.length / count) : 0,
    };
}
