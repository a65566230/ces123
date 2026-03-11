import { LLMService } from '../../src/services/LLMService.js';

describe('LLMService runtime configuration', () => {
  test('throws a clear error when provider credentials are missing', async () => {
    const llm = new LLMService({
      provider: 'openai',
      openai: {
        apiKey: '',
        model: 'gpt-4o-mini',
      },
      anthropic: {
        apiKey: '',
        model: 'claude-3-5-sonnet-20241022',
      },
    });

    await expect(
      llm.chat([{ role: 'user', content: 'analyze this code' }], { temperature: 0.1 }),
    ).rejects.toThrow('OpenAI client is not configured');
  });
});
