import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { parseCodexExecJsonl } from '../src/server/v2/tools/codexExecJsonl.js';
import {
  buildCodexExecInvocations,
  decideCodexExecNextStep,
} from '../src/server/v2/tools/codexExecInvocation.js';
import { startFixtureServer } from '../tests/helpers/fixtureServer.js';

const benchmarkDir = path.join(process.cwd(), 'benchmarks', 'real-clients');
const outputPath = path.join(benchmarkDir, 'codex-native-mcp-expert.json');

function writeTempSchema(): string {
  const tempPath = path.join(process.cwd(), '.cache-test', `codex-benchmark-schema-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['success', 'toolsUsed', 'sessionId', 'artifactId', 'shortFinding'],
    properties: {
      success: { type: 'boolean' },
      toolsUsed: {
        type: 'array',
        items: { type: 'string' },
      },
      sessionId: { type: 'string' },
      artifactId: { type: 'string' },
      evidenceIds: {
        type: 'array',
        items: { type: 'string' },
      },
      shortFinding: { type: 'string' },
    },
  }, null, 2));
  return path.relative(process.cwd(), tempPath).replace(/\\/g, '/');
}

function readTextFileIfPresent(filePath: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }
  const text = fs.readFileSync(filePath, 'utf8').trim();
  return text || undefined;
}

async function runInvocation(invocation: { command: string; args: string[]; shell?: boolean }, prompt: string, timeoutMs: number) {
  return await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
    timedOut: boolean;
    repeatedDisconnects: number;
  }>((resolve) => {
    let child;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: process.cwd(),
        env: process.env,
        shell: invocation.shell === true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        status: null,
        stdout: '',
        stderr: '',
        error: error as Error,
        timedOut: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    let repeatedDisconnects = 0;
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill();
      resolve({
        status: null,
        stdout,
        stderr,
        error: new Error(`Invocation timed out after ${timeoutMs}ms`),
        timedOut: true,
        repeatedDisconnects,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (text.includes('stream disconnected - retrying sampling request')) {
        repeatedDisconnects += 1;
        const elapsedMs = Date.now() - startedAt;
        if (!finished && repeatedDisconnects >= 8 && elapsedMs >= 45_000) {
          finished = true;
          clearTimeout(timeout);
          child.kill();
          resolve({
            status: null,
            stdout,
            stderr,
            error: new Error(`Invocation aborted after ${repeatedDisconnects} repeated stream disconnects`),
            timedOut: false,
            repeatedDisconnects,
          });
        }
      }
    });
    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve({
        status: null,
        stdout,
        stderr,
        error,
        timedOut: false,
        repeatedDisconnects,
      });
    });
    child.on('exit', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve({
        status: code,
        stdout,
        stderr,
        timedOut: false,
        repeatedDisconnects,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function main() {
  const fixture = await startFixtureServer(path.resolve(process.cwd(), 'tests/fixtures'));
  const schemaPath = writeTempSchema();
  const lastMessagePath = path.join(process.cwd(), '.cache-test', `codex-benchmark-last-message-${Date.now()}.json`);

  try {
    const prompt = [
      'Use the configured JSHook MCP tools to inspect this local site.',
      `Open ${fixture.origin}/basic/index.html with flow.collect-site, then call flow.reverse-report with focus overview.`,
      'Return the result required by the JSON schema only.',
      'toolsUsed must list the MCP tools you actually used.',
      'shortFinding should be one short sentence.',
    ].join(' ');

    let result;
    let terminationReason: string | undefined;
    const invocations = buildCodexExecInvocations(process.platform, schemaPath, { outputLastMessagePath: lastMessagePath });
    const invocationDiagnostics: Array<{
      command: string;
      shell?: boolean;
      spawnError?: string;
      rawStatus?: number;
      timedOut?: boolean;
      repeatedDisconnects?: number;
      attempt?: number;
      decision?: string;
      decisionReason?: string;
    }> = [];
    outer:
    for (const [invocationIndex, invocation] of invocations.entries()) {
      const maxAttempts = invocation.command === process.execPath ? 2 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        result = await runInvocation(invocation, prompt, 300000);
        const parsedAttempt = parseCodexExecJsonl(String(result.stdout || ''));
        const lastMessageText = readTextFileIfPresent(lastMessagePath);
        const hasUsableOutput = Boolean(parsedAttempt.finalText || lastMessageText);
        const decision = decideCodexExecNextStep(result, {
          attempt,
          maxAttempts,
          hasUsableOutput,
          isLastInvocation: invocationIndex === invocations.length - 1,
        });
        invocationDiagnostics.push({
          command: invocation.command,
          shell: invocation.shell === true,
          spawnError: result.error ? String(result.error) : undefined,
          rawStatus: result.status ?? 1,
          timedOut: result.timedOut,
          repeatedDisconnects: result.repeatedDisconnects,
          attempt,
          decision: decision.action,
          decisionReason: decision.reason,
        });
        terminationReason = decision.reason;
        if (decision.action === 'accept') {
          break outer;
        }
        if (decision.action === 'retry-invocation') {
          continue;
        }
        if (decision.action === 'next-invocation') {
          break;
        }
        break outer;
      }
    }

    const parsed = parseCodexExecJsonl(String(result?.stdout || ''));
    const lastMessageText = readTextFileIfPresent(lastMessagePath);
    const finalText = parsed.finalText || lastMessageText;
    const finalJson = finalText
      ? JSON.parse(finalText)
      : {};
    const payload = {
      client: 'codex',
      clientVersion: 'cli',
      model: 'default',
      profile: 'expert',
      transport: 'native-mcp',
      scenario: 'fresh-triage',
      success: result?.status === 0 && finalJson.success === true,
      turnCount: parsed.usage ? 1 : 0,
      toolCalls: Array.isArray(finalJson.toolsUsed) ? finalJson.toolsUsed.length : 0,
      usage: parsed.usage,
      result: finalJson,
      spawnError: result?.error ? String(result.error) : undefined,
      rawStatus: result?.status ?? 1,
      stderr: String(result?.stderr || '').trim(),
      terminationReason,
      invocationDiagnostics,
    };

    fs.mkdirSync(benchmarkDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify({
      outputPath,
      payload,
    }, null, 2));
  } finally {
    try {
      fs.unlinkSync(path.join(process.cwd(), schemaPath));
    } catch {
      // ignore cleanup failure
    }
    try {
      fs.unlinkSync(lastMessagePath);
    } catch {
      // ignore cleanup failure
    }
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
