import { AIHookGenerator } from '../../src/modules/hook/AIHookGenerator.js';
import { HookRAG } from '../../src/modules/hook/rag.js';

describe('AIHookGenerator', () => {
  test('infers object-method hook from natural language description', async () => {
    const generator = new AIHookGenerator({
      rag: new HookRAG(),
    });

    const generated = await generator.generateHook({
      description: '自动破解 basicFixture.sign 加密并捕获返回值',
      context: {
        signatureCandidates: [
          {
            scriptId: 'script-1',
            url: 'https://example.test/app.js',
            rankedFunctions: [{ name: 'sign', score: 10, reasons: ['request-signing-keywords'] }],
            objectPaths: ['window.basicFixture.sign'],
          },
        ],
      },
    });

    expect(generated.success).toBe(true);
    expect(generated.strategy?.source).toBe('rag');
    expect(generated.strategy?.templateId).toBeDefined();
    expect(generated.generatedCode).toContain('window.basicFixture');
    expect(generated.generatedCode).toContain('__aiHooks');
  });
});
