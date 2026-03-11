import { existsSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';

interface PackResult {
  filename: string;
}

function runPack(): PackResult {
  const command = process.env.ComSpec || 'cmd.exe';
  const output = execFileSync(command, ['/d', '/s', '/c', 'npm pack --json --ignore-scripts'], {
    encoding: 'utf-8',
  });
  const parsed = JSON.parse(output) as PackResult[];
  if (!parsed[0]?.filename) {
    throw new Error('npm pack did not return a tarball filename');
  }
  return parsed[0];
}

function main() {
  const result = runPack();
  if (!existsSync(result.filename)) {
    throw new Error(`Expected tarball not found: ${result.filename}`);
  }

  unlinkSync(result.filename);
  console.log(`Package smoke test passed for ${result.filename}`);
}

main();
