import { SmartCodeCollector } from '../../src/modules/collector/SmartCodeCollector.js';

describe('SmartCodeCollector', () => {
  test('summary mode respects a total size budget by trimming previews and entry count', async () => {
    const collector = new SmartCodeCollector();
    const files = Array.from({ length: 20 }, (_, index) => ({
      url: `https://example.test/${index}.js`,
      content: Array.from({ length: 60 }, () => `function feature_${index}(){ return "token_${index}"; }`).join('\n'),
      size: 60 * 44,
      type: 'external',
    }));

    const summaries = await collector.smartCollect(undefined, files as never, {
      mode: 'summary',
      maxTotalSize: 2_048,
    });

    const serializedSize = JSON.stringify(summaries).length;

    expect(serializedSize).toBeLessThanOrEqual(2_048);
    expect(summaries.length).toBeLessThan(files.length);
  });
});
