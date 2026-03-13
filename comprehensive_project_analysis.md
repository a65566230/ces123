# JSHook Reverse Tool — 系统性问题分析与改进建议评审

> 本报告基于当前工作区真实代码、配置文件、README、V2/Legacy 实现、以及已有分析文档（[project_analysis.md](file:///e:/work/jshook-reverse-tool-main/docs/plans/project_analysis.md)、[mcp_deep_analysis.md](file:///e:/work/jshook-reverse-tool-main/docs/plans/mcp_deep_analysis.md)、[optimization_analysis.final.md](file:///e:/work/jshook-reverse-tool-main/optimization_analysis.final.md)），对项目进行有证据支撑的系统性问题分析。所有结论均标注证据等级。

---

## 项目问题总览

| 维度 | 严重度 | 核心发现 | 证据等级 |
|---|---|---|---|
| 源码质量 | 🔴 | src/ 中 50+ 文件为编译产物（`@ts-nocheck` + `sourceMappingURL`） | ✅ 代码证实 |
| API 安全 | 🔴 | [.env](file:///e:/work/jshook-reverse-tool-main/.env) 中硬编码 API Key 已提交仓库 | ✅ 代码证实 |
| 工具执行安全 | 🔴 | [ToolExecutor](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts#5-32) 无超时、无并发控制、速率限制器未生效 | ✅ 代码证实 |
| 浏览器稳定性 | 🔴 | [BrowserPool](file:///e:/work/jshook-reverse-tool-main/src/services/BrowserPool.ts#252-431) 无心跳、无崩溃恢复、无 `disconnected` 事件监听 | ✅ 代码证实 |
| 自动逆向精准度 | 🟠 | [FunctionRanker](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts#11-81) 仅匹配函数前 240 字符的关键词，无运行时信号 | ✅ 代码证实 |
| Hook 完整性 | 🟠 | Property Hook / Event Hook 为 stub（`not yet implemented`） | ✅ 代码证实 |
| V2/Legacy 双轨 | 🟠 | Watch/XHR/Event/Blackbox 四类能力仅存于 Legacy，V2 默认面缺失 | ✅ 代码证实 |
| 反混淆 V2 入口 | 🟡 | 底层有 6 个反混淆模块，但无 V2 一等工具入口 | ✅ 代码证实 |
| 文件体量 | 🟡 | [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) 76KB / [createV2Tools.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/createV2Tools.ts) 42KB 等巨型文件 | ✅ 代码证实 |
| 验证闭环 | 🟡 | Hook 验证后 `no-hit` 不自动遍历候选，需 AI 手动决策 | ✅ 代码证实 |

---

## 一、当前项目的核心问题

### 1.1 架构问题

#### 🔴 源码为编译产物——TypeScript 严格检查形同虚设

- **现象**: `src/` 下 50+ 个 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 文件同时包含 `// @ts-nocheck` 和 `//# sourceMappingURL=*.js.map`
- **代码证据**: [ToolExecutor.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts) 第 1 行 `// @ts-nocheck`、第 32 行 `//# sourceMappingURL=ToolExecutor.js.map`；[ToolRegistry.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolRegistry.ts)、[SessionLifecycleManager.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/SessionLifecycleManager.ts) 等均如此
- **影响**: [tsconfig.json](file:///e:/work/jshook-reverse-tool-main/tsconfig.json) 中开启的 `strict: true`、`noUnusedLocals` 等设置完全被绕过; IDE 无类型推导、无重构支持; 所有函数参数无类型标注 ([constructor(config)](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/ObfuscationAnalysisService.ts#14-20) 而非 [constructor(config: Config)](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/ObfuscationAnalysisService.ts#14-20))
- **证据等级**: ✅ 已由代码证实

#### 🟠 V2 / Legacy 双轨维护负担

- **现象**: 项目同时维护 V2 工具系统（分组命名如 `browser.launch`）、Legacy 工具系统（扁平命名如 `browser_launch`）、[LegacyToolBridge](file:///e:/work/jshook-reverse-tool-main/src/server/v2/legacy/LegacyToolBridge.ts#5-37) 兼容层
- **代码证据**: [LegacyToolBridge.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/legacy/LegacyToolBridge.ts) 通过 `MCPServer` 实例包装 Legacy 工具; `ENABLE_LEGACY_TOOLS=false` 为默认值，但 Legacy 代码 [MCPServer.ts](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts) (1385 行) 仍保留
- **影响**: 三套系统并存增加测试和维护成本; Watch/XHR/Event/Blackbox 等高价值调试能力仅存于 Legacy，V2 用户默认无法访问
- **证据等级**: ✅ 已由代码证实

#### 🟠 巨型文件影响可维护性

| 文件 | 大小 | 问题 |
|---|---|---|
| [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) | 76 KB / 1578 行 | 包含全部 `flow.*` 工具逻辑、scoring、候选遍历、验证 |
| [createV2Tools.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/createV2Tools.ts) | 42 KB | 全部 V2 工具入口定义集中于此 |
| [LLMService.ts](file:///e:/work/jshook-reverse-tool-main/src/services/LLMService.ts) | 49 KB / 1270 行 | 混合 OpenAI/Anthropic/缓存/重试/提示词 |
| [StorageService.ts](file:///e:/work/jshook-reverse-tool-main/src/services/StorageService.ts) | 42 KB / 1360 行 | 数据库操作全集中 |

- **证据等级**: ✅ 已由代码证实

### 1.2 工具面设计问题

#### 🟠 分组工具 + action enum 的认知成本

- **现象**: 操作如 Watch/XHR breakpoint/Blackbox 需要通过 [action](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#155-170) 参数区分，而非独立命令
- **对比**: `jshook-skill` 中 `watch add "expr"` / `xhr-breakpoint set */api/*` 是独立命令，心智成本更低
- **影响**: Agent/新用户需先理解分组，再理解 action schema，高频动作门槛偏高
- **证据等级**: ✅ 已由代码/README 证实

#### 🟡 V2 默认面缺失约 27% 的 jshook-skill 命令等价

已缺失的关键能力（仅指 V2 默认工具面，底层代码可能存在）:

| 缺失能力 | 底层状态 | V2 状态 |
|---|---|---|
| Watch 表达式管理 | Legacy 中存在 `watch_*` | V2 默认面缺失 |
| XHR Breakpoint | Legacy 中存在 `xhr_breakpoint_*` | V2 默认面缺失 |
| Event Breakpoint | Legacy 中存在 `event_breakpoint_*` | V2 默认面缺失 |
| Blackbox 管理 | Legacy 中存在 `blackbox_*` | V2 默认面缺失 |
| [deobfuscate](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/ObfuscationAnalysisService.ts#35-94) 一等入口 | [Deobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/Deobfuscator.ts) + [AdvancedDeobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/AdvancedDeobfuscator.ts) 底层已有 | V2 无直接工具入口 |
| `understand` 代码理解 | `CodeAnalyzer.ts` 底层已有 | V2 无直接工具入口 |
| `summarize` 代码摘要 | 需 LLM 服务 | V2 无直接工具入口 |
| Stealth 独立管理 | `StealthScripts2025.ts` 底层已有 | V2 仅通过 `flow.collect-site` 间接覆盖 |

- **证据等级**: ✅ 已由代码证实（底层存在 vs. V2 工具面暴露对比）

### 1.3 自动逆向能力问题

#### 🔴 函数发现排名完全基于关键词匹配——对混淆代码几乎无效

- **代码证据**: [FunctionRanker.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts) 第 24-34 行:
  ```javascript
  for (const [pattern, reason, weight] of [
    [/sign|signature|token|nonce|timestamp/i, 'request-signing-keywords', 5],
    [/crypto|encrypt|decrypt|hmac|sha|md5/i,  'crypto-keywords', 5],
    [/fetch|xmlhttprequest|authorization|headers/i, 'network-keywords', 4],
    [/eval|Function\(/i, 'dynamic-execution', 2],
  ]) {
    if (pattern.test(preview)) { score += weight; }
  }
  ```
- **关键限制**:
  - 仅匹配函数体前 **240 字符** (`generateCode(node).code.slice(0, 240)`)
  - 纯静态关键词匹配——混淆后变量名 `a`, `b`, `c` 完全无法命中
  - 不利用运行时信号（调用频率、覆盖率等）
  - 无 AST 结构分析（参数数量、返回值模式、控制流复杂度）
  - 同时命中多个关键词仅做简单累加，无超线性加分
- **证据等级**: ✅ 已由代码证实

#### 🟠 签名候选发现依赖静态关键词扫描

- **代码证据**: [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) 第 682 行:
  ```javascript
  const keywords = [args.urlPattern, args.targetField, args.method,
    'sign', 'signature', 'token', 'nonce', 'timestamp']
    .filter(v => typeof v === 'string' && v.trim().length > 0);
  ```
- **缺陷**:
  - 关键词硬编码，无法适应非加密签名类场景（如 `vkey` 加密播放密钥）
  - 不与请求拦截器结果交叉验证——即不确认候选函数是否真的参与了目标请求构建
  - [getCoverageBoostMaps()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#48-62) 存在（第 48-61 行）但其在 [buildTraceCorrelation](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#667-778) 中的调用路径不明确
- **证据等级**: ✅ 已由代码证实

### 1.4 自动 Hook 精准度问题

#### 🔴 Property Hook / Event Hook 未实现

- **代码证据**: [AIHookGenerator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/hook/AIHookGenerator.ts) 第 515-523 行:
  ```javascript
  generatePropertyHook(request, _hookId) {
    const code = `// Property Hook not yet implemented for: ${request.description}`;
    // ...
  }
  generateEventHook(request, _hookId) {
    const code = `// Event Hook not yet implemented for: ${request.description}`;
    // ...
  }
  ```
- **影响**: Property Hook 是观测派生值计算路径的核心能力。缺失它意味着 **无法自动追踪 `vkey` 等通过 `Object.defineProperty` / getter 赋值的派生字段**
- **证据等级**: ✅ 已由代码证实

#### 🟠 Hook 验证闭环不完整

- **代码证据**: [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) [validateInjectedHookCandidate()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#626-666) (第 626-665 行):
  - 验证只检查 `window.__aiHooks` 中是否有记录
  - 当返回 `no-hit` 时，需 AI 代理手动决定下一步
  - **没有自动候选遍历循环**（hook → 触发 → 验证 → 不命中则尝试下一候选）
- **影响**: 全自动逆向流程被打断，依赖 AI 代理的决策质量
- **证据等级**: ✅ 已由代码证实

#### 🟠 LLM 辅助 Hook 计划的可靠性

- **代码证据**: [AIHookGenerator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/hook/AIHookGenerator.ts) 第 144-167 行:
  ```javascript
  const response = await this.llm.chat(messages, { temperature: 0.1, maxTokens: 600 });
  const match = response.content.match(/\{[\s\S]*\}/);
  if (match) { const parsed = JSON.parse(match[0]); }
  ```
  - 用正则从 LLM 输出提取 JSON——脆弱
  - `catch (_error) {}` 吞掉所有 LLM 错误，静默回退到 fetch 捕获
  - `maxTokens: 600` 对复杂场景可能不够
- **证据等级**: ✅ 已由代码证实

### 1.5 稳定性问题

#### 🔴 浏览器崩溃无自动恢复

- **代码证据**: [BrowserPool.ts](file:///e:/work/jshook-reverse-tool-main/src/services/BrowserPool.ts):
  - 无 `browser.on('disconnected')` 事件监听（整个 431 行文件中未出现 `disconnected`）
  - 无心跳检查机制
  - LRU 驱逐（第 396-402 行）不考虑会话是否有活跃断点
  - `page.close().catch(() => undefined)` 吞掉崩溃信息（第 329 行）
- **影响**: 复杂网站长时间逆向分析时，浏览器崩溃概率高，系统无法自动恢复
- **证据等级**: ✅ 已由代码证实

#### 🔴 工具执行无超时/取消/并发控制

- **代码证据**: [ToolExecutor.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts) 核心 [execute()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/legacy/LegacyToolBridge.ts#29-33) 仅 20 行:
  ```javascript
  return await descriptor.execute(args, { runtime: this.runtime, descriptor });
  ```
  - ❌ 无 `AbortController`/`Promise.race` 超时
  - ❌ 无并发控制——多工具可同时操作同一浏览器页面
  - ❌ `ToolRateLimiter.check()` 从未被调用（[ToolRateLimiter](file:///e:/work/jshook-reverse-tool-main/src/services/ToolRateLimiter.ts#6-49) 在 [ToolRuntimeContext](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/ToolRuntimeContext.ts#15-77) 中创建但 [ToolExecutor](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts#5-32) 从不调用 [check()](file:///e:/work/jshook-reverse-tool-main/src/services/ToolRateLimiter.ts#16-40)）
- **证据等级**: ✅ 已由代码证实

#### 🟠 CDP 会话断连无自动重连

- **代码证据**: [DebuggerManager.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/debugger/DebuggerManager.ts) 未监听 [CDPSession](file:///e:/work/jshook-reverse-tool-main/src/services/BrowserPool.ts#167-170) 的 `disconnected` 事件; `waitForPaused()` 只有单一超时（默认 30s）
- **证据等级**: ✅ 代码证实（来自 [mcp_deep_analysis.md](file:///e:/work/jshook-reverse-tool-main/docs/plans/mcp_deep_analysis.md) + 代码验证）

### 1.6 工程化与维护性问题

| 问题 | 证据 | 等级 |
|---|---|---|
| ESLint 禁用 5 条关键安全规则 | [eslint.config.mjs](file:///e:/work/jshook-reverse-tool-main/eslint.config.mjs) 禁用 `ban-ts-comment`、`no-explicit-any`、`no-this-alias`、`no-unsafe-function-type`、`no-unused-vars` | ✅ 代码证实 |
| `any` 类型泛滥 | `types/index.ts` 多处 `any`；ESLint 禁用 `no-explicit-any` 导致无告警 | ✅ 代码证实 |
| 重复接口声明 | `HookCondition` 在 `types/index.ts` 中定义了两个不同版本（第 331 / 337 行） | ✅ 代码证实 |
| 硬编码模型名称 | `gpt-5.4` / `claude-3-5-sonnet-20241022` 至少散落 8 处 | ✅ 代码/文档可见 |
| 混合中英文日志 | 日志消息不一致 | ✅ 代码证实 |
| `StorageService.init()` 异步但非自动调用 | 忘记调用 [init()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/legacy/LegacyToolBridge.ts#14-23) 会抛 "database not initialized" | ✅ 代码证实 |

### 1.7 文档与易用性问题

- README 已较完整地描述了 V2 工具组, 但 **V2 默认面 vs 底层总能力 vs Legacy 保留能力之间的边界未明确文档化**
- 无"场景 → 工具"快速路由表
- [.env.example](file:///e:/work/jshook-reverse-tool-main/.env.example) 与实际 [.env](file:///e:/work/jshook-reverse-tool-main/.env) 配置项不一致（如 `OPENAI_DISABLE_RESPONSE_STORAGE`）
- **证据等级**: ✅ 已由代码/README 证实

---

## 二、问题根因分析

### 根因一：编译产物被当作源码——根本性的代码质量瓶颈

> 这不是"TypeScript 配置问题"，而是 **源码已丢失或不在此仓库中**。

`src/` 中的 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 文件实质是编译后的 JS 重命名为 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts)，导致:
- TypeScript 严格检查完全失效
- ESLint 被迫关闭关键规则以避免大量误报
- 所有后续代码改进（类型安全、重构等）的收益被根本性地削弱

### 根因二：V2 主路径迁移未完成——能力"存在但不可见"

| 层次 | 现象 | 根因 |
|---|---|---|
| 底层模块 | `DebuggerManager`、`WatchExpressionManager` 等均存在 | 非底层缺失 |
| 工具面暴露 | Watch/XHR/Event/Blackbox 仅通过 Legacy 暴露 | V2 [createV2Tools.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/createV2Tools.ts) 未为这些能力创建一等入口 |
| 默认配置 | `ENABLE_LEGACY_TOOLS=false` | 高价值专家能力默认不可见 |

**结论**: 问题不在于底层能力缺失，而在于 V2 主路径未完整承接 Legacy 的专家级调试能力。

### 根因三：自动逆向的候选发现完全依赖静态分析——对混淆代码失效

| 阶段 | 当前方法 | 问题 |
|---|---|---|
| 脚本筛选 | 关键词搜索（最多 40 个脚本） | 混淆代码无可匹配的关键词 |
| 函数排名 | [FunctionRanker](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts#11-81) 前 240 字符关键词 | 大函数关键逻辑可能在末尾；混淆后变量名无意义 |
| 候选验证 | Hook 注入后检查 `__aiHooks` | 无自动遍历循环；Property Hook 缺失导致无法观测赋值路径 |

**结论**: 自动逆向的根本瓶颈在于 **缺少运行时信号对静态分析的补充**，以及 **Property Hook 缺失导致派生值追踪断裂**。

### 根因四：`vkey` 类派生字段比 `songmid` 更难命中的原因

| 字段类型 | `songmid`（显式字段） | `vkey`（派生/最终签名字段） |
|---|---|---|
| 出现位置 | 直接出现在 URL 参数或 JSON body 关键字中 | 经过多级加密/拼接后才出现在最终请求中 |
| 关键词可匹配性 | `songmid` 本身可被 `targetField` 匹配 | `vkey` 的生成代码中变量名可能被混淆为 `a`, `b`, `c` |
| 请求可见性 | 在 `inspect.network` 中直接可见 | 可能只在导航后的某个动态构建阶段短暂出现 |
| Hook 类型需求 | Function Hook / API Hook 足够观测 | 需要 **Property Hook** 观测赋值路径，但此类 Hook 未实现 |
| 候选定位方式 | `flow.trace-request` 的 `targetField` 匹配即可命中 | 需要 **运行时覆盖率 + 断点 + Property Hook** 组合才能定位 |

**结论**: 显式字段更容易命中是因为关键词匹配本身就能覆盖; 派生字段需要 **运行时数据流追踪**，而当前项目在这方面存在关键能力断裂（Property Hook 未实现 + [FunctionRanker](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts#11-81) 不使用运行时信号）。

---

## 三、当前项目的主要缺陷

### 3.1 已由代码证实的缺陷

| # | 缺陷 | 影响 |
|---|---|---|
| D1 | [ToolExecutor](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts#5-32) 无执行超时 | 工具可无限期阻塞，整个 MCP 服务卡死 |
| D2 | `ToolRateLimiter.check()` 从未被调用 | 速率限制器形同虚设，无法防止过载 |
| D3 | [BrowserPool](file:///e:/work/jshook-reverse-tool-main/src/services/BrowserPool.ts#252-431) 无崩溃恢复 | 长时间逆向分析不可靠 |
| D4 | Property Hook / Event Hook 为 stub | 无法追踪 `vkey` 等派生字段的赋值路径 |
| D5 | [FunctionRanker](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts#11-81) 仅用前 240 字符关键词匹配 | 对混淆代码几乎无效 |
| D6 | Hook 验证后无自动候选遍历循环 | "全自动逆向"流程被打断 |
| D7 | LLM Hook 计划用正则提取 JSON，静默吞错 | 可靠性差，用户无感知 |
| D8 | Watch/XHR/Event/Blackbox 仅存于 Legacy | V2 用户默认无法访问高价值调试能力 |
| D9 | 反混淆/代码理解能力无 V2 一等入口 | 底层模块存在但无法通过 V2 工具面使用 |
| D10 | 所有源文件为编译产物，TypeScript 检查被绕过 | 代码质量改进的基础被削弱 |

### 3.2 基本合理但仍需进一步验证的缺陷

| # | 缺陷 | 需验证项 |
|---|---|---|
| D11 | [buildTraceCorrelation](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#667-778) 不与请求拦截器交叉验证 | 需确认 `flow.trace-request` 的完整调用链路是否包含拦截验证 |
| D12 | 评分体系中权重为手动调优，无基准测试 | 需实际逆向任务验证权重合理性 |
| D13 | 每个会话创建独立 `LLMService` 实例 | 需确认是否实际导致资源浪费（连接池不共享） |

### 3.3 默认工具面/工作流不够强，但底层能力存在

| 能力 | 底层状态 | V2 入口状态 |
|---|---|---|
| 反混淆 | [Deobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/Deobfuscator.ts) + [AdvancedDeobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/AdvancedDeobfuscator.ts) + [ASTOptimizer.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/ASTOptimizer.ts) + [JSVMPDeobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/JSVMPDeobfuscator.ts) + [PackerDeobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/PackerDeobfuscator.ts) + [JScramberDeobfuscator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/deobfuscator/JScramberDeobfuscator.ts) | [ObfuscationAnalysisService](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/ObfuscationAnalysisService.ts#8-95) 已封装，但无 V2 一等工具入口 |
| 代码分析 | `CodeAnalyzer.ts` | 在 `SessionLifecycleManager.buildSession()` 中创建但无 V2 工具入口 |
| Stealth | `StealthScripts2025.ts` | 仅通过 `flow.collect-site` 间接使用 |
| 覆盖率分析 | [getCoverageBoostMaps()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#48-62) 存在 | 调用路径不清晰 |

---

## 四、可以从 `jshook-skill` 借鉴的优点

> 以下基于 `jshook-skill` 公开 GitHub README 及项目结构进行分析。具体实现细节标注为"信息不足"的部分。

### 4.1 交互层优势

| 优点 | 说明 | 当前项目对比 |
|---|---|---|
| **一命令一动作** | `watch add "expr"` / `xhr-breakpoint set */api/*` 等独立命令 | 当前项目用分组 + action enum，心智成本更高 |
| **30+ 独立命令** | 直接覆盖完整逆向工作流 | 当前 V2 约 18 个等价命令 |
| **清晰的工作流文档** | README 直接给出 7 步逆向工作流示例 | 当前 README 有 flow 入口但缺少完整步骤示例 |

### 4.2 工具暴露方式优势

| 优点 | 说明 |
|---|---|
| **Skill 配置驱动** | 通过 `skill.json` + `SkillRouter.ts` 分发命令，整洁且可扩展 |
| **类型注册表** | `HookTypeRegistry.ts` 将 Hook 类型（function/fetch/xhr/property/cookie/websocket/eval/timer）独立注册，扩展性强 |
| **低 token 成本** | 作为 Claude Code Skill 运行，无需 MCP 协议层的 schema 注入开销 |

### 4.3 调试/Hook/反检测/反混淆能力设计上的优势

| 能力 | jshook-skill 设计 | 当前项目状态 |
|---|---|---|
| **Watch 表达式** | 独立 `WatchExpressionManager.ts` + 独立命令 | 底层可能存在但 V2 无入口 |
| **XHR Breakpoint** | 独立 `XHRBreakpointManager.ts` + 独立命令 | 仅 Legacy 中存在 |
| **Event Breakpoint** | 独立 `EventBreakpointManager.ts` + 独立命令 | 仅 Legacy 中存在 |
| **Blackbox** | 独立 `BlackboxManager.ts` + `set-common` 快捷命令 | 仅 Legacy 中存在 |
| **Property Hook** | README 列出 `hook generate property window.navigator` | 当前项目 Property Hook 为 stub |
| **Stealth 独立管理** | `stealth presets` / `stealth status` / `stealth features` | 当前项目仅通过 flow 间接使用 |
| **Anti-debug** | `hook anti-debug` 作为独立命令 | 当前 V2 入口不确定 |
| **HookCodeBuilder** | 独立 `HookCodeBuilder.ts` 负责代码生成 | 当前 [AIHookGenerator.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/hook/AIHookGenerator.ts) 混合了计划+生成+验证 |

### 4.4 当前项目底层已有但 V2 未承接好的能力

> [!IMPORTANT]
> 以下能力**并非当前项目底层不存在**，而是 V2 主路径未为其提供一等入口。

| 能力 | 底层位置 | V2 缺口 |
|---|---|---|
| 反混淆全流程 | `src/modules/deobfuscator/`（6 个文件），`ObfuscationAnalysisService.ts` 已封装 | 无 `analyze.deobfuscate` V2 工具 |
| 代码分析/理解 | `src/modules/analyzer/CodeAnalyzer.ts` | 无 V2 工具入口 |
| JSVMP 破解 | `JSVMPDeobfuscator.ts` (25KB) 存在 | 无 V2 工具入口 |
| Packer 解包 | `PackerDeobfuscator.ts` (6.6KB) 存在 | 无 V2 工具入口 |
| JScrambler 反混淆 | `JScramberDeobfuscator.ts` (9KB) 存在 | 无 V2 工具入口 |
| AST 优化 | `ASTOptimizer.ts` (9.5KB) 存在 | 无 V2 工具入口 |
| 加密分析（增强版） | `CryptoDetectorEnhanced.ts` + `CryptoRules.ts` | `analyze.crypto` V2 入口可能存在但未确认 |

### 4.5 不建议直接照搬、需要重设计的部分

| jshook-skill 特性 | 不建议直接照搬的原因 |
|---|---|
| **30+ 扁平命令** | 当前 V2 分组命名更适合 MCP 工具发现; 扁平命名在工具数较多时 schema 膨胀 |
| **Skill 路由方式** | 当前项目是 MCP Server 而非 Claude Code Skill，架构基础不同 |
| **无 session/artifact/evidence** | jshook-skill 面向短平快使用; 当前项目面向长流程分析，需保留结构化要素 |
| **无结构化响应 envelope** | 当前项目的 `response.ts` envelope 对 Agent 消费更友好 |
| **CDP 连接模式** | jshook-skill 直接 CDP; 当前项目通过 Playwright 适配层，更利于浏览器管理和 stealth |

---

## 五、改进建议

### 5.1 立即可做（1-2 天）

| # | 改进项 | 预期收益 | 涉及文件 |
|---|---|---|---|
| I1 | `ToolExecutor` 添加执行超时（`AbortController` + `Promise.race`） | 防止工具无限挂起 | `src/server/v2/ToolExecutor.ts` |
| I2 | `ToolExecutor.execute()` 中调用 `ToolRateLimiter.check()` | 激活已存在的速率限制器 | `src/server/v2/ToolExecutor.ts` |
| I3 | `BrowserPool` 监听 `browser.on('disconnected')` 实现自动重连 | 长时间分析可靠性 | `src/services/BrowserPool.ts` |
| I4 | 文档化 V2 默认面 vs Legacy 保留能力边界 | 消除认知混乱 | `README.md` / 新建 `docs/v2-vs-legacy.md` |
| I5 | 补充"场景 → 工具"路由表 | 降低 V2 工具使用门槛 | `README.md` / skill 文档 |

### 5.2 中期优化（1-2 周）

| # | 改进项 | 预期收益 |
|---|---|---|
| M1 | 实现 Property Hook（`Object.defineProperty` 拦截） | **关键**: 解锁派生值 (`vkey`) 追踪能力 |
| M2 | 将 Watch/XHR/Event/Blackbox 迁入 V2 作为 `debug.watch` / `debug.xhr` / `debug.event` / `debug.blackbox` | 弥合 V2 默认面缺口 |
| M3 | 新增 `analyze.deobfuscate` V2 工具入口，封装 `ObfuscationAnalysisService` | 暴露已有的反混淆能力 |
| M4 | `FunctionRanker` 增加运行时覆盖率加权 | 显著提升混淆代码的候选发现 |
| M5 | 拆分 `createV2Tools.ts` 为按组文件 | 提升可维护性 |
| M6 | Hook 验证增加自动候选遍历循环 | 减少 AI 手动决策，增强全自动能力 |
| M7 | LLM Hook 计划改用结构化输出 / JSON mode | 提升 LLM 辅助可靠性 |
| M8 | CDP 断连自动重连 + 断点恢复 | 调试场景稳定性 |

### 5.3 长期演进（1-3 月）

| # | 改进项 | 预期收益 |
|---|---|---|
| L1 | 恢复真正的 TypeScript 源码（移除 `@ts-nocheck`，补充类型标注） | 代码质量根本性提升 |
| L2 | `FunctionRanker` 增加 AST 结构特征分析（参数数量、控制流模式） | 进一步提升混淆代码定位 |
| L3 | 引入数据流追踪能力（taint analysis lite）用于派生字段定位 | 解决 `vkey` 类场景的根本瓶颈 |
| L4 | 自动化 Hook 候选遍历 + 验证 + 收敛闭环 | 接近全自动逆向 |
| L5 | 会话健康状态自动检查，在 flow 工具执行前自动恢复降级会话 | 运行时鲁棒性 |
| L6 | 基于真实 MCP 客户端做 token/context benchmark | 量化优化工具暴露策略 |
| L7 | 评估是否引入轻量级 DI 容器替代手动组装 | 可测试性和可维护性 |

---

## 六、结论

### 1. 当前项目最关键的问题是什么？

**V2 主路径未完整承接底层已有能力，同时核心运行时缺少基本安全防护（超时、速率限制、崩溃恢复）。** 项目在架构、工程化、工作流化方面已有显著进步，但 "能力存在但默认不可见/不可用" 的落差是最突出的矛盾。

### 2. 当前项目最大的缺陷是哪些？

1. **工具执行无超时、速率限制未生效、浏览器无崩溃恢复** —— 稳定性基础薄弱
2. **Property Hook / Event Hook 未实现** —— 派生字段追踪能力断裂
3. **FunctionRanker 纯关键词匹配** —— 对混淆代码几乎无效
4. **反混淆/代码理解等底层能力无 V2 入口** —— 能力存在但不可用

### 3. 哪些问题是 V2 尚未完整承接 Legacy 导致的？

- Watch 表达式管理（Legacy `watch_*`）
- XHR Breakpoint（Legacy `xhr_breakpoint_*`）
- Event Breakpoint（Legacy `event_breakpoint_*`）
- Blackbox 管理（Legacy `blackbox_*`）
- 反混淆直接入口（底层模块已有，V2 工具面未暴露）
- Stealth 独立管理（底层已有，V2 仅间接使用）

### 4. 哪些问题是自动逆向与自动 Hook 精度不足的根因？

1. **`FunctionRanker` 仅靠前 240 字符关键词匹配**——对混淆代码完全失效
2. **不利用运行时覆盖率数据**——`getCoverageBoostMaps()` 存在但调用路径不清晰
3. **Property Hook 缺失**——无法观测派生值赋值路径（如 `vkey`）
4. **Hook 验证后无自动候选遍历**——流程被打断
5. **候选发现不与请求拦截器交叉验证**——不确认候选是否真正参与目标请求

### 5. `jshook-skill` 最值得借鉴的 3~5 个点是什么？

1. **Property Hook 的一等支持**（`hook generate property`）—— 当前项目最缺的能力
2. **Watch/XHR/Event/Blackbox 作为独立命令暴露**—— 不依赖 Legacy 开关即可使用
3. **反混淆/代码理解作为独立入口**（`deobfuscate` / `understand` / `summarize`）
4. **HookTypeRegistry 的类型注册机制**—— Hook 类型扩展更清晰
5. **完整工作流示例文档**—— 7 步流程清晰明确

### 6. 最值得优先做的 3~5 个改造项

| 优先级 | 改造项 | 理由 |
|---|---|---|
| **P0** | 实现 Property Hook | 解锁 `vkey` 类派生字段追踪——自动逆向精度提升的关键瓶颈 |
| **P0** | `ToolExecutor` 添加超时 + 调用 `ToolRateLimiter.check()` | 基本运行时安全防护，防止工具挂起和过载 |
| **P1** | `FunctionRanker` 增加运行时覆盖率加权 | 显著提升混淆代码场景下的候选发现率 |
| **P1** | 将 Watch/XHR/Event/Blackbox 迁入 V2 + 新增 `analyze.deobfuscate` 入口 | 弥合 V2 默认面缺口，暴露已有底层能力 |
| **P2** | Hook 验证增加自动候选遍历循环 | 向全自动逆向闭环迈进 |

---

> **总体评价**: 项目已从"传统平铺逆向工具集"演进为"面向 Agent 的工作流化 MCP 平台"，架构、工程化和分析能力均有实质升级。下一步优化的重点不是推翻当前设计，而是在保持 V2 平台化优势的前提下，**补齐关键缺失能力（Property Hook、运行时信号）、完整承接 Legacy 高价值能力到 V2、并加固运行时稳定性基础**。
