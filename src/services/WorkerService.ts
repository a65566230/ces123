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

const WORKER_SOURCE = `
const { parentPort } = require('worker_threads');
const crypto = require('crypto');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

function fingerprint(code) {
  const lowerCode = code.toLowerCase();
  const obfuscationSignals = [];
  const apiSignals = [];
  if (/_0x[a-f0-9]+/i.test(code)) obfuscationSignals.push('hex-array-identifiers');
  if (code.includes('eval(')) obfuscationSignals.push('eval-usage');
  if (code.includes('Function(')) obfuscationSignals.push('dynamic-function-constructor');
  for (const signal of ['fetch(', 'XMLHttpRequest', 'crypto.subtle', 'WebSocket', 'Authorization', 'signature', 'token']) {
    if (code.includes(signal)) apiSignals.push(signal);
  }
  let probableBundler = 'unknown';
  if (code.includes('__webpack_require__')) probableBundler = 'webpack';
  else if (code.includes('import.meta.hot') || code.includes('__vite_ssr_exports__')) probableBundler = 'vite';
  else if (lowerCode.includes('parcelrequire')) probableBundler = 'parcel';
  else if (code.includes('function __require')) probableBundler = 'rollup';
  return {
    sha256: crypto.createHash('sha256').update(code).digest('hex'),
    sizeBytes: code.length,
    lineCount: code.split(/\\r?\\n/).length,
    probableBundler,
    probableMinified: code.length > 1000 && !code.includes('\\n'),
    obfuscationSignals,
    apiSignals,
  };
}

function rankFunctions(code) {
  const ast = parser.parse(code, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const ranked = [];
  function inspectNode(node, name) {
    const preview = generate(node).code.slice(0, 240);
    const reasons = [];
    let score = 0;
    for (const [pattern, reason, weight] of [
      [/sign|signature|token|nonce|timestamp/i, 'request-signing-keywords', 5],
      [/crypto|encrypt|decrypt|hmac|sha|md5/i, 'crypto-keywords', 5],
      [/fetch|xmlhttprequest|authorization|headers/i, 'network-keywords', 4],
      [/eval|Function\\(/i, 'dynamic-execution', 2],
    ]) {
      if (pattern.test(preview)) {
        reasons.push(reason);
        score += weight;
      }
    }
    if (preview.length > 180) {
      reasons.push('large-function-body');
      score += 1;
    }
    return { name, line: node.loc?.start.line || 0, score, reasons, preview };
  }
  traverse(ast, {
    FunctionDeclaration(path) {
      ranked.push(inspectNode(path.node, path.node.id?.name || 'anonymous'));
    },
    FunctionExpression(path) {
      const parent = path.parent;
      const name = parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : 'anonymous';
      ranked.push(inspectNode(path.node, name));
    },
    ArrowFunctionExpression(path) {
      const parent = path.parent;
      const name = parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : 'arrow';
      ranked.push(inspectNode(path.node, name));
    },
    ObjectMethod(path) {
      const key = path.node.key;
      const name = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : 'object-method';
      ranked.push(inspectNode(path.node, name));
    },
  });
  return ranked.filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 20);
}

function searchScripts(payload) {
  const escapeRegex = (value) => String(value).replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
  const regex = payload.searchMode === 'regex'
    ? new RegExp(payload.keyword, 'gi')
    : new RegExp(escapeRegex(payload.keyword), 'gi');
  const matches = [];
  for (const script of payload.scripts) {
    const lines = String(script.source || '').split('\\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) continue;
      const found = Array.from(line.matchAll(regex));
      for (const match of found) {
        matches.push({
          scriptId: script.scriptId,
          url: script.url,
          line: lineIndex + 1,
          column: match.index || 0,
          matchText: match[0],
          context: line,
          chunkRef: \`\${script.scriptId}:0\`,
        });
        if (matches.length >= payload.maxResults) {
          return {
            keyword: payload.keyword,
            searchMode: payload.searchMode,
            totalMatches: matches.length,
            truncated: false,
            matches,
            executionMode: 'worker',
          };
        }
      }
    }
  }
  return {
    keyword: payload.keyword,
    searchMode: payload.searchMode,
    totalMatches: matches.length,
    truncated: false,
    matches,
    executionMode: 'worker',
  };
}

function extractFunctionTree(payload) {
  const ast = parser.parse(payload.code, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const allFunctions = new Map();
  const callGraph = {};
  function extractDependencies(path) {
    const deps = new Set();
    path.traverse({
      CallExpression(callPath) {
        if (t.isIdentifier(callPath.node.callee)) deps.add(callPath.node.callee.name);
      },
    });
    return Array.from(deps);
  }
  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name) return;
      const code = generate(path.node, { comments: payload.includeComments !== false }).code;
      const deps = extractDependencies(path);
      allFunctions.set(name, { name, code, startLine: path.node.loc?.start.line || 0, endLine: path.node.loc?.end.line || 0, dependencies: deps, size: code.length });
      callGraph[name] = deps;
    },
    VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id) && (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))) {
        const name = path.node.id.name;
        const code = generate(path.node, { comments: payload.includeComments !== false }).code;
        const deps = extractDependencies(path);
        allFunctions.set(name, { name, code, startLine: path.node.loc?.start.line || 0, endLine: path.node.loc?.end.line || 0, dependencies: deps, size: code.length });
        callGraph[name] = deps;
      }
    },
    ObjectMethod(path) {
      const key = path.node.key;
      const name = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : undefined;
      if (!name) return;
      const code = generate(path.node, { comments: payload.includeComments !== false }).code;
      const deps = extractDependencies(path);
      allFunctions.set(name, { name, code, startLine: path.node.loc?.start.line || 0, endLine: path.node.loc?.end.line || 0, dependencies: deps, size: code.length });
      callGraph[name] = deps;
    },
  });
  const extracted = new Set();
  const queue = [payload.functionName];
  let depth = 0;
  while (queue.length > 0 && depth < (payload.maxDepth || 3)) {
    const current = queue.shift();
    if (!current || extracted.has(current)) continue;
    const func = allFunctions.get(current);
    if (!func) continue;
    extracted.add(current);
    for (const dep of func.dependencies) {
      if (!extracted.has(dep) && allFunctions.has(dep)) queue.push(dep);
    }
    depth += 1;
  }
  const functions = Array.from(extracted).map((name) => allFunctions.get(name)).filter(Boolean);
  const code = functions.map((item) => item.code).join('\\n\\n');
  return {
    mainFunction: payload.functionName,
    code,
    functions,
    callGraph,
    totalSize: code.length,
    extractedCount: functions.length,
    executionMode: 'worker',
  };
}

function analyze(payload) {
  if (payload.kind === 'sleep') {
    return new Promise((resolve) => setTimeout(() => resolve({ kind: 'sleep', durationMs: payload.durationMs }), payload.durationMs));
  }
  if (payload.kind === 'bundle-fingerprint') return { kind: 'bundle-fingerprint', executionMode: 'worker', result: fingerprint(payload.code || '') };
  if (payload.kind === 'rank-functions') return { kind: 'rank-functions', executionMode: 'worker', result: rankFunctions(payload.code || '') };
  if (payload.kind === 'obfuscation-prescan') {
    const code = payload.code || '';
    return {
      kind: 'obfuscation-prescan',
      executionMode: 'worker',
      result: {
        hasHexArrayIdentifiers: /_0x[a-f0-9]+/i.test(code),
        hasEval: code.includes('eval('),
        hasDynamicFunction: code.includes('Function('),
        probableMinified: code.length > 1000 && !code.includes('\\n'),
      },
    };
  }
  return { kind: payload.kind, executionMode: 'worker', result: null };
}

parentPort.on('message', async (task) => {
  try {
    let result;
    if (task.type === 'search') result = searchScripts(task.payload);
    else if (task.type === 'ast') result = extractFunctionTree(task.payload);
    else result = await analyze(task.payload);
    parentPort.postMessage({ taskId: task.taskId, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ taskId: task.taskId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

export class WorkerService {
  private readonly maxWorkers: number;
  private readonly taskTimeoutMs: number;
  private readonly workers: WorkerRunnerHandle[] = [];
  private readonly pendingResolvers = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
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
    await Promise.all(this.workers.map((runner) => runner.worker.terminate()));
    this.workers.length = 0;
    this.queuedTasks = [];
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
    const runner = this.workers.find((candidate) => candidate.busy === false) || (this.workers.length < this.maxWorkers ? this.createWorker() : undefined);
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
    const worker = new Worker(WORKER_SOURCE, { eval: true });
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
