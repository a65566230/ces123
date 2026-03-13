import { summarizeAcceptanceBenchmarkRuns } from '../../src/server/v2/tools/acceptanceBenchmarkSummary.js';

describe('acceptance benchmark summary', () => {
  test('aggregates per-scenario and per-surface pass/fail counts', () => {
    const summary = summarizeAcceptanceBenchmarkRuns([
      { scenario: 'songmid', surface: 'v2', success: true },
      { scenario: 'vkey', surface: 'v2', success: false },
      { scenario: 'high-noise', surface: 'v2', success: true },
      { scenario: 'songmid', surface: 'legacy', success: true },
    ]);

    expect(summary.totalRuns).toBe(4);
    expect(summary.successfulRuns).toBe(3);
    expect(summary.failedRuns).toBe(1);
    expect(summary.surfaceUsage.v2).toBe(3);
    expect(summary.surfaceUsage.legacy).toBe(1);
    expect(summary.scenarioUsage.songmid).toBe(2);
    expect(summary.scenarioSuccess.songmid.passes).toBe(2);
    expect(summary.scenarioSuccess.vkey.failures).toBe(1);
  });
});
