import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { V2_TOOL_CATALOG } from '../src/server/v2/tools/createV2Tools.js';

async function main() {
  const toolNames = new Set<string>();
  for (const tool of V2_TOOL_CATALOG) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate v2 tool name detected: ${tool.name}`);
    }
    toolNames.add(tool.name);
  }

  const requiredFiles = [
    'src/server/V2MCPServer.ts',
    'src/server/v2/tools/createV2Tools.ts',
    'src/server/v2/tools/toolBlueprints.ts',
    'src/server/v2/tools/browserBlueprints.ts',
    'src/server/v2/tools/inspectBlueprints.ts',
    'src/server/v2/tools/debugBlueprints.ts',
    'src/server/v2/tools/analyzeBlueprints.ts',
    'src/server/v2/tools/hookBlueprints.ts',
    'src/server/v2/tools/flowBlueprints.ts',
    'src/server/v2/tools/toolCatalogStats.ts',
    'src/server/v2/tools/benchmarkMetrics.ts',
    'src/server/v2/legacy/LegacyToolBridge.ts',
    'server.json',
    'package.json',
  ];

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      throw new Error(`Required file missing: ${file}`);
    }
  }

  const packageJson = JSON.parse(await readFile('package.json', 'utf-8')) as { version: string };
  const serverJson = JSON.parse(await readFile('server.json', 'utf-8')) as { version: string };
  if (packageJson.version !== serverJson.version) {
    throw new Error(`Version mismatch between package.json (${packageJson.version}) and server.json (${serverJson.version})`);
  }

  console.log(`Verified ${V2_TOOL_CATALOG.length} v2 tools and core module presence.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
