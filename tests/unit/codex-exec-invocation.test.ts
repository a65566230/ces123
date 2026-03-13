import {
  buildCodexExecInvocation,
  buildCodexExecInvocations,
  decideCodexExecNextStep,
} from '../../src/server/v2/tools/codexExecInvocation.js';

describe('buildCodexExecInvocation', () => {
  const originalAppData = process.env.APPDATA;

  beforeEach(() => {
    process.env.APPDATA = 'C:\\Users\\Administrator\\AppData\\Roaming';
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
  });

  test('uses codex.cmd directly on Windows', () => {
    const invocation = buildCodexExecInvocation('win32', 'tmp/schema.json');

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.shell).toBe(false);
    expect(invocation.args).toEqual([
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec',
      '--json',
      '--color',
      'never',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema',
      'tmp/schema.json',
      '-',
    ]);
  });

  test('uses codex directly on non-Windows platforms', () => {
    const invocation = buildCodexExecInvocation('linux', 'tmp/schema.json');

    expect(invocation.command).toBe('codex');
    expect(invocation.shell).toBe(false);
    expect(invocation.args).toEqual([
      'exec',
      '--json',
      '--color',
      'never',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema',
      'tmp/schema.json',
      '-',
    ]);
  });

  test('provides a Windows fallback invocation through cmd.exe', () => {
    const invocations = buildCodexExecInvocations('win32', 'tmp/schema.json');

    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toEqual({
      command: process.execPath,
      args: [
        'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
        'exec',
        '--json',
        '--color',
        'never',
        '--ephemeral',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '--output-schema',
        'tmp/schema.json',
        '-',
      ],
      shell: false,
    });
    expect(invocations[1]).toEqual({
      command: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'codex exec --json --color never --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-schema tmp/schema.json -',
      ],
      shell: false,
    });
  });

  test('adds output-last-message when a capture path is provided', () => {
    const invocation = buildCodexExecInvocation('win32', 'tmp/schema.json', {
      outputLastMessagePath: 'tmp/last-message.json',
    });

    expect(invocation.args).toEqual([
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec',
      '--json',
      '--color',
      'never',
      '--ephemeral',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema',
      'tmp/schema.json',
      '--output-last-message',
      'tmp/last-message.json',
      '-',
    ]);
  });

  test('aborts the full benchmark when Codex repeatedly disconnects its stream', () => {
    const decision = decideCodexExecNextStep({
      status: null,
      stderr: 'WARN codex_core::codex: stream disconnected - retrying sampling request (8/100 in 27.552s)...',
      timedOut: false,
      repeatedDisconnects: 8,
      error: new Error('Invocation aborted after repeated stream disconnects'),
    }, {
      attempt: 1,
      maxAttempts: 2,
      hasUsableOutput: false,
      isLastInvocation: false,
    });

    expect(decision).toEqual({
      action: 'abort-benchmark',
      reason: 'stream-disconnected',
    });
  });

  test('falls through to the next invocation when the current launcher is invalid', () => {
    const decision = decideCodexExecNextStep({
      status: null,
      stderr: '',
      timedOut: false,
      repeatedDisconnects: 0,
      error: new Error('spawn codex EINVAL'),
    }, {
      attempt: 1,
      maxAttempts: 1,
      hasUsableOutput: false,
      isLastInvocation: false,
    });

    expect(decision).toEqual({
      action: 'next-invocation',
      reason: 'launcher-failure',
    });
  });

  test('accepts usable output even when the child exits non-zero', () => {
    const decision = decideCodexExecNextStep({
      status: 1,
      stderr: '',
      timedOut: false,
      repeatedDisconnects: 0,
    }, {
      attempt: 1,
      maxAttempts: 1,
      hasUsableOutput: true,
      isLastInvocation: false,
    });

    expect(decision).toEqual({
      action: 'accept',
      reason: 'usable-output',
    });
  });
});
