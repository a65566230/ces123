import { summarizeBenchmarkRuns } from '../../src/server/v2/tools/realBenchmarkSummary.js';

describe('real benchmark summary', () => {
  test('aggregates recommendation signals from benchmark runs', () => {
    const summary = summarizeBenchmarkRuns([
      {
        client: 'codex',
        profile: 'core',
        transport: 'native-mcp',
        scenario: 'request-tracing',
        success: true,
        responseModeResults: {
          'inspect.network': {
            recommendedMode: 'compact',
          },
        },
      },
      {
        client: 'claude-desktop',
        profile: 'expert',
        transport: 'mcp2cli',
        scenario: 'fresh-triage',
        success: true,
        responseModeResults: {
          'inspect.network': {
            recommendedMode: 'full',
          },
        },
      },
      {
        client: 'claude-desktop',
        profile: 'core',
        transport: 'native-mcp',
        scenario: 'signature-path',
        success: false,
        responseModeResults: {},
      },
    ]);

    expect(summary.totalRuns).toBe(3);
    expect(summary.successfulRuns).toBe(2);
    expect(summary.profileUsage.core).toBe(2);
    expect(summary.transportUsage['mcp2cli']).toBe(1);
    expect(summary.responseModeRecommendations['inspect.network'].compact).toBe(1);
    expect(summary.responseModeRecommendations['inspect.network'].full).toBe(1);
  });
});
