import { RuntimeMonitorService } from '../../src/services/RuntimeMonitorService.js';

describe('RuntimeMonitorService', () => {
  test('reports process memory and event loop metrics', async () => {
    const monitor = new RuntimeMonitorService();

    await monitor.start();
    const stats = monitor.getStats();

    expect(stats.memory.rss).toBeGreaterThan(0);
    expect(typeof stats.eventLoop.mean).toBe('number');

    await monitor.close();
  });
});
