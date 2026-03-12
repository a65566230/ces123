import { TokenBudgetManager } from '../../src/utils/TokenBudgetManager.js';

describe('TokenBudgetManager', () => {
  test('tracks large tool responses using a normalized payload snapshot instead of full raw text', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.reset();

    const hugeResponse = {
      content: [
        {
          type: 'text',
          text: 'x'.repeat(200_000),
        },
      ],
      isError: false,
    };

    manager.recordToolCall('collect_code', { url: 'https://example.test' }, hugeResponse);
    const stats = manager.getStats();

    expect(stats.currentUsage).toBeLessThan(20_000);
    expect(stats.recentCalls.at(-1)?.responseSize).toBeLessThan(80_000);
  });
});
