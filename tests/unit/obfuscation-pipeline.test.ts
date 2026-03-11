import { ObfuscationAnalysisService } from '../../src/server/v2/analysis/ObfuscationAnalysisService.js';
import { LLMService } from '../../src/services/LLMService.js';

function createService(): ObfuscationAnalysisService {
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

  return new ObfuscationAnalysisService(llm);
}

describe('obfuscation analysis service', () => {
  test('detects obfuscation and records fixed pipeline stages', async () => {
    const service = createService();

    const result = await service.deobfuscate('var _0xabc=["token"];function x(){return _0xabc[0];}', {
      includeExplanation: false,
    });

    expect(result.pipelineStages.slice(0, 3)).toEqual(['detect', 'normalize', 'static-passes']);
    expect(result.detected.types).toContain('javascript-obfuscator');
  });
});
