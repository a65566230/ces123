import { execFileSync } from 'child_process';
import path from 'path';

describe('config defaults', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('uses the current manifest server version when MCP_SERVER_VERSION is not set', () => {
    delete process.env.MCP_SERVER_VERSION;
    const tsxCli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const script = [
      "import { getConfig } from './src/utils/config.ts';",
      'const config = getConfig();',
      "console.log(JSON.stringify({ version: config.mcp.version }));",
    ].join('\n');

    const output = execFileSync(process.execPath, [tsxCli, '--eval', script], {
      cwd: path.resolve(process.cwd()),
      env: {
        ...process.env,
        MCP_SERVER_VERSION: '',
      },
      encoding: 'utf8',
    });

    const parsed = JSON.parse(output.trim()) as { version: string };
    expect(parsed.version).toBe('2.0.1');
  });
});
