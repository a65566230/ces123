// @ts-nocheck

export const aiHookTools = [
    {
        name: 'ai_hook_generate',
        description: `🤖 AI驱动的Hook代码生成器

**功能**：根据自然语言描述自动生成Hook代码

**使用场景**：
1. 分析目标网站后，发现需要Hook某个特定函数
2. 描述Hook需求（例如："Hook所有加密相关的函数调用"）
3. 自动生成对应的Hook代码
4. 使用 ai_hook_inject 注入到浏览器

**支持的Hook类型**：
- function: Hook全局函数（如 window.btoa, window.atob）
- object-method: Hook对象方法（如 crypto.subtle.encrypt）
- api: Hook浏览器API（如 fetch, XMLHttpRequest）
- property: Hook对象属性
- event: Hook事件监听器
- custom: 自定义Hook代码

**示例**：
\`\`\`json
{
  "description": "Hook所有fetch请求，捕获URL和响应",
  "target": {
    "type": "api",
    "name": "fetch"
  },
  "behavior": {
    "captureArgs": true,
    "captureReturn": true,
    "logToConsole": true
  },
  "condition": {
    "urlPattern": "api\\\\.example\\\\.com"
  }
}
\`\`\``,
        inputSchema: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Hook的自然语言描述（例如："Hook所有加密函数"）',
                },
                target: {
                    type: 'object',
                    description: 'Hook目标',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['function', 'object-method', 'api', 'property', 'event', 'custom'],
                            description: 'Hook类型',
                        },
                        name: {
                            type: 'string',
                            description: '函数名或API名（如 "btoa", "fetch"）',
                        },
                        pattern: {
                            type: 'string',
                            description: '正则匹配模式（用于匹配多个函数）',
                        },
                        object: {
                            type: 'string',
                            description: '对象路径（如 "window.crypto.subtle"）',
                        },
                        property: {
                            type: 'string',
                            description: '属性名或方法名',
                        },
                    },
                    required: ['type'],
                },
                behavior: {
                    type: 'object',
                    description: 'Hook行为配置',
                    properties: {
                        captureArgs: {
                            type: 'boolean',
                            description: '是否捕获函数参数',
                            default: true,
                        },
                        captureReturn: {
                            type: 'boolean',
                            description: '是否捕获返回值',
                            default: true,
                        },
                        captureStack: {
                            type: 'boolean',
                            description: '是否捕获调用栈',
                            default: false,
                        },
                        modifyArgs: {
                            type: 'boolean',
                            description: '是否修改参数',
                            default: false,
                        },
                        modifyReturn: {
                            type: 'boolean',
                            description: '是否修改返回值',
                            default: false,
                        },
                        blockExecution: {
                            type: 'boolean',
                            description: '是否阻止函数执行',
                            default: false,
                        },
                        logToConsole: {
                            type: 'boolean',
                            description: '是否输出到控制台',
                            default: true,
                        },
                    },
                },
                condition: {
                    type: 'object',
                    description: '条件过滤',
                    properties: {
                        argFilter: {
                            type: 'string',
                            description: '参数过滤条件（JS表达式，如 "args[0].includes(\'password\')"）',
                        },
                        returnFilter: {
                            type: 'string',
                            description: '返回值过滤条件',
                        },
                        urlPattern: {
                            type: 'string',
                            description: 'URL匹配模式（正则表达式字符串）',
                        },
                        maxCalls: {
                            type: 'number',
                            description: '最大捕获调用次数',
                        },
                    },
                },
                customCode: {
                    type: 'object',
                    description: '自定义代码片段',
                    properties: {
                        before: {
                            type: 'string',
                            description: '在函数执行前运行的代码',
                        },
                        after: {
                            type: 'string',
                            description: '在函数执行后运行的代码',
                        },
                        replace: {
                            type: 'string',
                            description: '完全替换原函数的代码',
                        },
                    },
                },
            },
            required: ['description'],
        },
    },
    {
        name: 'ai_hook_inject',
        description: `注入AI生成的Hook代码到浏览器

**注入方法**：
- evaluateOnNewDocument: 在新文档加载前注入（适用于API Hook，如fetch、XHR）
- evaluate: 在当前页面注入（适用于函数Hook、事件Hook）

**注意**：
- API Hook必须在页面加载前注入才能生效
- 函数Hook可以在页面加载后注入`,
        inputSchema: {
            type: 'object',
            properties: {
                hookId: {
                    type: 'string',
                    description: 'Hook ID（从 ai_hook_generate 返回）',
                },
                code: {
                    type: 'string',
                    description: 'Hook代码（从 ai_hook_generate 返回）',
                },
                method: {
                    type: 'string',
                    enum: ['evaluateOnNewDocument', 'evaluate'],
                    description: '注入方法',
                    default: 'evaluate',
                },
            },
            required: ['hookId', 'code'],
        },
    },
    {
        name: 'ai_hook_get_data',
        description: `获取Hook捕获的数据

返回指定Hook捕获的所有调用记录，包括：
- 参数
- 返回值
- 调用栈
- 时间戳
- 调用次数`,
        inputSchema: {
            type: 'object',
            properties: {
                hookId: {
                    type: 'string',
                    description: 'Hook ID',
                },
            },
            required: ['hookId'],
        },
    },
    {
        name: 'ai_hook_list',
        description: `列出所有已注入的Hook

返回所有活动Hook的列表，包括：
- Hook ID
- 创建时间
- 启用状态
- 捕获的记录数量`,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'ai_hook_clear',
        description: `清除Hook捕获的数据

可以清除特定Hook的数据，或清除所有Hook的数据`,
        inputSchema: {
            type: 'object',
            properties: {
                hookId: {
                    type: 'string',
                    description: 'Hook ID（可选，不提供则清除所有Hook数据）',
                },
            },
        },
    },
    {
        name: 'ai_hook_toggle',
        description: `启用或禁用Hook

禁用的Hook不会捕获新的调用，但已捕获的数据会保留`,
        inputSchema: {
            type: 'object',
            properties: {
                hookId: {
                    type: 'string',
                    description: 'Hook ID',
                },
                enabled: {
                    type: 'boolean',
                    description: '是否启用',
                },
            },
            required: ['hookId', 'enabled'],
        },
    },
    {
        name: 'ai_hook_export',
        description: `导出Hook数据

支持导出为JSON或CSV格式`,
        inputSchema: {
            type: 'object',
            properties: {
                hookId: {
                    type: 'string',
                    description: 'Hook ID（可选，不提供则导出所有Hook）',
                },
                format: {
                    type: 'string',
                    enum: ['json', 'csv'],
                    description: '导出格式',
                    default: 'json',
                },
            },
        },
    },
];
//# sourceMappingURL=AIHookToolDefinitions.js.map
