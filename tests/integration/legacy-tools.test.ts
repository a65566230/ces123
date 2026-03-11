import path from 'path';
import { CodeCollector } from '../../src/modules/collector/CodeCollector.js';
import { PageController } from '../../src/modules/collector/PageController.js';
import { BrowserToolHandlers } from '../../src/server/BrowserToolHandlers.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';
import { parseToolResponse } from '../helpers/parseToolResponse.js';
import { createTestConfig } from '../helpers/testConfig.js';

describe('legacy tool bridge on Playwright runtime', () => {
  const originalEnv = { ...process.env };
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
  let collector: CodeCollector;
  let handlers: BrowserToolHandlers;

  beforeAll(async () => {
    process.env.ENABLE_LEGACY_TOOLS = 'true';
    fixture = await startFixtureServer(path.resolve(process.cwd(), 'tests/fixtures'));
    const config = createTestConfig();
    collector = new CodeCollector(config.browser);
    const pageController = new PageController(collector);
    handlers = new BrowserToolHandlers(
      collector,
      pageController,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    );
    handlers.autoDetectCaptcha = false;
  });

  afterAll(async () => {
    await collector.close();
    await fixture.close();
    process.env = originalEnv;
  });

  test('supports navigation, viewport changes, and cookie round-trips through legacy tools', async () => {
    const launched = parseToolResponse(await handlers.handleBrowserLaunch({}) as never);
    expect(launched.success).toBe(true);

    const navigated = parseToolResponse(await handlers.handlePageNavigate({
      url: `${fixture.origin}/basic/index.html`,
    }) as never);
    expect(navigated.success).toBe(true);

    const viewport = parseToolResponse(await handlers.handlePageSetViewport({
      width: 1024,
      height: 768,
    }) as never);
    expect(viewport.success).toBe(true);

    const setCookies = parseToolResponse(await handlers.handlePageSetCookies({
      cookies: [
        {
          name: 'legacy_cookie',
          value: 'ok',
          url: fixture.origin,
        },
      ],
    }) as never);
    expect(setCookies.success).toBe(true);

    const getCookies = parseToolResponse(await handlers.handlePageGetCookies({}) as never);
    const cookies = (getCookies.cookies || []) as Array<{ name: string; value: string }>;
    expect(cookies.some((cookie) => cookie.name === 'legacy_cookie' && cookie.value === 'ok')).toBe(true);
  });
});
