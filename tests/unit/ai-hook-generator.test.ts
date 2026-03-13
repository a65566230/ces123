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

  test('normalizes invalid function targets from llm planning into executable object-method hooks', async () => {
    const generator = new AIHookGenerator({
      llm: {
        generateHookGenerationPrompt: () => [{ role: 'user', content: 'plan' }],
        chat: async () => ({
          content: JSON.stringify({
            target: {
              type: 'function',
              name: "anonymous (scriptId 26 line 15, preview contains 'csrfWebToken')",
            },
            behavior: {
              captureArgs: true,
              captureReturn: true,
              captureStack: false,
              logToConsole: true,
            },
            reasoning: 'best candidate',
          }),
        }),
      },
    });

    const generated = await generator.generateHook({
      description: '自动破解 csrfWebToken 相关请求签名并捕获返回值',
      context: {
        signatureCandidates: [
          {
            scriptId: 'script-26',
            url: 'https://example.test/runtime.js',
            rankedFunctions: [{ name: 'anonymous', score: 10, reasons: ['request-signing-keywords'] }],
            objectPaths: ['window.securitySdk.csrfWebToken'],
          },
        ],
      },
    });

    expect(generated.success).toBe(true);
    expect(generated.target?.type).toBe('object-method');
    expect(generated.generatedCode).toContain('window.securitySdk');
    expect(generated.generatedCode).not.toContain("anonymous (scriptId 26 line 15");
  });

  test('falls back to a filtered fetch hook when only anonymous signature candidates are available', async () => {
    const generator = new AIHookGenerator({
      llm: {
        generateHookGenerationPrompt: () => [{ role: 'user', content: 'plan' }],
        chat: async () => ({
          content: JSON.stringify({
            target: {
              type: 'function',
              name: "anonymous (scriptId 26 line 15, preview contains 'csrfWebToken' and 'x-secsdk-csrf-token')",
            },
            behavior: {
              captureArgs: true,
              captureReturn: true,
              captureStack: false,
              logToConsole: true,
            },
            reasoning: 'best candidate',
          }),
        }),
      },
    });

    const generated = await generator.generateHook({
      description: '自动破解 csrfWebToken 相关请求签名并捕获返回值',
      context: {
        signatureCandidates: [
          {
            scriptId: 'script-26',
            url: 'https://example.test/runtime.js',
            rankedFunctions: [
              {
                name: 'anonymous',
                score: 10,
                reasons: ['request-signing-keywords'],
                preview: "function (a,b){ return b.strategyKey === 'csrfWebToken' && 'x-secsdk-csrf-token'; }",
              },
            ],
            objectPaths: [],
          },
        ],
      },
    });

    expect(generated.success).toBe(true);
    expect(generated.target?.type).toBe('api');
    expect(generated.target?.name).toBe('fetch');
    expect(generated.generatedCode).toContain('const argFilterPassed');
    expect(generated.generatedCode).toContain('csrf');
    expect(generated.generatedCode).not.toContain("anonymous (scriptId 26 line 15");
  });

  test('generates a property hook that observes reads and writes on a derived field target', async () => {
    const generator = new AIHookGenerator();

    const generated = await generator.generateHook({
      description: 'trace final vkey property writes',
      target: {
        type: 'property',
        object: 'window.basicFixture',
        property: 'vkey',
        name: 'vkey',
      },
      explicitTarget: true,
      behavior: {
        captureArgs: true,
        captureReturn: true,
        captureStack: true,
        logToConsole: true,
      },
    });

    expect(generated.success).toBe(true);
    expect(generated.explanation).not.toContain('under development');
    expect(generated.generatedCode).toContain('Object.defineProperty');
    expect(generated.generatedCode).toContain('window.basicFixture');
    expect(generated.generatedCode).toContain("'vkey'");
    expect(generated.generatedCode).toContain('__aiHooks');
  });

  test('generates an event hook that captures high-value runtime events without falling back to a stub', async () => {
    const generator = new AIHookGenerator();

    const generated = await generator.generateHook({
      description: 'capture click driven signature flow',
      target: {
        type: 'event',
        object: 'document',
        name: 'click',
      },
      explicitTarget: true,
      behavior: {
        captureArgs: true,
        captureReturn: false,
        captureStack: true,
        logToConsole: true,
      },
    });

    expect(generated.success).toBe(true);
    expect(generated.explanation).not.toContain('under development');
    expect(generated.generatedCode).toContain("addEventListener('click'");
    expect(generated.generatedCode).toContain('__aiHooks');
    expect(generated.generatedCode).toContain('event.type');
  });
});
