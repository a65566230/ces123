import { LLMService } from '../../src/services/LLMService.js';

describe('LLMService cache', () => {
  test('returns cached response for identical prompts', async () => {
    let calls = 0;
    const llm = new LLMService(
      {
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: 'gpt-4o-mini',
        },
        anthropic: {
          apiKey: '',
          model: 'claude-3-5-sonnet-20241022',
        },
      },
      undefined,
      {
        remoteExecutor: async () => {
          calls += 1;
          return {
            content: '{"ok":true}',
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            },
          };
        },
        llmCache: {
          enabled: true,
          maxEntries: 16,
          ttlSeconds: 3600,
        },
      },
    );

    const first = await llm.chat([{ role: 'user', content: 'analyze this code' }], { temperature: 0.1 });
    const second = await llm.chat([{ role: 'user', content: 'analyze this code' }], { temperature: 0.1 });

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });
});
