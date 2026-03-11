// @ts-nocheck

export function resolveRuntimeOptions(config) {
    const defaultBrowserEngine = process.env.BROWSER_ENGINE || 'puppeteer';
    const browserArgs = process.env.BROWSER_ARGS
        ? process.env.BROWSER_ARGS.split(',').map((item) => item.trim()).filter(Boolean)
        : config.puppeteer.args || [];
    return {
        defaultBrowserEngine,
        enableLegacyTools: process.env.ENABLE_LEGACY_TOOLS === 'true',
        playwrightExecutablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        browserArgs,
        viewport: {
            width: Number(process.env.BROWSER_VIEWPORT_WIDTH || config.puppeteer.viewport?.width || 1440),
            height: Number(process.env.BROWSER_VIEWPORT_HEIGHT || config.puppeteer.viewport?.height || 900),
        },
        userAgent: process.env.BROWSER_USER_AGENT || config.puppeteer.userAgent,
    };
}
//# sourceMappingURL=runtimeOptions.js.map