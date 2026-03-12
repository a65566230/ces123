import { classifyToolSurface, renderMarkdownSummary } from '../../scripts/live-site-matrix.js';

describe('live site matrix helpers', () => {
  test('classifies v2 and legacy tool names deterministically', () => {
    expect(classifyToolSurface('browser.launch')).toBe('v2');
    expect(classifyToolSurface('flow.reverse-report')).toBe('v2');
    expect(classifyToolSurface('browser_launch')).toBe('legacy');
    expect(classifyToolSurface('network_get_requests')).toBe('legacy');
  });

  test('renders a markdown summary with pass and fail counts', () => {
    const markdown = renderMarkdownSummary({
      targetUrl: 'https://www.douyin.com/jingxuan',
      surface: 'all',
      runtimeMode: 'dist',
      startedAt: '2026-03-11T00:00:00.000Z',
      finishedAt: '2026-03-11T00:01:00.000Z',
      totals: {
        total: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
      },
      entries: [
        { tool: 'browser.launch', ok: true, durationMs: 100 },
        { tool: 'browser.status', ok: true, durationMs: 150 },
        { tool: 'flow.reverse-report', ok: false, durationMs: 250, error: 'boom' },
      ],
    });

    expect(markdown).toContain('https://www.douyin.com/jingxuan');
    expect(markdown).toContain('Passed: 2');
    expect(markdown).toContain('Failed: 1');
    expect(markdown).toContain('flow.reverse-report');
  });
});
