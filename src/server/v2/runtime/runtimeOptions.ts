// @ts-nocheck

export function resolveRuntimeOptions(config) {
    const defaultBrowserEngine = 'playwright';
    const toolProfile = ['core', 'expert', 'legacy'].includes(process.env.JSHOOK_TOOL_PROFILE || '')
        ? process.env.JSHOOK_TOOL_PROFILE
        : 'expert';
    const browserArgs = process.env.BROWSER_ARGS
        ? process.env.BROWSER_ARGS.split(',').map((item) => item.trim()).filter(Boolean)
        : config.browser.args || [];
    return {
        defaultBrowserEngine,
        toolProfile,
        enableLegacyTools: process.env.ENABLE_LEGACY_TOOLS === 'true' || toolProfile === 'legacy',
        playwrightExecutablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        browserArgs,
        viewport: {
            width: Number(process.env.BROWSER_VIEWPORT_WIDTH || config.browser.viewport?.width || 1440),
            height: Number(process.env.BROWSER_VIEWPORT_HEIGHT || config.browser.viewport?.height || 900),
        },
        userAgent: process.env.BROWSER_USER_AGENT || config.browser.userAgent,
    };
}
//# sourceMappingURL=runtimeOptions.js.map
