import { BrowserPool } from '../../src/services/BrowserPool.js';

describe('BrowserPool', () => {
  test('acquires and releases Chromium-backed pages with bounded context count', async () => {
    const pool = new BrowserPool({
      headless: true,
      maxContexts: 2,
      viewport: { width: 1280, height: 720 },
      userAgent: 'jshook-browser-pool-test',
    });

    await pool.init();

    const first = await pool.acquire({ sessionId: 'pool-1', purpose: 'collect' });
    const second = await pool.acquire({ sessionId: 'pool-2', purpose: 'debug' });

    const statsDuringUse = pool.getStats();
    expect(statsDuringUse.activeContexts).toBeLessThanOrEqual(2);
    expect(statsDuringUse.activePages).toBe(2);

    await pool.release(first);
    await pool.release(second);

    const statsAfterRelease = pool.getStats();
    expect(statsAfterRelease.activePages).toBe(0);

    await pool.close();
  });
});
