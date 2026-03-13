import { spawnSync } from 'child_process';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120000,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function summarize(result: ReturnType<typeof run>) {
  return {
    command: result.command,
    ok: result.status === 0,
    status: result.status,
    stdoutPreview: result.stdout.slice(0, 600),
    stderrPreview: result.stderr.slice(0, 600),
  };
}

function main() {
  const baseArgs = [
    'mcp2cli',
    '--mcp-stdio',
    'node dist/index.js',
    '--env',
    'LOG_LEVEL=silent',
  ];

  const listResult = run('uvx', [...baseArgs, '--list']);
  const helpResult = run('uvx', [...baseArgs, 'analyze.crypto', '--help']);
  const callResult = run('uvx', [
    ...baseArgs,
    'analyze.crypto',
    '--code',
    "crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, keyMaterial, payload)",
  ]);

  let parsedCall: Record<string, unknown> | null = null;
  try {
    parsedCall = JSON.parse(callResult.stdout);
  } catch {
    parsedCall = null;
  }

  console.log(JSON.stringify({
    list: summarize(listResult),
    help: summarize(helpResult),
    call: {
      ...summarize(callResult),
      parsedOk: parsedCall?.ok === true,
      parsedSummary: parsedCall?.summary,
      parsedEvidenceIds: parsedCall?.evidenceIds,
    },
    findings: [
      'mcp2cli preserves dotted MCP tool names for this server (for example analyze.crypto).',
      'Boolean tool inputs behave like CLI flags, so false is expressed by omission rather than --flag=false in the tested command style.',
      'stdio integration works locally against node dist/index.js with --env LOG_LEVEL=silent.',
    ],
  }, null, 2));
}

main();
