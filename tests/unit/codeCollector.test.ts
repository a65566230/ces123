import { CodeCollector } from '../../src/modules/collector/CodeCollector.js';

describe('CodeCollector', () => {
  test('collectWebWorkers falls back to addInitScript-compatible pages', async () => {
    const collector = new CodeCollector({
      headless: true,
      timeout: 1_000,
    } as never);
    const page = {
      addInitScript: jest.fn(async () => undefined),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(['worker.js'])
        .mockResolvedValueOnce('self.onmessage = () => "ok";'),
      url: jest.fn().mockReturnValue('https://example.test/app'),
    };

    const files = await collector.collectWebWorkers(page as never);

    expect(page.addInitScript).toHaveBeenCalled();
    expect(files[0]?.url).toBe('https://example.test/worker.js');
    expect(files[0]?.type).toBe('web-worker');
  });
});
