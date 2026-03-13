import { BundleFingerprintService } from '../../src/server/v2/analysis/BundleFingerprintService.js';
import { FunctionRanker } from '../../src/server/v2/analysis/FunctionRanker.js';
import { ScriptDiffService } from '../../src/server/v2/analysis/ScriptDiffService.js';

describe('analysis helpers', () => {
  test('fingerprints scripts and detects likely bundler signals', () => {
    const service = new BundleFingerprintService();
    const fingerprint = service.fingerprint('function x(){return fetch("/api")} var __webpack_require__ = {};');

    expect(fingerprint.probableBundler).toBe('webpack');
    expect(fingerprint.apiSignals).toContain('fetch(');
  });

  test('ranks security-relevant functions ahead of ordinary helpers', () => {
    const ranker = new FunctionRanker();
    const ranked = ranker.rank(`
      const helper = () => 1;
      function buildSignature(token, nonce) {
        return crypto.subtle + fetch('/api') + token + nonce;
      }
    `);

    expect(ranked[0]?.name).toBe('buildSignature');
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  test('keeps structurally suspicious object-assembly functions in the candidate set even without explicit signature keywords', () => {
    const ranker = new FunctionRanker();
    const ranked = ranker.rank(`
      const helper = () => 1;
      function finalizePacket(seed, target) {
        const payload = { nonceValue: seed };
        target.packet = payload;
        return payload;
      }
    `);

    const candidate = ranked.find((item) => item.name === 'finalizePacket');

    expect(candidate).toBeDefined();
    expect(candidate?.score).toBeGreaterThan(0);
    expect(candidate?.reasons).toEqual(expect.arrayContaining(['object-assembly', 'property-write-adjacent']));
  });

  test('does not classify ordinary function declarations as dynamic execution just because they use the function keyword', () => {
    const ranker = new FunctionRanker();
    const ranked = ranker.rank(`
      function finalizePacket(seed, target) {
        const payload = { payloadValue: seed };
        target.packet = payload;
        return payload;
      }
    `);

    const candidate = ranked.find((item) => item.name === 'finalizePacket');

    expect(candidate).toBeDefined();
    expect(candidate?.reasons).not.toContain('dynamic-execution');
  });

  test('summarizes line-level diffs', () => {
    const diff = new ScriptDiffService().diff('const a = 1;\nconst b = 2;', 'const a = 1;\nconst b = 3;');

    expect(diff.changedLines).toBe(1);
    expect(diff.hunks[0]?.line).toBe(2);
  });
});
