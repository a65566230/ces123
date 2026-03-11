import type { Config } from '../../src/types/index.js';

export function createTestConfig(): Config {
  const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.round(Math.random() * 100000)}`;

  return {
    llm: {
      provider: 'openai',
      openai: {
        apiKey: '',
        model: 'gpt-4o-mini',
      },
      anthropic: {
        apiKey: '',
        model: 'claude-3-5-sonnet-20241022',
      },
    },
    browser: {
      headless: true,
      timeout: 30000,
      viewport: {
        width: 1280,
        height: 720,
      },
    },
    mcp: {
      name: 'jshook-reverse-tool-test',
      version: '2.0.0-test',
    },
    cache: {
      enabled: false,
      dir: '.cache-test',
      ttl: 60,
    },
    storage: {
      path: `.cache-test/jshook-storage-test-${uniqueSuffix}.sqlite`,
      cacheSize: 32,
    },
    worker: {
      maxWorkers: 2,
      taskTimeoutMs: 5000,
    },
    llmCache: {
      enabled: true,
      maxEntries: 64,
      ttlSeconds: 3600,
    },
    rateLimit: {
      maxCalls: 10,
      windowMs: 1000,
    },
    performance: {
      maxConcurrentAnalysis: 2,
      maxCodeSizeMB: 5,
    },
  };
}
