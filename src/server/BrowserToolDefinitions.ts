// @ts-nocheck

export const browserTools = [
    {
        name: 'get_detailed_data',
        description: `🔑 Retrieve detailed data using detailId token.

When tools return large data, they provide a detailId instead of full data to prevent context overflow.
Use this tool to retrieve the full data or specific parts.

Examples:
- get_detailed_data("detail_abc123") → Get full data
- get_detailed_data("detail_abc123", path="frontierSign") → Get specific property
- get_detailed_data("detail_abc123", path="methods.0") → Get first method`,
        inputSchema: {
            type: 'object',
            properties: {
                detailId: {
                    type: 'string',
                    description: 'Detail ID token from previous tool response',
                },
                path: {
                    type: 'string',
                    description: 'Optional: Path to specific data (e.g., "frontierSign" or "methods.0")',
                },
            },
            required: ['detailId'],
        },
    },
    {
        name: 'browser_launch',
        description: 'Launch browser instance',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'browser_close',
        description: 'Close browser instance',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'browser_status',
        description: 'Get browser status (running, pages count, version)',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_navigate',
        description: `Navigate to a URL

Features:
- Automatic CAPTCHA detection
- Optional network monitoring (set enableNetworkMonitoring=true to auto-enable)
- Waits for page load based on waitUntil strategy

Network Monitoring:
If you want to capture network requests, you have two options:
1. Call network_enable before page_navigate (recommended for full control)
2. Set enableNetworkMonitoring=true in page_navigate (convenient for quick capture)

Example with network monitoring:
page_navigate(url="https://api.example.com", enableNetworkMonitoring=true)
→ Network monitoring auto-enabled
→ Page loads
→ Use network_get_requests to see captured requests`,
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Target URL to navigate to',
                },
                waitUntil: {
                    type: 'string',
                    description: 'When to consider navigation succeeded',
                    enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'],
                    default: 'networkidle2',
                },
                timeout: {
                    type: 'number',
                    description: 'Navigation timeout in milliseconds',
                    default: 30000,
                },
                enableNetworkMonitoring: {
                    type: 'boolean',
                    description: '✨ Auto-enable network monitoring before navigation to capture all requests. If already enabled, this has no effect.',
                    default: false,
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'page_reload',
        description: 'Reload current page',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_back',
        description: 'Navigate back in history',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_forward',
        description: 'Navigate forward in history',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'dom_query_selector',
        description: 'Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector',
                },
                getAttributes: {
                    type: 'boolean',
                    description: 'Whether to get element attributes',
                    default: true,
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'dom_query_all',
        description: 'Query all matching elements (like document.querySelectorAll)',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of elements to return',
                    default: 100,
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'dom_get_structure',
        description: `Get page DOM structure (for AI to understand page layout).

⚠️ IMPORTANT: Large DOM structures (>50KB) automatically return summary + detailId.

Best Practices:
1. Use maxDepth=2 for initial exploration (faster, smaller)
2. Use maxDepth=3 only when needed (may be large)
3. Set includeText=false to reduce size if text not needed

Example:
dom_get_structure(maxDepth=2, includeText=false)
→ Returns compact structure without text content`,
        inputSchema: {
            type: 'object',
            properties: {
                maxDepth: {
                    type: 'number',
                    description: 'Maximum depth of DOM tree (default: 3, recommend: 2 for large pages)',
                    default: 3,
                },
                includeText: {
                    type: 'boolean',
                    description: 'Whether to include text content (set false to reduce size)',
                    default: true,
                },
            },
        },
    },
    {
        name: 'dom_find_clickable',
        description: 'Find all clickable elements (buttons, links). Use this to discover what can be clicked.',
        inputSchema: {
            type: 'object',
            properties: {
                filterText: {
                    type: 'string',
                    description: 'Filter by text content (optional)',
                },
            },
        },
    },
    {
        name: 'page_click',
        description: 'Click an element. Use dom_query_selector FIRST to verify element exists.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of element to click',
                },
                button: {
                    type: 'string',
                    description: 'Mouse button to click',
                    enum: ['left', 'right', 'middle'],
                    default: 'left',
                },
                clickCount: {
                    type: 'number',
                    description: 'Number of clicks',
                    default: 1,
                },
                delay: {
                    type: 'number',
                    description: 'Delay between mousedown and mouseup in milliseconds',
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'page_type',
        description: 'Type text into an input element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of input element',
                },
                text: {
                    type: 'string',
                    description: 'Text to type',
                },
                delay: {
                    type: 'number',
                    description: 'Delay between key presses in milliseconds',
                },
            },
            required: ['selector', 'text'],
        },
    },
    {
        name: 'page_select',
        description: 'Select option(s) in a <select> element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of select element',
                },
                values: {
                    type: 'array',
                    description: 'Values to select',
                    items: {
                        type: 'string',
                    },
                },
            },
            required: ['selector', 'values'],
        },
    },
    {
        name: 'page_hover',
        description: 'Hover over an element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of element to hover',
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'page_scroll',
        description: 'Scroll the page',
        inputSchema: {
            type: 'object',
            properties: {
                x: {
                    type: 'number',
                    description: 'Horizontal scroll position',
                    default: 0,
                },
                y: {
                    type: 'number',
                    description: 'Vertical scroll position',
                    default: 0,
                },
            },
        },
    },
    {
        name: 'page_wait_for_selector',
        description: 'Wait for an element to appear',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector to wait for',
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds',
                    default: 30000,
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'page_evaluate',
        description: `Execute JavaScript code in page context and get result.

⚠️ IMPORTANT: Large results (>50KB) automatically return summary + detailId to prevent context overflow.
Use get_detailed_data(detailId) to retrieve full data if needed.

Best Practices:
- ✅ Query specific properties: { hasAcrawler: !!window.byted_acrawler }
- ✅ Return only needed data: Object.keys(window.byted_acrawler)
- ❌ Avoid returning entire objects: window (too large!)

Example:
page_evaluate("({ keys: Object.keys(window.byted_acrawler), type: typeof window.byted_acrawler })")
→ Returns small summary
→ If you need full object, use the returned detailId`,
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'JavaScript code to execute',
                },
                autoSummarize: {
                    type: 'boolean',
                    description: 'Auto-summarize large results (default: true)',
                    default: true,
                },
                maxSize: {
                    type: 'number',
                    description: 'Max result size in bytes before auto-summarizing (default: 50KB)',
                    default: 51200,
                },
            },
            required: ['code'],
        },
    },
    {
        name: 'page_screenshot',
        description: 'Take a screenshot of the page',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path to save screenshot (optional)',
                },
                type: {
                    type: 'string',
                    description: 'Image format',
                    enum: ['png', 'jpeg'],
                    default: 'png',
                },
                quality: {
                    type: 'number',
                    description: 'Image quality (0-100, only for jpeg)',
                },
                fullPage: {
                    type: 'boolean',
                    description: 'Capture full scrollable page',
                    default: false,
                },
            },
        },
    },
    {
        name: 'get_all_scripts',
        description: 'Get list of all loaded scripts on the page',
        inputSchema: {
            type: 'object',
            properties: {
                includeSource: {
                    type: 'boolean',
                    description: 'Whether to include script source code',
                    default: false,
                },
            },
        },
    },
    {
        name: 'get_script_source',
        description: `Get source code of a specific script.

⚠️ IMPORTANT: Large scripts (>50KB) automatically return summary + detailId.
Use preview mode first to check script size before fetching full source.

Best Practices:
1. Use preview=true first to see script overview
2. If script is large, use detailId to get full source
3. Or use startLine/endLine to get specific sections

Example:
get_script_source(scriptId="abc", preview=true)
→ Returns: { lines: 5000, size: "500KB", preview: "...", detailId: "..." }
→ Then: get_detailed_data(detailId) to get full source`,
        inputSchema: {
            type: 'object',
            properties: {
                scriptId: {
                    type: 'string',
                    description: 'Script ID from get_all_scripts',
                },
                url: {
                    type: 'string',
                    description: 'Script URL (supports wildcards like *.js)',
                },
                preview: {
                    type: 'boolean',
                    description: 'Return preview only (first 100 lines + metadata)',
                    default: false,
                },
                maxLines: {
                    type: 'number',
                    description: 'Max lines to return in preview mode (default: 100)',
                    default: 100,
                },
                startLine: {
                    type: 'number',
                    description: 'Start line number (1-based, for partial fetch)',
                },
                endLine: {
                    type: 'number',
                    description: 'End line number (1-based, for partial fetch)',
                },
            },
        },
    },
    {
        name: 'console_enable',
        description: 'Enable console monitoring to capture console.log, console.error, etc.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'console_get_logs',
        description: 'Get captured console logs',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Filter by log type',
                    enum: ['log', 'warn', 'error', 'info', 'debug'],
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of logs to return',
                },
                since: {
                    type: 'number',
                    description: 'Only return logs after this timestamp',
                },
            },
        },
    },
    {
        name: 'console_execute',
        description: 'Execute JavaScript expression in console context',
        inputSchema: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: 'JavaScript expression to execute',
                },
            },
            required: ['expression'],
        },
    },
    {
        name: 'dom_get_computed_style',
        description: 'Get computed CSS styles of an element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector',
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'dom_find_by_text',
        description: 'Find elements by text content (useful for dynamic content)',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to search for',
                },
                tag: {
                    type: 'string',
                    description: 'Optional tag name to filter (e.g., "button", "a")',
                },
            },
            required: ['text'],
        },
    },
    {
        name: 'dom_get_xpath',
        description: 'Get XPath of an element',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector',
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'dom_is_in_viewport',
        description: 'Check if element is visible in viewport',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector',
                },
            },
            required: ['selector'],
        },
    },
    {
        name: 'page_get_performance',
        description: 'Get page performance metrics (load time, network time, etc.)',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_inject_script',
        description: 'Inject JavaScript code into page',
        inputSchema: {
            type: 'object',
            properties: {
                script: {
                    type: 'string',
                    description: 'JavaScript code to inject',
                },
            },
            required: ['script'],
        },
    },
    {
        name: 'page_set_cookies',
        description: 'Set cookies for the page',
        inputSchema: {
            type: 'object',
            properties: {
                cookies: {
                    type: 'array',
                    description: 'Array of cookie objects',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            value: { type: 'string' },
                            domain: { type: 'string' },
                            path: { type: 'string' },
                            expires: { type: 'number' },
                            httpOnly: { type: 'boolean' },
                            secure: { type: 'boolean' },
                            sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
                        },
                        required: ['name', 'value'],
                    },
                },
            },
            required: ['cookies'],
        },
    },
    {
        name: 'page_get_cookies',
        description: 'Get all cookies for the page',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_clear_cookies',
        description: 'Clear all cookies',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_set_viewport',
        description: 'Set viewport size',
        inputSchema: {
            type: 'object',
            properties: {
                width: {
                    type: 'number',
                    description: 'Viewport width',
                },
                height: {
                    type: 'number',
                    description: 'Viewport height',
                },
            },
            required: ['width', 'height'],
        },
    },
    {
        name: 'page_emulate_device',
        description: 'Emulate mobile device (iPhone, iPad, Android)',
        inputSchema: {
            type: 'object',
            properties: {
                device: {
                    type: 'string',
                    description: 'Device to emulate',
                    enum: ['iPhone', 'iPad', 'Android'],
                },
            },
            required: ['device'],
        },
    },
    {
        name: 'page_get_local_storage',
        description: 'Get all localStorage items',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'page_set_local_storage',
        description: 'Set localStorage item',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Storage key',
                },
                value: {
                    type: 'string',
                    description: 'Storage value',
                },
            },
            required: ['key', 'value'],
        },
    },
    {
        name: 'page_press_key',
        description: 'Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key to press',
                },
            },
            required: ['key'],
        },
    },
    {
        name: 'page_get_all_links',
        description: 'Get all links on the page',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'captcha_detect',
        description: `🤖 AI驱动的验证码检测器

**检测方式**:
1. 优先使用AI视觉识别（需要支持Vision的LLM模型）
2. AI不可用时，返回截图让外部AI智能体分析
3. 最后降级到基于规则的检测

**支持检测的验证码类型**:
- 滑块验证码 (Slider CAPTCHA): 极验、阿里云、腾讯等
- 图形验证码 (Image CAPTCHA)
- reCAPTCHA / hCaptcha
- Cloudflare Challenge
- 页面重定向到验证页

**返回结果包含**:
- detected: 是否检测到验证码
- type: 验证码类型
- vendor: 验证码厂商
- confidence: 检测置信度 (0-100)
- reasoning: AI的推理过程
- screenshot: 页面截图（base64编码）- 当MCP内部AI不可用时返回
- suggestions: 处理建议

**特殊情况**:
如果MCP内部LLM不支持Vision API（如使用DeepSeek），会返回：
- screenshot: base64编码的页面截图
- reasoning: 包含详细的分析提示词
- vendor: "external-ai-required"
此时请使用外部AI智能体（GPT-4o、Claude 3等）分析screenshot字段中的图片。`,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'captcha_wait',
        description: `等待用户手动完成验证码

使用场景：
1. 检测到验证码后调用此工具
2. 工具会持续检测验证码是否完成
3. 验证完成后自动返回，继续执行后续任务
4. 超时后返回失败

注意：此工具会阻塞执行，直到验证完成或超时`,
        inputSchema: {
            type: 'object',
            properties: {
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default: 300000 = 5 minutes)',
                    default: 300000,
                },
            },
        },
    },
    {
        name: 'captcha_config',
        description: `配置验证码检测选项

可配置项：
- autoDetectCaptcha: 是否在page_navigate后自动检测验证码 (默认true)
- autoSwitchHeadless: 是否检测到验证码时自动切换到有头模式 (默认true)
- captchaTimeout: 等待用户完成验证的超时时间，单位毫秒 (默认300000)`,
        inputSchema: {
            type: 'object',
            properties: {
                autoDetectCaptcha: {
                    type: 'boolean',
                    description: 'Whether to automatically detect CAPTCHA after navigation',
                },
                autoSwitchHeadless: {
                    type: 'boolean',
                    description: 'Whether to automatically switch to headed mode when CAPTCHA detected',
                },
                captchaTimeout: {
                    type: 'number',
                    description: 'Timeout for waiting user to complete CAPTCHA (milliseconds)',
                },
            },
        },
    },
    {
        name: 'stealth_inject',
        description: `注入2024-2025最新反检测脚本

包含以下反检测技术：
1. 隐藏 navigator.webdriver 属性
2. 模拟真实的 window.chrome 对象
3. 添加真实的 navigator.plugins
4. 修复 Permissions API
5. Canvas 指纹一致性处理
6. WebGL 指纹模拟
7. 语言和时区设置
8. Battery API 模拟
9. MediaDevices 修复
10. Notification 权限模拟

基于以下项目的最佳实践：
- undetected-chromedriver
- Playwright-backed anti-detection scripts
- playwright-stealth

建议在 browser_launch 后立即调用此工具`,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'stealth_set_user_agent',
        description: `设置真实的User-Agent并确保一致性

会同时设置：
- User-Agent 字符串
- navigator.platform
- navigator.vendor
- navigator.hardwareConcurrency
- navigator.deviceMemory

确保所有属性与选择的平台一致，避免被检测`,
        inputSchema: {
            type: 'object',
            properties: {
                platform: {
                    type: 'string',
                    description: 'Target platform',
                    enum: ['windows', 'mac', 'linux'],
                    default: 'windows',
                },
            },
        },
    },
];
//# sourceMappingURL=BrowserToolDefinitions.js.map
