import fs from 'fs';
import path from 'path';
import { summarizeBenchmarkRuns } from '../src/server/v2/tools/realBenchmarkSummary.js';

const benchmarkDir = path.join(process.cwd(), 'benchmarks', 'real-clients');

function readRuns() {
  if (!fs.existsSync(benchmarkDir)) {
    return [];
  }

  const files = fs.readdirSync(benchmarkDir).filter((file) => file.endsWith('.json'));
  return files.flatMap((file) => {
    const fullPath = path.join(benchmarkDir, file);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

function main() {
  const runs = readRuns();
  console.log(JSON.stringify({
    benchmarkDir,
    summary: summarizeBenchmarkRuns(runs),
  }, null, 2));
}

main();
