import { formatLegacyToolDescription } from '../../src/server/v2/legacy/LegacyToolBridge.js';
import { LEGACY_FIRST_BATCH_REMOVED_TOOLS, shouldExposeLegacyTool } from '../../src/server/v2/legacy/legacyToolFilter.js';

describe('legacy tool bridge contraction filter', () => {
  test('hides first-batch legacy families that have stable V2 replacements', () => {
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('collect_code')).toBe(true);
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('watch_add')).toBe(true);
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('page_click')).toBe(true);
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('page_screenshot')).toBe(true);
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('page_get_cookies')).toBe(true);
    expect(LEGACY_FIRST_BATCH_REMOVED_TOOLS.has('page_get_local_storage')).toBe(true);
  });

  test('keeps compatibility-only legacy paths that are not yet in the first removal batch', () => {
    expect(shouldExposeLegacyTool('xhr_breakpoint_set')).toBe(true);
    expect(shouldExposeLegacyTool('event_breakpoint_set')).toBe(true);
    expect(shouldExposeLegacyTool('blackbox_add')).toBe(true);
    expect(shouldExposeLegacyTool('console_inject_function_tracer')).toBe(true);
    expect(shouldExposeLegacyTool('stealth_inject')).toBe(true);
    expect(shouldExposeLegacyTool('captcha_detect')).toBe(true);
  });

  test('filters removed first-batch legacy tools from the bridge surface', () => {
    expect(shouldExposeLegacyTool('collect_code')).toBe(false);
    expect(shouldExposeLegacyTool('watch_add')).toBe(false);
    expect(shouldExposeLegacyTool('page_click')).toBe(false);
    expect(shouldExposeLegacyTool('page_screenshot')).toBe(false);
    expect(shouldExposeLegacyTool('page_get_cookies')).toBe(false);
    expect(shouldExposeLegacyTool('page_get_local_storage')).toBe(false);
  });

  test('marks exposed legacy tools as compatibility-only in their user-facing description', () => {
    expect(formatLegacyToolDescription('Legacy XHR breakpoint helper')).toContain('[legacy]');
    expect(formatLegacyToolDescription('Legacy XHR breakpoint helper')).toContain('compatibility-only');
  });
});
