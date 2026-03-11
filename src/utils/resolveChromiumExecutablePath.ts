import { existsSync } from 'fs';

const PLATFORM_CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ],
};

export function resolveChromiumExecutablePath(preferredPath?: string): string {
  if (preferredPath && existsSync(preferredPath)) {
    return preferredPath;
  }

  const envPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const candidates = PLATFORM_CANDIDATES[process.platform] || [];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved) {
    return resolved;
  }

  throw new Error(
    'No Chromium-based browser executable was found. Set PLAYWRIGHT_EXECUTABLE_PATH to a local Chrome, Chromium, or Edge binary.',
  );
}
