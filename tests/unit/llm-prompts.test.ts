import { LLMService } from '../../src/services/LLMService.js';

describe('LLM prompt builders', () => {
  test('builds deobfuscation prompts with structured context slots', () => {
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

    const messages = llm.generateDeobfuscationPrompt('var _0xabc=["token"];', {
      objective: 'Recover signing logic',
      budget: 'medium',
      facts: ['Observed _0x string array'],
      inferences: ['Likely javascript-obfuscator'],
      unknowns: ['Whether runtime decoding is needed'],
      evidenceIds: ['evidence_1'],
      nextActions: ['Run analyze.deobfuscate'],
    });

    expect(messages[1]?.content).toContain('"objective": "Recover signing logic"');
    expect(messages[1]?.content).toContain('"facts": [');
    expect(messages[1]?.content).toContain('"evidenceIds": [');
    expect(messages[1]?.content).toContain('"nextActions": [');
  });
});
