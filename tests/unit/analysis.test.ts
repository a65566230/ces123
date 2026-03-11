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

  test('summarizes line-level diffs', () => {
    const diff = new ScriptDiffService().diff('const a = 1;\nconst b = 2;', 'const a = 1;\nconst b = 3;');

    expect(diff.changedLines).toBe(1);
    expect(diff.hunks[0]?.line).toBe(2);
  });
});
