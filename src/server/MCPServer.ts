// @ts-nocheck

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import { CacheManager } from '../utils/cache.js';
import { CodeCollector } from '../modules/collector/CodeCollector.js';
import { PageController } from '../modules/collector/PageController.js';
import { DOMInspector } from '../modules/collector/DOMInspector.js';
import { ScriptManager } from '../modules/debugger/ScriptManager.js';
import { DebuggerManager } from '../modules/debugger/DebuggerManager.js';
import { RuntimeInspector } from '../modules/debugger/RuntimeInspector.js';
import { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import { BrowserToolHandlers } from './BrowserToolHandlers.js';
import { DebuggerToolHandlers } from './DebuggerToolHandlers.js';
import { AdvancedToolHandlers } from './AdvancedToolHandlers.js';
import { AIHookToolHandlers } from './AIHookToolHandlers.js';
import { browserTools } from './BrowserToolDefinitions.js';
import { debuggerTools } from './DebuggerToolDefinitions.js';
import { advancedTools } from './AdvancedToolDefinitions.js';
import { aiHookTools } from './AIHookToolDefinitions.js';
import { tokenBudgetTools } from './TokenBudgetToolDefinitions.js';
import { Deobfuscator } from '../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../modules/detector/ObfuscationDetector.js';
import { LLMService } from '../services/LLMService.js';
import { StorageService } from '../services/StorageService.js';
import { CodeAnalyzer } from '../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../modules/crypto/CryptoDetector.js';
import { HookManager } from '../modules/hook/HookManager.js';
import { TokenBudgetManager } from '../utils/TokenBudgetManager.js';
import { UnifiedCacheManager } from '../utils/UnifiedCacheManager.js';
import { cacheTools } from './CacheToolDefinitions.js';
export class MCPServer {
    server;
    cache;
    collector;
    pageController;
    domInspector;
    scriptManager;
    debuggerManager;
    runtimeInspector;
    consoleMonitor;
    browserHandlers;
    debuggerHandlers;
    storage;
    tokenBudget;
    unifiedCache;
    advancedHandlers;
    aiHookHandlers;
    deobfuscator;
    advancedDeobfuscator;
    astOptimizer;
    obfuscationDetector;
    llm;
    analyzer;
    cryptoDetector;
    hookManager;
    constructor(config) {
        this.cache = new CacheManager(config.cache);
        this.collector = new CodeCollector(config.browser);
        this.pageController = new PageController(this.collector);
        this.domInspector = new DOMInspector(this.collector);
        this.scriptManager = new ScriptManager(this.collector);
        this.storage = new StorageService({
            databasePath: config.storage.path,
            cacheSize: config.storage.cacheSize,
        });
        this.debuggerManager = new DebuggerManager(this.collector, this.storage, 'legacy');
        this.consoleMonitor = new ConsoleMonitor(this.collector, this.storage, 'legacy');
        this.runtimeInspector = new RuntimeInspector(this.collector, this.debuggerManager);
        this.llm = new LLMService(config.llm, undefined, {
            storage: this.storage,
            llmCache: config.llmCache,
        });
        this.browserHandlers = new BrowserToolHandlers(this.collector, this.pageController, this.domInspector, this.scriptManager, this.consoleMonitor, this.llm);
        this.debuggerHandlers = new DebuggerToolHandlers(this.debuggerManager, this.runtimeInspector);
        this.advancedHandlers = new AdvancedToolHandlers(this.collector, this.consoleMonitor);
        this.aiHookHandlers = new AIHookToolHandlers(this.pageController);
        this.deobfuscator = new Deobfuscator(this.llm);
        this.advancedDeobfuscator = new AdvancedDeobfuscator(this.llm);
        this.astOptimizer = new ASTOptimizer();
        this.obfuscationDetector = new ObfuscationDetector();
        this.analyzer = new CodeAnalyzer(this.llm);
        this.cryptoDetector = new CryptoDetector(this.llm);
        this.hookManager = new HookManager(this.storage, 'legacy');
        this.tokenBudget = TokenBudgetManager.getInstance();
        logger.info('TokenBudgetManager initialized');
        this.unifiedCache = UnifiedCacheManager.getInstance();
        logger.info('UnifiedCacheManager initialized');
        this.server = new Server({
            name: config.mcp.name,
            version: config.mcp.version,
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
        logger.info('MCP Server initialized with tools');
    }
    async registerCaches() {
        try {
            logger.info('Starting cache registration...');
            const { DetailedDataManager } = await import('../utils/detailedDataManager.js');
            const { createCacheAdapters } = await import('../utils/CacheAdapters.js');
            const detailedDataManager = DetailedDataManager.getInstance();
            let codeCache, codeCompressor;
            try {
                codeCache = this.collector.getCache();
                codeCompressor = this.collector.getCompressor();
            }
            catch (error) {
                logger.warn('Collector cache methods not available, using fallback');
                codeCache = this.collector.cache;
                codeCompressor = this.collector.compressor;
            }
            const adapters = createCacheAdapters(detailedDataManager, codeCache, codeCompressor);
            for (const adapter of adapters) {
                this.unifiedCache.registerCache(adapter);
            }
            logger.info(`All caches registered to UnifiedCacheManager (${adapters.length} adapters)`);
        }
        catch (error) {
            logger.error('Failed to register caches:', error);
            logger.warn('Continuing without cache registration');
        }
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = this.getTools();
            logger.info(`Returning ${tools.length} tools`);
            return {
                tools,
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            logger.info(`Tool called: ${name}`);
            try {
                const toolArgs = args || {};
                const response = await this.executeToolWithTracking(name, toolArgs);
                return response;
            }
            catch (error) {
                logger.error(`Tool execution failed: ${name}`, error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async executeToolWithTracking(name, args) {
        try {
            const response = await this.executeToolInternal(name, args);
            this.tokenBudget.recordToolCall(name, args, response);
            return response;
        }
        catch (error) {
            const errorResponse = {
                content: [{ type: 'text', text: `Error: ${error.message}` }],
                isError: true,
            };
            this.tokenBudget.recordToolCall(name, args, errorResponse);
            throw error;
        }
    }
    async executeToolInternal(name, toolArgs) {
        switch (name) {
            case 'get_token_budget_stats':
                return await this.handleGetTokenBudgetStats(toolArgs);
            case 'manual_token_cleanup':
                return await this.handleManualTokenCleanup(toolArgs);
            case 'reset_token_budget':
                return await this.handleResetTokenBudget(toolArgs);
            case 'get_cache_stats':
                return await this.handleGetCacheStats(toolArgs);
            case 'smart_cache_cleanup':
                return await this.handleSmartCacheCleanup(toolArgs);
            case 'clear_all_caches':
                return await this.handleClearAllCaches(toolArgs);
            case 'collect_code':
                return await this.handleCollectCode(toolArgs);
            case 'search_in_scripts':
                return await this.handleSearchInScripts(toolArgs);
            case 'extract_function_tree':
                return await this.handleExtractFunctionTree(toolArgs);
            case 'deobfuscate':
                return await this.handleDeobfuscate(toolArgs);
            case 'understand_code':
                return await this.handleUnderstandCode(toolArgs);
            case 'detect_crypto':
                return await this.handleDetectCrypto(toolArgs);
            case 'manage_hooks':
                return await this.handleManageHooks(toolArgs);
            case 'detect_obfuscation':
                return await this.handleDetectObfuscation(toolArgs);
            case 'advanced_deobfuscate':
                return await this.handleAdvancedDeobfuscate(toolArgs);
            case 'clear_collected_data':
                return await this.handleClearCollectedData(toolArgs);
            case 'get_collection_stats':
                return await this.handleGetCollectionStats(toolArgs);
            case 'get_detailed_data':
                return await this.browserHandlers.handleGetDetailedData(toolArgs);
            case 'browser_launch':
                return await this.browserHandlers.handleBrowserLaunch(toolArgs);
            case 'browser_close':
                return await this.browserHandlers.handleBrowserClose(toolArgs);
            case 'browser_status':
                return await this.browserHandlers.handleBrowserStatus(toolArgs);
            case 'page_navigate':
                return await this.browserHandlers.handlePageNavigate(toolArgs);
            case 'page_reload':
                return await this.browserHandlers.handlePageReload(toolArgs);
            case 'page_back':
                return await this.browserHandlers.handlePageBack(toolArgs);
            case 'page_forward':
                return await this.browserHandlers.handlePageForward(toolArgs);
            case 'dom_query_selector':
                return await this.browserHandlers.handleDOMQuerySelector(toolArgs);
            case 'dom_query_all':
                return await this.browserHandlers.handleDOMQueryAll(toolArgs);
            case 'dom_get_structure':
                return await this.browserHandlers.handleDOMGetStructure(toolArgs);
            case 'dom_find_clickable':
                return await this.browserHandlers.handleDOMFindClickable(toolArgs);
            case 'page_click':
                return await this.browserHandlers.handlePageClick(toolArgs);
            case 'page_type':
                return await this.browserHandlers.handlePageType(toolArgs);
            case 'page_select':
                return await this.browserHandlers.handlePageSelect(toolArgs);
            case 'page_hover':
                return await this.browserHandlers.handlePageHover(toolArgs);
            case 'page_scroll':
                return await this.browserHandlers.handlePageScroll(toolArgs);
            case 'page_wait_for_selector':
                return await this.browserHandlers.handlePageWaitForSelector(toolArgs);
            case 'page_evaluate':
                return await this.browserHandlers.handlePageEvaluate(toolArgs);
            case 'page_screenshot':
                return await this.browserHandlers.handlePageScreenshot(toolArgs);
            case 'get_all_scripts':
                return await this.browserHandlers.handleGetAllScripts(toolArgs);
            case 'get_script_source':
                return await this.browserHandlers.handleGetScriptSource(toolArgs);
            case 'console_enable':
                return await this.browserHandlers.handleConsoleEnable(toolArgs);
            case 'console_get_logs':
                return await this.browserHandlers.handleConsoleGetLogs(toolArgs);
            case 'console_execute':
                return await this.browserHandlers.handleConsoleExecute(toolArgs);
            case 'dom_get_computed_style':
                return await this.browserHandlers.handleDOMGetComputedStyle(toolArgs);
            case 'dom_find_by_text':
                return await this.browserHandlers.handleDOMFindByText(toolArgs);
            case 'dom_get_xpath':
                return await this.browserHandlers.handleDOMGetXPath(toolArgs);
            case 'dom_is_in_viewport':
                return await this.browserHandlers.handleDOMIsInViewport(toolArgs);
            case 'page_get_performance':
                return await this.browserHandlers.handlePageGetPerformance(toolArgs);
            case 'page_inject_script':
                return await this.browserHandlers.handlePageInjectScript(toolArgs);
            case 'page_set_cookies':
                return await this.browserHandlers.handlePageSetCookies(toolArgs);
            case 'page_get_cookies':
                return await this.browserHandlers.handlePageGetCookies(toolArgs);
            case 'page_clear_cookies':
                return await this.browserHandlers.handlePageClearCookies(toolArgs);
            case 'page_set_viewport':
                return await this.browserHandlers.handlePageSetViewport(toolArgs);
            case 'page_emulate_device':
                return await this.browserHandlers.handlePageEmulateDevice(toolArgs);
            case 'page_get_local_storage':
                return await this.browserHandlers.handlePageGetLocalStorage(toolArgs);
            case 'page_set_local_storage':
                return await this.browserHandlers.handlePageSetLocalStorage(toolArgs);
            case 'page_press_key':
                return await this.browserHandlers.handlePagePressKey(toolArgs);
            case 'page_get_all_links':
                return await this.browserHandlers.handlePageGetAllLinks(toolArgs);
            case 'captcha_detect':
                return await this.browserHandlers.handleCaptchaDetect(toolArgs);
            case 'captcha_wait':
                return await this.browserHandlers.handleCaptchaWait(toolArgs);
            case 'captcha_config':
                return await this.browserHandlers.handleCaptchaConfig(toolArgs);
            case 'stealth_inject':
                return await this.browserHandlers.handleStealthInject(toolArgs);
            case 'stealth_set_user_agent':
                return await this.browserHandlers.handleStealthSetUserAgent(toolArgs);
            case 'ai_hook_generate':
                return await this.aiHookHandlers.handleAIHookGenerate(toolArgs);
            case 'ai_hook_inject':
                return await this.aiHookHandlers.handleAIHookInject(toolArgs);
            case 'ai_hook_get_data':
                return await this.aiHookHandlers.handleAIHookGetData(toolArgs);
            case 'ai_hook_list':
                return await this.aiHookHandlers.handleAIHookList(toolArgs);
            case 'ai_hook_clear':
                return await this.aiHookHandlers.handleAIHookClear(toolArgs);
            case 'ai_hook_toggle':
                return await this.aiHookHandlers.handleAIHookToggle(toolArgs);
            case 'ai_hook_export':
                return await this.aiHookHandlers.handleAIHookExport(toolArgs);
            case 'debugger_enable':
                return await this.debuggerHandlers.handleDebuggerEnable(toolArgs);
            case 'debugger_disable':
                return await this.debuggerHandlers.handleDebuggerDisable(toolArgs);
            case 'debugger_pause':
                return await this.debuggerHandlers.handleDebuggerPause(toolArgs);
            case 'debugger_resume':
                return await this.debuggerHandlers.handleDebuggerResume(toolArgs);
            case 'debugger_step_into':
                return await this.debuggerHandlers.handleDebuggerStepInto(toolArgs);
            case 'debugger_step_over':
                return await this.debuggerHandlers.handleDebuggerStepOver(toolArgs);
            case 'debugger_step_out':
                return await this.debuggerHandlers.handleDebuggerStepOut(toolArgs);
            case 'breakpoint_set':
                return await this.debuggerHandlers.handleBreakpointSet(toolArgs);
            case 'breakpoint_remove':
                return await this.debuggerHandlers.handleBreakpointRemove(toolArgs);
            case 'breakpoint_list':
                return await this.debuggerHandlers.handleBreakpointList(toolArgs);
            case 'get_call_stack':
                return await this.debuggerHandlers.handleGetCallStack(toolArgs);
            case 'debugger_evaluate':
                return await this.debuggerHandlers.handleDebuggerEvaluate(toolArgs);
            case 'debugger_evaluate_global':
                return await this.debuggerHandlers.handleDebuggerEvaluateGlobal(toolArgs);
            case 'debugger_wait_for_paused':
                return await this.debuggerHandlers.handleDebuggerWaitForPaused(toolArgs);
            case 'debugger_get_paused_state':
                return await this.debuggerHandlers.handleDebuggerGetPausedState(toolArgs);
            case 'breakpoint_set_on_exception':
                return await this.debuggerHandlers.handleBreakpointSetOnException(toolArgs);
            case 'get_object_properties':
                return await this.debuggerHandlers.handleGetObjectProperties(toolArgs);
            case 'get_scope_variables_enhanced':
                return await this.debuggerHandlers.handleGetScopeVariablesEnhanced(toolArgs);
            case 'debugger_save_session':
                return await this.debuggerHandlers.handleSaveSession(toolArgs);
            case 'debugger_load_session':
                return await this.debuggerHandlers.handleLoadSession(toolArgs);
            case 'debugger_export_session':
                return await this.debuggerHandlers.handleExportSession(toolArgs);
            case 'debugger_list_sessions':
                return await this.debuggerHandlers.handleListSessions(toolArgs);
            case 'watch_add':
                return await this.debuggerHandlers.handleWatchAdd(toolArgs);
            case 'watch_remove':
                return await this.debuggerHandlers.handleWatchRemove(toolArgs);
            case 'watch_list':
                return await this.debuggerHandlers.handleWatchList(toolArgs);
            case 'watch_evaluate_all':
                return await this.debuggerHandlers.handleWatchEvaluateAll(toolArgs);
            case 'watch_clear_all':
                return await this.debuggerHandlers.handleWatchClearAll(toolArgs);
            case 'xhr_breakpoint_set':
                return await this.debuggerHandlers.handleXHRBreakpointSet(toolArgs);
            case 'xhr_breakpoint_remove':
                return await this.debuggerHandlers.handleXHRBreakpointRemove(toolArgs);
            case 'xhr_breakpoint_list':
                return await this.debuggerHandlers.handleXHRBreakpointList(toolArgs);
            case 'event_breakpoint_set':
                return await this.debuggerHandlers.handleEventBreakpointSet(toolArgs);
            case 'event_breakpoint_set_category':
                return await this.debuggerHandlers.handleEventBreakpointSetCategory(toolArgs);
            case 'event_breakpoint_remove':
                return await this.debuggerHandlers.handleEventBreakpointRemove(toolArgs);
            case 'event_breakpoint_list':
                return await this.debuggerHandlers.handleEventBreakpointList(toolArgs);
            case 'blackbox_add':
                return await this.debuggerHandlers.handleBlackboxAdd(toolArgs);
            case 'blackbox_add_common':
                return await this.debuggerHandlers.handleBlackboxAddCommon(toolArgs);
            case 'blackbox_list':
                return await this.debuggerHandlers.handleBlackboxList(toolArgs);
            case 'network_enable':
                return await this.advancedHandlers.handleNetworkEnable(toolArgs);
            case 'network_disable':
                return await this.advancedHandlers.handleNetworkDisable(toolArgs);
            case 'network_get_status':
                return await this.advancedHandlers.handleNetworkGetStatus(toolArgs);
            case 'network_get_requests':
                return await this.advancedHandlers.handleNetworkGetRequests(toolArgs);
            case 'network_get_response_body':
                return await this.advancedHandlers.handleNetworkGetResponseBody(toolArgs);
            case 'network_get_stats':
                return await this.advancedHandlers.handleNetworkGetStats(toolArgs);
            case 'performance_get_metrics':
                return await this.advancedHandlers.handlePerformanceGetMetrics(toolArgs);
            case 'performance_start_coverage':
                return await this.advancedHandlers.handlePerformanceStartCoverage(toolArgs);
            case 'performance_stop_coverage':
                return await this.advancedHandlers.handlePerformanceStopCoverage(toolArgs);
            case 'performance_take_heap_snapshot':
                return await this.advancedHandlers.handlePerformanceTakeHeapSnapshot(toolArgs);
            case 'console_get_exceptions':
                return await this.advancedHandlers.handleConsoleGetExceptions(toolArgs);
            case 'console_inject_script_monitor':
                return await this.advancedHandlers.handleConsoleInjectScriptMonitor(toolArgs);
            case 'console_inject_xhr_interceptor':
                return await this.advancedHandlers.handleConsoleInjectXhrInterceptor(toolArgs);
            case 'console_inject_fetch_interceptor':
                return await this.advancedHandlers.handleConsoleInjectFetchInterceptor(toolArgs);
            case 'console_inject_function_tracer':
                return await this.advancedHandlers.handleConsoleInjectFunctionTracer(toolArgs);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    getTools() {
        return [
            {
                name: 'collect_code',
                description: 'Collect JavaScript code from a target website. 🆕 Supports smart collection modes: summary (fast analysis), priority (key code first), full (complete). Use summary mode for large websites to avoid token overflow.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'Target website URL',
                        },
                        includeInline: {
                            type: 'boolean',
                            description: 'Include inline scripts',
                            default: true,
                        },
                        includeExternal: {
                            type: 'boolean',
                            description: 'Include external scripts',
                            default: true,
                        },
                        includeDynamic: {
                            type: 'boolean',
                            description: 'Include dynamically loaded scripts',
                            default: false,
                        },
                        smartMode: {
                            type: 'string',
                            description: '🆕 Smart collection mode: "summary" (only metadata, fastest), "priority" (key code first), "incremental" (on-demand), "full" (all code, default)',
                            enum: ['summary', 'priority', 'incremental', 'full'],
                            default: 'full',
                        },
                        compress: {
                            type: 'boolean',
                            description: '🆕 Enable gzip compression (70-90% size reduction). Compression info saved in metadata.',
                            default: false,
                        },
                        maxTotalSize: {
                            type: 'number',
                            description: '🆕 Maximum total size in bytes (default: 2MB). Used with priority/incremental modes.',
                            default: 2097152,
                        },
                        maxFileSize: {
                            type: 'number',
                            description: 'Maximum single file size in KB (default: 500KB). Files larger than this will be truncated.',
                            default: 500,
                        },
                        priorities: {
                            type: 'array',
                            description: '🆕 Priority URL patterns for priority mode (e.g., ["encrypt", "crypto", "sign"]). Files matching these patterns are collected first.',
                            items: { type: 'string' },
                        },
                        returnSummaryOnly: {
                            type: 'boolean',
                            description: '⚠️ DEPRECATED: Use smartMode="summary" instead.',
                            default: false,
                        },
                    },
                    required: ['url'],
                },
            },
            {
                name: 'search_in_scripts',
                description: `🆕 Search for keywords in collected scripts. Auto-truncates large results to avoid context overflow.

Use this tool when:
- You need to find where a specific function/variable is defined
- Looking for API endpoints or encryption algorithms
- Searching for specific patterns in large codebases

⚠️ IMPORTANT: Large results (>50KB) automatically return summary only. Use specific keywords to reduce matches.

Example:
search_in_scripts(keyword="a_bogus", contextLines=5, maxMatches=50)
→ Returns all occurrences with surrounding code`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: {
                            type: 'string',
                            description: 'Keyword to search for (supports regex if isRegex=true)',
                        },
                        isRegex: {
                            type: 'boolean',
                            description: 'Whether the keyword is a regular expression',
                            default: false,
                        },
                        caseSensitive: {
                            type: 'boolean',
                            description: 'Whether the search is case-sensitive',
                            default: false,
                        },
                        contextLines: {
                            type: 'number',
                            description: 'Number of context lines to include before and after matches',
                            default: 3,
                        },
                        maxMatches: {
                            type: 'number',
                            description: 'Maximum number of matches to return (default: 100). Reduce this if getting summary-only results.',
                            default: 100,
                        },
                        returnSummary: {
                            type: 'boolean',
                            description: '🆕 Return summary only (match count, preview) instead of full results. Useful for large result sets.',
                            default: false,
                        },
                        maxContextSize: {
                            type: 'number',
                            description: '🆕 Maximum result size in bytes (default: 50KB). Results larger than this return summary only.',
                            default: 50000,
                        },
                    },
                    required: ['keyword'],
                },
            },
            {
                name: 'extract_function_tree',
                description: `Extract a function and all its dependencies from collected scripts.

This tool solves the context overflow problem by extracting only relevant code instead of analyzing entire files.

Use this tool when:
- You want to analyze a specific function (e.g., "sign", "encrypt")
- Need to understand function dependencies
- Want to avoid context overflow with large files

Example workflow:
1. search_in_scripts(keyword="a_bogus") → Find which file contains it
2. extract_function_tree(functionName="sign", maxDepth=3) → Extract sign() and its dependencies
3. analyze_code_chunk(code=extractedCode) → Analyze the small extracted code

Returns:
- Complete code of the function and its dependencies
- Call graph showing relationships
- Total size (much smaller than original file)`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        scriptId: {
                            type: 'string',
                            description: 'Script ID from collect_code or search_in_scripts',
                        },
                        functionName: {
                            type: 'string',
                            description: 'Name of the function to extract',
                        },
                        maxDepth: {
                            type: 'number',
                            description: 'Maximum dependency depth to extract',
                            default: 3,
                        },
                        maxSize: {
                            type: 'number',
                            description: 'Maximum total size in KB',
                            default: 500,
                        },
                        includeComments: {
                            type: 'boolean',
                            description: 'Whether to include comments in extracted code',
                            default: true,
                        },
                    },
                    required: ['scriptId', 'functionName'],
                },
            },
            {
                name: 'deobfuscate',
                description: 'AI-driven code deobfuscation',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Obfuscated code to deobfuscate',
                        },
                        llm: {
                            type: 'string',
                            enum: ['gpt-4', 'claude'],
                            description: 'LLM to use for deobfuscation',
                            default: 'gpt-4',
                        },
                        aggressive: {
                            type: 'boolean',
                            description: 'Use aggressive deobfuscation',
                            default: false,
                        },
                    },
                    required: ['code'],
                },
            },
            {
                name: 'understand_code',
                description: 'AI-assisted code semantic understanding',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Code to analyze',
                        },
                        context: {
                            type: 'object',
                            description: 'Additional context for analysis',
                        },
                        focus: {
                            type: 'string',
                            enum: ['structure', 'business', 'security', 'all'],
                            description: 'Analysis focus',
                            default: 'all',
                        },
                    },
                    required: ['code'],
                },
            },
            {
                name: 'detect_crypto',
                description: 'Detect and analyze encryption algorithms',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Code to analyze for crypto algorithms',
                        },
                    },
                    required: ['code'],
                },
            },
            {
                name: 'manage_hooks',
                description: 'Manage JavaScript hooks for runtime interception',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['create', 'list', 'records', 'clear'],
                            description: 'Hook management action',
                        },
                        target: {
                            type: 'string',
                            description: 'Hook target (function name, API, etc.)',
                        },
                        type: {
                            type: 'string',
                            enum: ['function', 'xhr', 'fetch', 'websocket', 'localstorage', 'cookie'],
                            description: 'Type of hook to create',
                        },
                        hookAction: {
                            type: 'string',
                            enum: ['log', 'block', 'modify'],
                            description: 'What to do when hook is triggered',
                            default: 'log',
                        },
                        customCode: {
                            type: 'string',
                            description: 'Custom JavaScript code to execute in hook',
                        },
                        hookId: {
                            type: 'string',
                            description: 'Hook ID for records/clear actions',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'detect_obfuscation',
                description: 'Detect obfuscation types in JavaScript code (supports 2024-2025 latest techniques)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Code to analyze for obfuscation',
                        },
                        generateReport: {
                            type: 'boolean',
                            description: 'Generate detailed report',
                            default: true,
                        },
                    },
                    required: ['code'],
                },
            },
            {
                name: 'advanced_deobfuscate',
                description: 'Advanced deobfuscation supporting VM protection, invisible unicode, control flow flattening, etc.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'string',
                            description: 'Obfuscated code to deobfuscate',
                        },
                        detectOnly: {
                            type: 'boolean',
                            description: 'Only detect obfuscation types without deobfuscating',
                            default: false,
                        },
                        aggressiveVM: {
                            type: 'boolean',
                            description: 'Use aggressive VM deobfuscation (experimental)',
                            default: false,
                        },
                        useASTOptimization: {
                            type: 'boolean',
                            description: 'Apply AST-based optimizations',
                            default: true,
                        },
                        timeout: {
                            type: 'number',
                            description: 'Timeout in milliseconds',
                            default: 60000,
                        },
                    },
                    required: ['code'],
                },
            },
            {
                name: 'clear_collected_data',
                description: '🧹 Clear all collected data (file cache, compression cache, collected URLs). Use this when switching to a new website to avoid data interference.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'get_collection_stats',
                description: '📊 Get statistics about collected data (cache stats, compression stats, collected URLs count).',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            ...browserTools,
            ...debuggerTools,
            ...advancedTools,
            ...aiHookTools,
            ...tokenBudgetTools,
            ...cacheTools,
        ];
    }
    async handleCollectCode(args) {
        const returnSummaryOnly = args.returnSummaryOnly ?? false;
        let smartMode = args.smartMode;
        if (returnSummaryOnly && !smartMode) {
            smartMode = 'summary';
        }
        const result = await this.collector.collect({
            url: args.url,
            includeInline: args.includeInline,
            includeExternal: args.includeExternal,
            includeDynamic: args.includeDynamic,
            smartMode: smartMode,
            compress: args.compress,
            maxTotalSize: args.maxTotalSize,
            maxFileSize: args.maxFileSize ? args.maxFileSize * 1024 : undefined,
            priorities: args.priorities,
        });
        if (returnSummaryOnly) {
            logger.info('📋 Returning summary only (user requested)');
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            mode: 'summary',
                            totalSize: result.totalSize,
                            totalSizeKB: (result.totalSize / 1024).toFixed(2),
                            filesCount: result.files.length,
                            collectTime: result.collectTime,
                            summary: result.files.map(f => ({
                                url: f.url,
                                type: f.type,
                                size: f.size,
                                sizeKB: (f.size / 1024).toFixed(2),
                                truncated: f.metadata?.truncated || false,
                                preview: f.content.substring(0, 200) + '...',
                            })),
                            hint: 'Use get_script_source tool to fetch specific files',
                        }, null, 2),
                    },
                ],
            };
        }
        const totalSize = result.totalSize;
        const MAX_SAFE_SIZE = 1 * 1024 * 1024;
        if (totalSize > MAX_SAFE_SIZE) {
            logger.warn(`⚠️  Total code size (${(totalSize / 1024).toFixed(2)} KB) exceeds safe limit (${MAX_SAFE_SIZE / 1024} KB), auto-switching to summary mode`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            warning: '⚠️ Code size too large for full response - auto-switched to summary mode',
                            totalSize,
                            totalSizeKB: (totalSize / 1024).toFixed(2),
                            filesCount: result.files.length,
                            collectTime: result.collectTime,
                            summary: result.files.map(f => ({
                                url: f.url,
                                type: f.type,
                                size: f.size,
                                sizeKB: (f.size / 1024).toFixed(2),
                                truncated: f.metadata?.truncated || false,
                                preview: f.content.substring(0, 200) + '...',
                            })),
                            recommendations: [
                                '1. Use get_script_source to fetch specific files',
                                '2. Filter files by URL pattern (e.g., files containing "encrypt" or "api")',
                                '3. Use returnSummaryOnly=true parameter to explicitly request summary mode',
                                '4. Enable caching to speed up repeated requests',
                            ],
                        }, null, 2),
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleSearchInScripts(args) {
        const { ScriptManager } = await import('../modules/debugger/ScriptManager.js');
        const scriptManager = new ScriptManager(this.collector);
        await scriptManager.init();
        const maxMatches = args.maxMatches ?? 100;
        const returnSummary = args.returnSummary ?? false;
        const maxContextSize = args.maxContextSize ?? 50000;
        const result = await scriptManager.searchInScripts(args.keyword, {
            isRegex: args.isRegex,
            caseSensitive: args.caseSensitive,
            contextLines: args.contextLines,
            maxMatches: maxMatches,
        });
        const resultStr = JSON.stringify(result);
        const resultSize = resultStr.length;
        const isTooLarge = resultSize > maxContextSize;
        if (returnSummary || isTooLarge) {
            const summary = {
                success: true,
                keyword: args.keyword,
                totalMatches: result.matches?.length || 0,
                resultSize: resultSize,
                resultSizeKB: (resultSize / 1024).toFixed(2),
                truncated: isTooLarge,
                reason: isTooLarge
                    ? `Result too large (${(resultSize / 1024).toFixed(2)} KB > ${(maxContextSize / 1024).toFixed(2)} KB)`
                    : 'Summary mode enabled',
                matchesSummary: (result.matches || []).slice(0, 10).map((m) => ({
                    scriptId: m.scriptId,
                    url: m.url,
                    line: m.line,
                    preview: m.context?.substring(0, 100) + '...',
                })),
                tip: isTooLarge
                    ? 'Reduce maxMatches parameter or use more specific keyword to get full results'
                    : 'Set returnSummary=false to get full results',
                recommendations: [
                    '1. Use more specific keywords to reduce matches',
                    '2. Reduce maxMatches parameter (current: ' + maxMatches + ')',
                    '3. Use get_script_source to fetch specific files',
                    '4. Filter by scriptId or URL pattern',
                ],
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(summary, null, 2),
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleExtractFunctionTree(args) {
        const { ScriptManager } = await import('../modules/debugger/ScriptManager.js');
        const scriptManager = new ScriptManager(this.collector);
        await scriptManager.init();
        const result = await scriptManager.extractFunctionTree(args.scriptId, args.functionName, {
            maxDepth: args.maxDepth,
            maxSize: args.maxSize,
            includeComments: args.includeComments,
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleDeobfuscate(args) {
        const result = await this.deobfuscator.deobfuscate({
            code: args.code,
            llm: args.llm,
            aggressive: args.aggressive,
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleUnderstandCode(args) {
        const result = await this.analyzer.understand({
            code: args.code,
            context: args.context,
            focus: args.focus || 'all',
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleDetectCrypto(args) {
        const result = await this.cryptoDetector.detect({
            code: args.code,
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleManageHooks(args) {
        const action = args.action;
        switch (action) {
            case 'create': {
                const result = await this.hookManager.createHook({
                    target: args.target,
                    type: args.type,
                    action: args.hookAction || 'log',
                    customCode: args.customCode,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'list': {
                const hooks = this.hookManager.getAllHooks();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ hooks }, null, 2),
                        },
                    ],
                };
            }
            case 'records': {
                const hookId = args.hookId;
                const records = this.hookManager.getHookRecords(hookId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ records }, null, 2),
                        },
                    ],
                };
            }
            case 'clear': {
                this.hookManager.clearHookRecords(args.hookId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Hook records cleared',
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown hook action: ${action}`);
        }
    }
    async handleDetectObfuscation(args) {
        const code = args.code;
        const generateReport = args.generateReport ?? true;
        const result = this.obfuscationDetector.detect(code);
        let text = JSON.stringify(result, null, 2);
        if (generateReport) {
            text += '\n\n' + this.obfuscationDetector.generateReport(result);
        }
        return {
            content: [
                {
                    type: 'text',
                    text,
                },
            ],
        };
    }
    async handleAdvancedDeobfuscate(args) {
        const code = args.code;
        const detectOnly = args.detectOnly ?? false;
        const aggressiveVM = args.aggressiveVM ?? false;
        const useASTOptimization = args.useASTOptimization ?? true;
        const timeout = args.timeout ?? 60000;
        const result = await this.advancedDeobfuscator.deobfuscate({
            code,
            detectOnly,
            aggressiveVM,
            timeout,
        });
        let finalCode = result.code;
        if (useASTOptimization && !detectOnly) {
            logger.info('Applying AST optimizations...');
            finalCode = this.astOptimizer.optimize(finalCode);
        }
        const response = {
            ...result,
            code: finalCode,
            astOptimized: useASTOptimization && !detectOnly,
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                },
            ],
        };
    }
    async handleClearCollectedData(_args) {
        try {
            await this.collector.clearAllData();
            this.scriptManager.clear();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: '✅ All collected data cleared successfully',
                            cleared: {
                                fileCache: true,
                                compressionCache: true,
                                collectedUrls: true,
                                scriptManager: true,
                            },
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to clear collected data:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleGetCollectionStats(_args) {
        try {
            const stats = await this.collector.getAllStats();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            stats,
                            summary: {
                                totalCachedFiles: stats.cache.memoryEntries + stats.cache.diskEntries,
                                totalCacheSize: `${(stats.cache.totalSize / 1024).toFixed(2)} KB`,
                                compressionRatio: `${stats.compression.averageRatio.toFixed(1)}%`,
                                cacheHitRate: stats.compression.cacheHits > 0
                                    ? `${((stats.compression.cacheHits / (stats.compression.cacheHits + stats.compression.cacheMisses)) * 100).toFixed(1)}%`
                                    : '0%',
                                collectedUrls: stats.collector.collectedUrls,
                            },
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to get collection stats:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleGetTokenBudgetStats(_args) {
        try {
            const stats = this.tokenBudget.getStats();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            ...stats,
                            sessionDuration: `${Math.round((Date.now() - stats.sessionStartTime) / 1000)}s`,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to get token budget stats:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleManualTokenCleanup(_args) {
        try {
            const beforeStats = this.tokenBudget.getStats();
            this.tokenBudget.manualCleanup();
            const afterStats = this.tokenBudget.getStats();
            const freed = beforeStats.currentUsage - afterStats.currentUsage;
            const freedPercentage = Math.round((freed / beforeStats.maxTokens) * 100);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'Manual cleanup completed',
                            before: {
                                usage: beforeStats.currentUsage,
                                percentage: beforeStats.usagePercentage,
                            },
                            after: {
                                usage: afterStats.currentUsage,
                                percentage: afterStats.usagePercentage,
                            },
                            freed: {
                                tokens: freed,
                                percentage: freedPercentage,
                            },
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to perform manual cleanup:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleResetTokenBudget(_args) {
        try {
            this.tokenBudget.reset();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'Token budget reset successfully',
                            currentUsage: 0,
                            maxTokens: 200000,
                            usagePercentage: 0,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to reset token budget:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleGetCacheStats(_args) {
        try {
            const stats = await this.unifiedCache.getGlobalStats();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            ...stats,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to get cache stats:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleSmartCacheCleanup(args) {
        try {
            const targetSize = args.targetSize;
            const result = await this.unifiedCache.smartCleanup(targetSize);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            ...result,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to cleanup cache:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async handleClearAllCaches(_args) {
        try {
            await this.unifiedCache.clearAll();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'All caches cleared',
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            logger.error('Failed to clear all caches:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    },
                ],
            };
        }
    }
    async start() {
        logger.info('Starting MCP server...');
        try {
            await this.registerCaches();
            await this.storage.init();
            await this.cache.init();
            logger.info('Cache initialized');
            const transport = new StdioServerTransport();
            logger.info('Transport created');
            await this.server.connect(transport);
            logger.success('MCP server connected to transport');
            logger.success('MCP server started successfully');
        }
        catch (error) {
            logger.error('Failed to start MCP server:', error);
            throw error;
        }
    }
    async close() {
        logger.info('Closing MCP server...');
        await this.collector.close();
        await this.storage.close();
        await this.server.close();
        logger.success('MCP server closed');
    }
}
//# sourceMappingURL=MCPServer.js.map
