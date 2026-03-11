import { HookRAG } from '../../src/modules/hook/rag.js';

describe('HookRAG', () => {
  test('matches decrypt-oriented descriptions to a built-in crypto template', async () => {
    const rag = new HookRAG();

    const match = await rag.findBestTemplate({
      description: '自动破解 AES 加密并捕获返回值',
    });

    expect(match).not.toBeNull();
    expect(match?.template.id).toBe('cryptojs-aes-function');
    expect(match?.source).toBe('builtin');
  });
});
