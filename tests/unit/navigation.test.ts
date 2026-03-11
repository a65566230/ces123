import { buildNavigationPlan } from '../../src/server/v2/browser/navigation.js';

describe('navigation planning', () => {
  test('uses fallback wait chain for network-quiet profile', () => {
    const plan = buildNavigationPlan({
      waitProfile: 'network-quiet',
      timeout: 12_000,
    });

    expect(plan.waitProfile).toBe('network-quiet');
    expect(plan.attempts.map((attempt) => attempt.waitUntil)).toEqual([
      'networkidle2',
      'load',
      'domcontentloaded',
    ]);
    expect(plan.attempts[0]?.timeout).toBe(12_000);
  });

  test('prefers domcontentloaded for streaming profile', () => {
    const plan = buildNavigationPlan({
      waitProfile: 'streaming',
    });

    expect(plan.attempts.map((attempt) => attempt.waitUntil)).toEqual(['domcontentloaded', 'load']);
  });
});
