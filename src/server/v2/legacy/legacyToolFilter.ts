// @ts-nocheck

export const LEGACY_FIRST_BATCH_REMOVED_TOOLS = new Set([
    'collect_code',
    'search_in_scripts',
    'get_all_scripts',
    'get_script_source',
    'extract_function_tree',
    'understand_code',
    'detect_crypto',
    'detect_obfuscation',
    'deobfuscate',
    'advanced_deobfuscate',
    'watch_add',
    'watch_list',
    'watch_evaluate_all',
    'watch_remove',
    'watch_clear_all',
    'page_click',
    'page_type',
    'page_select',
    'page_hover',
    'page_scroll',
    'page_press_key',
    'page_screenshot',
    'page_set_cookies',
    'page_get_cookies',
    'page_clear_cookies',
    'page_get_local_storage',
    'page_set_local_storage',
]);

export function shouldExposeLegacyTool(toolName) {
    return !LEGACY_FIRST_BATCH_REMOVED_TOOLS.has(String(toolName || ''));
}
