import path from 'path';
import { logger } from '../src/utils/logger.js';
import { ToolExecutor } from '../src/server/v2/ToolExecutor.js';
import { ToolRegistry } from '../src/server/v2/ToolRegistry.js';
import { ToolRuntimeContext } from '../src/server/v2/runtime/ToolRuntimeContext.js';
import { resolveRuntimeOptions } from '../src/server/v2/runtime/runtimeOptions.js';
import { createV2Tools } from '../src/server/v2/tools/createV2Tools.js';
import { summarizeAcceptanceBenchmarkRuns } from '../src/server/v2/tools/acceptanceBenchmarkSummary.js';
import { startFixtureServer } from '../tests/helpers/fixtureServer.js';
import { parseToolResponse } from '../tests/helpers/parseToolResponse.js';
import { createTestConfig } from '../tests/helpers/testConfig.js';

async function main() {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  logger.setLevel('silent');
  const fixture = await startFixtureServer(path.resolve(process.cwd(), 'tests/fixtures'));
  const config = createTestConfig();
  const runtime = new ToolRuntimeContext(config, resolveRuntimeOptions(config));
  const executor = new ToolExecutor(new ToolRegistry(createV2Tools(runtime)), runtime);

  const runs: Array<Record<string, unknown>> = [];

  try {
    const scenarios = [
      {
        name: 'songmid',
        requestPattern: 'songmid',
        targetField: 'songmid',
        fieldRole: 'explicit',
        scripts: [
          {
            scriptId: 'vendor-react',
            url: 'https://example.test/vendor/react.production.min.js',
            source: 'function useState(){return 1;}',
            sourceLength: 32,
          },
          {
            scriptId: 'songmid-script',
            url: 'https://example.test/app-songmid.js',
            source: [
              'function buildSongRequest(songmid) {',
              '  const payload = { songmid, nonce: "fixture" };',
              '  return fetch("/api/songmid", { method: "POST", body: JSON.stringify(payload) });',
              '}',
              'window.music.send = buildSongRequest;',
            ].join('\n'),
            sourceLength: 220,
          },
        ],
        validate(candidate: Record<string, unknown>) {
          const actions = (candidate.recommendedActions as Array<Record<string, unknown>>) || [];
          return candidate.scriptId === 'songmid-script'
            && actions.some((item) => item.tool === 'debug.breakpoint')
            && actions.some((item) => item.tool === 'inspect.function-trace');
        },
      },
      {
        name: 'vkey',
        requestPattern: '/api/vkey',
        targetField: 'vkey',
        fieldRole: 'final-signature',
        scripts: [
          {
            scriptId: 'noise-script',
            url: 'https://example.test/noise.js',
            source: 'function token(){ return Date.now().toString(); }',
            sourceLength: 48,
          },
          {
            scriptId: 'vkey-script',
            url: 'https://example.test/app-vkey.js',
            source: [
              'function deriveVkey(seed) {',
              '  const mixed = seed + "::derived";',
              '  return btoa(mixed).slice(0, 12);',
              '}',
              'function sendVkey(seed) {',
              '  const payload = { vkey: deriveVkey(seed), nonce: seed };',
              '  return fetch("/api/vkey", { method: "POST", body: JSON.stringify(payload) });',
              '}',
              'window.auth.send = sendVkey;',
            ].join('\n'),
            sourceLength: 320,
          },
        ],
        preferredValidation: ['inspect.function-trace', 'inspect.interceptor', 'debug.blackbox'],
        validate(candidate: Record<string, unknown>) {
          const actions = (candidate.recommendedActions as Array<Record<string, unknown>>) || [];
          return candidate.scriptId === 'vkey-script'
            && actions[0]?.tool === 'inspect.function-trace'
            && actions.some((item) => item.tool === 'inspect.interceptor');
        },
      },
      {
        name: 'high-noise',
        requestPattern: 'signature',
        targetField: 'signature',
        fieldRole: 'final-signature',
        scripts: [
          {
            scriptId: 'react-vendor',
            url: 'https://example.test/vendor/react.production.min.js',
            source: 'function useState(){return 1;}',
            sourceLength: 32,
          },
          {
            scriptId: 'lodash-vendor',
            url: 'https://example.test/vendor/lodash.min.js',
            source: 'function debounce(){return 1;}',
            sourceLength: 34,
          },
          {
            scriptId: 'analytics-vendor',
            url: 'https://example.test/vendor/analytics.bundle.min.js',
            source: 'function track(){return "noise";}',
            sourceLength: 38,
          },
          {
            scriptId: 'target-script',
            url: 'https://example.test/app-noise.js',
            source: [
              'function finalizeSignature(input) {',
              '  const payload = { signature: input + "-sig", nonce: input };',
              '  return fetch("/api/signature", { method: "POST", body: JSON.stringify(payload) });',
              '}',
              'window.signing.send = finalizeSignature;',
            ].join('\n'),
            sourceLength: 220,
          },
        ],
        validate(candidate: Record<string, unknown>) {
          const actions = (candidate.recommendedActions as Array<Record<string, unknown>>) || [];
          return candidate.scriptId === 'target-script'
            && actions.some((item) => item.tool === 'debug.blackbox' && item.action === 'addCommon')
            && actions.some((item) => item.tool === 'inspect.interceptor');
        },
      },
    ];

    for (const scenario of scenarios) {
      const launch = parseToolResponse(await executor.execute('browser.launch', { engine: 'playwright' }));
      const sessionId = launch.sessionId as string;
      const session = runtime.sessions.getSession(sessionId);

      session!.engine.getScripts = (async (options?: { includeSource?: boolean }) => {
        if (options?.includeSource === true) {
          return scenario.scripts;
        }
        return scenario.scripts.map(({ scriptId, url, sourceLength }) => ({
          scriptId,
          url,
          sourceLength,
        }));
      }) as never;

      const result = parseToolResponse(await executor.execute('flow.find-signature-path', {
        sessionId,
        requestPattern: scenario.requestPattern,
        targetField: scenario.targetField,
        fieldRole: scenario.fieldRole,
        preferredValidation: scenario.preferredValidation,
      }));

      const firstCandidate = ((result.data as Array<Record<string, unknown>>) || [])[0] || {};
      runs.push({
        scenario: scenario.name,
        surface: 'v2',
        success: result.ok === true && scenario.validate(firstCandidate),
        topScriptId: firstCandidate.scriptId,
      });

      await executor.execute('browser.close', { sessionId });
    }

    console.log(JSON.stringify({
      runs,
      summary: summarizeAcceptanceBenchmarkRuns(runs),
      fixtureOrigin: fixture.origin,
    }, null, 2));
  } finally {
    await runtime.close();
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
