import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { config as dotenvConfig } from 'dotenv';
import type { Config } from '../types/index.js';

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = dirname(currentFilename);
const projectRoot = join(currentDirname, '..', '..');
const envPath = join(projectRoot, '.env');
const dotenvResult = dotenvConfig({ path: envPath });

if (dotenvResult.error) {
  console.error(`[Config] Warning: failed to load .env from ${envPath}`);
  console.error(`[Config] ${dotenvResult.error.message}`);
  console.error('[Config] Falling back to process environment and defaults');
} else if (process.env.DEBUG === 'true') {
  console.error(`[Config] Loaded .env from ${envPath}`);
  console.error(`[Config] Working directory: ${process.cwd()}`);
  console.error(`[Config] Project root: ${projectRoot}`);
}

function resolveCacheDir(cacheDir: string): string {
  return cacheDir.startsWith('/') || /^[A-Za-z]:/.test(cacheDir)
    ? cacheDir
    : join(projectRoot, cacheDir);
}

export function getConfig(): Config {
  const cacheDir = process.env.CACHE_DIR || '.cache';
  const resolvedCacheDir = resolveCacheDir(cacheDir);
  const storagePath = process.env.STORAGE_PATH || join(resolvedCacheDir, 'jshook-storage.sqlite');

  return {
    llm: {
      provider: (process.env.DEFAULT_LLM_PROVIDER as 'openai' | 'anthropic') || 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
        baseURL: process.env.OPENAI_BASE_URL,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      },
    },
    puppeteer: {
      headless: process.env.PUPPETEER_HEADLESS === 'true',
      timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '30000', 10),
    },
    mcp: {
      name: process.env.MCP_SERVER_NAME || 'jshook-reverse-tool',
      version: process.env.MCP_SERVER_VERSION || '2.0.0',
    },
    cache: {
      enabled: process.env.ENABLE_CACHE === 'true',
      dir: resolvedCacheDir,
      ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
    },
    storage: {
      path: storagePath,
      cacheSize: parseInt(process.env.STORAGE_CACHE_SIZE || '500', 10),
    },
    worker: {
      maxWorkers: parseInt(process.env.WORKER_MAX_WORKERS || `${Math.max(1, Math.min(4, os.cpus().length - 1 || 1))}`, 10),
      taskTimeoutMs: parseInt(process.env.WORKER_TASK_TIMEOUT_MS || '30000', 10),
    },
    llmCache: {
      enabled: process.env.LLM_CACHE_ENABLED !== 'false',
      maxEntries: parseInt(process.env.LLM_CACHE_MAX_ENTRIES || '500', 10),
      ttlSeconds: parseInt(process.env.LLM_CACHE_TTL_SECONDS || '86400', 10),
    },
    rateLimit: {
      maxCalls: parseInt(process.env.RATE_LIMIT_MAX_CALLS || '10', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '1000', 10),
    },
    performance: {
      maxConcurrentAnalysis: parseInt(process.env.MAX_CONCURRENT_ANALYSIS || '3', 10),
      maxCodeSizeMB: parseInt(process.env.MAX_CODE_SIZE_MB || '10', 10),
    },
  };
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.performance.maxConcurrentAnalysis < 1) {
    errors.push('maxConcurrentAnalysis must be at least 1');
  }

  if (config.performance.maxCodeSizeMB < 1) {
    errors.push('maxCodeSizeMB must be at least 1');
  }

  if (config.storage.cacheSize < 1) {
    errors.push('storage.cacheSize must be at least 1');
  }

  if (config.worker.maxWorkers < 1) {
    errors.push('worker.maxWorkers must be at least 1');
  }

  if (config.worker.taskTimeoutMs < 1) {
    errors.push('worker.taskTimeoutMs must be at least 1');
  }

  if (config.llmCache.maxEntries < 1) {
    errors.push('llmCache.maxEntries must be at least 1');
  }

  if (config.rateLimit.maxCalls < 1) {
    errors.push('rateLimit.maxCalls must be at least 1');
  }

  if (config.rateLimit.windowMs < 1) {
    errors.push('rateLimit.windowMs must be at least 1');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
