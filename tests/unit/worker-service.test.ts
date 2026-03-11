import { WorkerService } from '../../src/services/WorkerService.js';

describe('WorkerService', () => {
  test('runs search tasks in a worker and returns matches', async () => {
    const service = new WorkerService({
      maxWorkers: 1,
      taskTimeoutMs: 5000,
    });

    const result = await service.runSearchTask({
      keyword: 'fixture-token',
      searchMode: 'substring',
      maxResults: 10,
      maxBytes: 4096,
      scripts: [
        {
          scriptId: 'script-1',
          url: 'https://example.test/app.js',
          source: 'function sign(){ return "fixture-token"; }',
        },
      ],
    });

    expect(result.executionMode).toBe('worker');
    expect(result.totalMatches).toBe(1);
    await service.close();
  });

  test('enforces task timeout', async () => {
    const service = new WorkerService({
      maxWorkers: 1,
      taskTimeoutMs: 50,
    });

    await expect(
      service.runAnalysisTask({
        kind: 'sleep',
        durationMs: 250,
      }),
    ).rejects.toThrow('Worker task timed out');

    await service.close();
  });
});
