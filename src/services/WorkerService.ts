import path from 'path';
import { existsSync } from 'fs';
import os from 'os';
import { Worker } from 'worker_threads';

export interface WorkerServiceOptions {
  maxWorkers?: number;
  taskTimeoutMs?: number;
}

export interface WorkerSearchScript {
  scriptId: string;
  url: string;
  source: string;
}

export interface WorkerSearchTaskInput {
  keyword: string;
  searchMode: 'indexed' | 'substring' | 'regex';
  maxResults: number;
  maxBytes: number;
  scripts: WorkerSearchScript[];
}

export interface WorkerAstTaskInput {
  kind: 'function-tree';
  code: string;
  functionName: string;
  maxDepth?: number;
  maxSizeKb?: number;
  includeComments?: boolean;
}

export interface WorkerAnalysisTaskInput {
  kind: 'bundle-fingerprint' | 'rank-functions' | 'obfuscation-prescan' | 'sleep';
  code?: string;
  durationMs?: number;
}

interface WorkerTaskEnvelope {
  taskId: string;
  type: 'search' | 'ast' | 'analysis';
  payload: unknown;
}

interface WorkerRunnerHandle {
  worker: Worker;
  busy: boolean;
  taskId?: string;
}

interface PendingResolver {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function resolveWorkerEntry(): { entry: string | URL; useTsxLoader: boolean } {
  const compiledEntry = process.argv[1]
    ? path.resolve(path.dirname(process.argv[1]), 'services', 'worker-runtime.worker.js')
    : path.resolve(process.cwd(), 'dist/services/worker-runtime.worker.js');
  if (existsSync(compiledEntry)) {
    return {
      entry: compiledEntry,
      useTsxLoader: false,
    };
  }

  const sourceEntry = path.resolve(process.cwd(), 'src/services/worker-runtime.worker.ts');
  return {
    entry: sourceEntry,
    useTsxLoader: true,
  };
}

export class WorkerService {
  private readonly maxWorkers: number;
  private readonly taskTimeoutMs: number;
  private readonly workers: WorkerRunnerHandle[] = [];
  private readonly pendingResolvers = new Map<string, PendingResolver>();
  private taskCounter = 0;
  private queuedTasks: WorkerTaskEnvelope[] = [];
  private completedTasks = 0;

  public constructor(options: WorkerServiceOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? Math.max(1, Math.min(4, os.cpus().length - 1));
    this.taskTimeoutMs = options.taskTimeoutMs ?? 30000;
  }

  public async runSearchTask(payload: WorkerSearchTaskInput): Promise<Record<string, unknown>> {
    return this.runTask('search', payload) as Promise<Record<string, unknown>>;
  }

  public async runAstTask(payload: WorkerAstTaskInput): Promise<Record<string, unknown>> {
    return this.runTask('ast', payload) as Promise<Record<string, unknown>>;
  }

  public async runAnalysisTask(payload: WorkerAnalysisTaskInput): Promise<Record<string, unknown>> {
    return this.runTask('analysis', payload) as Promise<Record<string, unknown>>;
  }

  public getStats(): { maxWorkers: number; activeWorkers: number; queuedTasks: number; completedTasks: number } {
    return {
      maxWorkers: this.maxWorkers,
      activeWorkers: this.workers.filter((worker) => worker.busy).length,
      queuedTasks: this.queuedTasks.length,
      completedTasks: this.completedTasks,
    };
  }

  public async close(): Promise<void> {
    for (const [taskId, pending] of this.pendingResolvers) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Worker task cancelled during shutdown: ${taskId}`));
    }
    this.pendingResolvers.clear();
    this.queuedTasks = [];

    await Promise.all(this.workers.map((runner) => runner.worker.terminate()));
    this.workers.length = 0;
  }

  private async runTask(type: WorkerTaskEnvelope['type'], payload: unknown): Promise<unknown> {
    const taskId = `worker-task-${Date.now()}-${++this.taskCounter}`;
    const task: WorkerTaskEnvelope = {
      taskId,
      type,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResolvers.delete(taskId);
        reject(new Error('Worker task timed out'));
      }, this.taskTimeoutMs);

      this.pendingResolvers.set(taskId, { resolve, reject, timeout });
      this.queuedTasks.push(task);
      this.schedule();
    });
  }

  private schedule(): void {
    const runner = this.workers.find((candidate) => candidate.busy === false)
      || (this.workers.length < this.maxWorkers ? this.createWorker() : undefined);
    if (!runner) {
      return;
    }

    const task = this.queuedTasks.shift();
    if (!task) {
      return;
    }

    runner.busy = true;
    runner.taskId = task.taskId;
    runner.worker.postMessage(task);
  }

  private createWorker(): WorkerRunnerHandle {
    const { entry, useTsxLoader } = resolveWorkerEntry();
    const worker = new Worker(entry, {
      execArgv: useTsxLoader ? ['--import', 'tsx'] : undefined,
    });
    const handle: WorkerRunnerHandle = {
      worker,
      busy: false,
    };

    worker.on('message', (message: { taskId: string; ok: boolean; result?: unknown; error?: string }) => {
      const resolver = this.pendingResolvers.get(message.taskId);
      if (resolver) {
        clearTimeout(resolver.timeout);
        this.pendingResolvers.delete(message.taskId);
        if (message.ok) {
          this.completedTasks += 1;
          resolver.resolve(message.result);
        } else {
          resolver.reject(new Error(message.error || 'Worker task failed'));
        }
      }
      handle.busy = false;
      handle.taskId = undefined;
      this.schedule();
    });

    worker.on('error', (error) => {
      if (handle.taskId) {
        const resolver = this.pendingResolvers.get(handle.taskId);
        if (resolver) {
          clearTimeout(resolver.timeout);
          this.pendingResolvers.delete(handle.taskId);
          resolver.reject(error);
        }
      }
      handle.busy = false;
      handle.taskId = undefined;
    });

    this.workers.push(handle);
    return handle;
  }
}
