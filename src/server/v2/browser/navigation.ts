import type { BrowserWaitUntil, NavigationPlan, WaitProfile } from '../contracts.js';

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function normalizeWaitProfile(waitProfile?: string, waitUntil?: string): WaitProfile {
  if (waitProfile === 'interactive' || waitProfile === 'network-quiet' || waitProfile === 'spa' || waitProfile === 'streaming') {
    return waitProfile;
  }

  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2') {
    return 'network-quiet';
  }

  if (waitUntil === 'domcontentloaded') {
    return 'interactive';
  }

  return 'network-quiet';
}

export function buildNavigationPlan(options: {
  waitProfile?: string;
  waitUntil?: string;
  timeout?: number;
}): NavigationPlan {
  const waitProfile = normalizeWaitProfile(options.waitProfile, options.waitUntil);
  const timeout = typeof options.timeout === 'number' ? options.timeout : undefined;
  const preferredWaitUntil = options.waitUntil as BrowserWaitUntil | undefined;

  const attemptsByProfile: Record<WaitProfile, BrowserWaitUntil[]> = {
    interactive: ['domcontentloaded', 'load'],
    'network-quiet': ['networkidle2', 'load', 'domcontentloaded'],
    spa: ['domcontentloaded', 'load', 'networkidle2'],
    streaming: ['domcontentloaded', 'load'],
  };

  const attempts = unique(
    [
      preferredWaitUntil,
      ...attemptsByProfile[waitProfile],
    ].filter(Boolean) as BrowserWaitUntil[]
  ).map((waitUntil) => ({
    waitUntil,
    timeout,
  }));

  return {
    waitProfile,
    attempts,
  };
}

export function toPlaywrightWaitUntil(waitUntil: BrowserWaitUntil): 'load' | 'domcontentloaded' | 'networkidle' {
  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2') {
    return 'networkidle';
  }

  if (waitUntil === 'domcontentloaded') {
    return 'domcontentloaded';
  }

  return 'load';
}
