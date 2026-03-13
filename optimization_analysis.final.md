# JSHook Reverse Tool 优化分析（基于当前代码证据的修订版）

> 面向当前工作区项目的优化审阅与路线建议。本文重点基于仓库内可直接核实的代码、配置与 README 信息进行分析，并明确区分“已证实事实”“合理推断”“需外部验证事项”。

---

## 一、分析范围与证据边界

本分析主要依据以下当前工作区文件与实现：

- `README.md`
- `package.json`
- `.env.example`
- `server.json`
- `src/index.ts`
- `src/server/V2MCPServer.ts`
- `src/server/MCPServer.ts`
- `src/server/v2/ToolRegistry.ts`
- `src/server/v2/ToolExecutor.ts`
- `src/server/v2/response.ts`
- `src/server/v2/tools/createV2Tools.ts`
- `src/server/v2/runtime/ToolRuntimeContext.ts`
- `src/server/v2/runtime/SessionLifecycleManager.ts`
- `src/services/BrowserPool.ts`
- `src/modules/hook/AIHookGenerator.ts`
- `src/modules/crypto/CryptoRules.ts`
- `src/modules/stealth/StealthScripts2025.ts`
- `src/modules/captcha/CaptchaDetector.ts`

### 1.1 已证实事实

以下结论可由当前仓库直接确认：

- 当前项目入口为 `src/index.ts`，默认启动的是 `V2MCPServer`。
- 项目存在 **V2 / Legacy 双轨结构**：
  - `V2MCPServer.ts` 负责 V2 工具体系；
  - `LegacyToolBridge.ts` 包装 `MCPServer.ts` 的旧工具面；
  - `.env.example` 中 `ENABLE_LEGACY_TOOLS=false`，说明 **Legacy 默认已关闭**。
- V2 架构已经形成较清晰的职责分层：
  - `V2MCPServer`：MCP 入口与 handler 绑定；
  - `ToolRegistry`：工具注册；
  - `ToolExecutor`：工具执行；
  - `ToolRuntimeContext`：运行时上下文；
  - `SessionLifecycleManager`：会话生命周期；
  - `response.ts`：统一结构化响应与外置化。
- V2 运行时是 **Playwright-only**：README 明确写明 `ships a Playwright-only v2 runtime`，`SessionLifecycleManager.ts` 也显示 `resolveEngineChoice()` 实际返回 `playwright`。
- 项目已具备工作流化设计：README 中存在 `flow.collect-site`、`flow.find-signature-path`、`flow.trace-request`、`flow.generate-hook`、`flow.reverse-report`、`flow.resume-session`。
- 项目已具备 artifact / evidence / session 等结构化分析要素：
  - `ToolRuntimeContext.ts` 中有 `ArtifactStore`、`EvidenceStore`、`SessionLifecycleManager`；
  - `response.ts` 中 `maybeExternalize()` 会将大响应转为 artifact 引用。
- 工程化能力已有明显增强：`package.json` 中存在 `test:unit`、`test:integration`、`verify`、`verify:manifest`、`verify:skill`、`package:smoke`、`check` 等脚本；`server.json` 也已存在。
- `createV2Tools.ts` 当前体量较大，实测约 **1848 行**，存在拆分以提升可维护性的空间。
- `response.ts` 当前的内联阈值常量为 `INLINE_BYTES_LIMIT = 24 * 1024`。

### 1.2 信息不足或需外部验证的事项

以下内容当前仓库内无法直接定量确认，后续若要形成强结论，需要基于真实 MCP 客户端、真实会话和 benchmark 进行验证：

- 各工具 schema 在不同 MCP 客户端中的实际 token 注入成本；
- 系统提示、skill 提示在目标客户端中是否“每轮完整注入”；
- `mcp2cli` 在当前项目接入后的真实节省比例；
- 不同 externalize 阈值（如 24KB、8KB、4KB）对可用性与上下文成本的平衡点；
- 动态 `tools/list` 在目标 MCP 客户端中的兼容性与缓存行为。

因此，本文中涉及 token / context 成本的讨论，均应视为 **优化方向判断**，而非已被本仓库直接验证的定量事实。

## 二、证据索引表

| 关键结论 | 对应文件/模块 | 证据性质 | 备注 |
|---|---|---|---|
| 默认入口为 `V2MCPServer` | `src/index.ts` | 代码入口 | `main()` 中直接 `new V2MCPServer(config)` |
| 存在 V2 / Legacy 双轨 | `src/server/V2MCPServer.ts`、`src/server/v2/legacy/LegacyToolBridge.ts`、`src/server/MCPServer.ts` | 代码实现 | V2 通过 bridge 可挂接 Legacy 工具 |
| Legacy 默认关闭 | `.env.example` | 配置 | `ENABLE_LEGACY_TOOLS=false` |
| V2 为 Playwright-only runtime | `README.md`、`src/server/v2/runtime/SessionLifecycleManager.ts` | README + 实现 | README 明示，`resolveEngineChoice()` 实际返回 `playwright` |
| 存在注册/执行/运行时分层 | `src/server/v2/ToolRegistry.ts`、`src/server/v2/ToolExecutor.ts`、`src/server/v2/runtime/ToolRuntimeContext.ts` | 代码实现 | 已形成 V2 运行时骨架 |
| 存在 session / artifact / evidence | `src/server/v2/runtime/ToolRuntimeContext.ts`、`src/server/v2/runtime/SessionLifecycleManager.ts`、`src/server/v2/response.ts` | 代码实现 | `artifacts`、`evidence`、`maybeExternalize()` |
| 存在 `flow.*` 工作流工具 | `README.md`、`src/server/v2/tools/createV2Tools.ts` | README + 工具定义 | README 已列出主工作流入口 |
| 当前响应内联阈值为 24KB | `src/server/v2/response.ts` | 代码常量 | `INLINE_BYTES_LIMIT = 24 * 1024` |
| `createV2Tools.ts` 体量过大 | `src/server/v2/tools/createV2Tools.ts` | 实测文件规模 | 当前约 1848 行 |
| 已具备测试/验证/打包脚本 | `package.json`、`server.json` | 配置/工程脚本 | 包含 verify、manifest、package smoke |
| Legacy 中仍保留 watch/xhr/blackbox | `src/server/MCPServer.ts` | 代码实现 | 属于 Legacy 保留能力，不等于底层缺失 |
| 存在 Stealth / Captcha 相关实现 | `src/modules/stealth/StealthScripts2025.ts`、`src/modules/captcha/CaptchaDetector.ts` | 代码实现 | 代码存在，不代表已在 V2 主路径中充分暴露 |
| Hook 智能化已有增强 | `src/modules/hook/AIHookGenerator.ts` | 代码实现 | 包含 target normalize、fallback、RAG/LLM 规划 |
| 加密分析能力已增强 | `src/modules/crypto/CryptoRules.ts` | 代码实现 | 含规则体系、Web Crypto、国密、弱算法检测 |

---

## 三、当前项目已证实的优化与重构

### 3.1 架构层：从平铺工具集走向分层 V2 运行时

这是当前项目最明确、最重要的优化之一。

#### 已证实的改进点

- `V2MCPServer.ts` 相比 `MCPServer.ts` 更薄，主要负责：
  - 注册 `ListToolsRequestSchema` / `CallToolRequestSchema`
  - 创建 `ToolRegistry`
  - 创建 `ToolExecutor`
  - 初始化 `ToolRuntimeContext`
- `ToolRegistry.ts` 将工具注册从 server 主逻辑中剥离；
- `ToolExecutor.ts` 将工具执行、异常处理从 server handler 中剥离；
- `ToolRuntimeContext.ts` 统一组织：
  - `BrowserPool`
  - `WorkerService`
  - `RuntimeMonitorService`
  - `ToolRateLimiter`
  - `StorageService`
  - `SessionLifecycleManager`
  - `ArtifactStore`
  - `EvidenceStore`
  - `BundleFingerprintService`
  - `SourceMapAnalyzer`
  - `ScriptDiffService`
  - `FunctionRanker`

#### 评价

这说明当前项目的优化并非仅停留在“加几个新工具”，而是已经进入 **平台化、运行时化、组件化重构** 阶段。相较传统单文件路由或平铺工具实现，这种结构：

- 更便于测试与维护；
- 更适合后续扩展工具组；
- 更适合承接会话、证据与 artifact 的长期能力沉淀；
- 更适合 MCP / Agent 场景下的结构化响应。

### 3.2 运行时层：会话、恢复、artifact/evidence 的引入

#### 已证实的改进点

- `SessionLifecycleManager.ts` 负责：
  - `createSession()`
  - `recoverSession()`
  - `maybeUpgradeSessionEngine()`
  - `refreshSnapshot()`
  - `closeSession()` / `closeAll()`
- `BrowserPool.ts` 提供：
  - Browser / Context / Page 的复用与释放；
  - session 级 init script 管理；
  - session 级 UA / viewport 元数据管理；
  - 超出 `maxContexts` 时的淘汰策略。
- `src/server/v2/runtime/ToolRuntimeContext.ts` 中：
  - `artifacts = new ArtifactStore()`
  - `evidence = new EvidenceStore()`
- `response.ts` 中 `maybeExternalize()`：
  - 当响应超过阈值时，不直接内联完整数据，而是转为 artifact 引用。

#### 评价

这些设计说明当前项目已经开始面向“长流程逆向分析”而不是“一次命令一次返回”的短平快使用模式。其直接价值包括：

- 更适合大型站点与多轮分析；
- 更利于保留分析痕迹和中间结果；
- 更利于生成结构化报告或复盘材料；
- 更适合 Agent 自主推进复杂任务。

### 3.3 工具层：工作流优先的设计已经形成

README 中明确给出了以下工作流入口：

- `flow.collect-site`
- `flow.find-signature-path`
- `flow.trace-request`
- `flow.generate-hook`
- `flow.reverse-report`
- `flow.resume-session`

这意味着当前项目的优化方向已经从“暴露越多原子工具越好”转向：

- 用高层工作流工具承接常见逆向任务；
- 只在必要时再下钻到 `browser.*` / `inspect.*` / `debug.*` / `analyze.*` / `hook.*`。

这种设计相较纯命令式 Skill 的优势在于：

- 更适合复杂站点与复杂链路；
- 更容易形成统一报告；
- 更利于减少 Agent 在低层工具之间来回试探。

### 3.4 分析能力层：Hook / 加密 / SourceMap / 指纹分析已有增强

#### Hook 能力

`src/modules/hook/AIHookGenerator.ts` 显示当前项目的 Hook 生成已不仅是“静态模板拼接”，还包括：

- target 合法性校验；
- object path 识别与归一化；
- fallback target 选择；
- 基于 `HookRAG` 的计划构建；
- 可选 LLM 规划；
- 根据上下文自动推导条件过滤；
- 支持 function / object-method / api / property / event / custom 多种目标类型。

这说明 Hook 相关能力已经发生实质增强。

#### 加密分析能力

`src/modules/crypto/CryptoRules.ts` 显示项目包含较丰富的规则系统：

- keyword rules
- library rules
- constant rules
- pattern rules
- security rules

并覆盖：

- 常见对称 / 非对称 / 哈希算法；
- Web Crypto API；
- `sm-crypto` / `gm-crypto` 等国密生态；
- 弱算法与不安全配置检测。

#### SourceMap / 指纹 / 函数排序

当前 V2 运行时还包含：

- `SourceMapAnalyzer.ts`
- `BundleFingerprintService.ts`
- `FunctionRanker.ts`

这类能力对大型前端站点、打包产物、签名链路定位具有实际价值，说明项目已向“辅助定位与辅助理解”方向增强，而不是只停留在浏览器自动化层。

### 3.5 工程化层：测试、验证、发布准备已明显提升

`package.json` 中存在：

- `test:unit`
- `test:integration`
- `verify`
- `verify:manifest`
- `verify:skill`
- `package:smoke`
- `check`
- `prepublishOnly`

并且仓库中存在：

- `server.json`
- `.env.example`
- `README.md`

这说明项目已不再只是“本地跑通”的实验性代码，而是在朝：

- 可构建
- 可验证
- 可打包
- 可发布
- 可被 MCP 客户端识别

的方向持续优化。

---

## 四、相较命令式 Skill / CLI 方案可继续优化的点

这一部分不是说当前项目“没有能力”，而是说明：相较 `jshook-skill` 这类命令式 Skill/CLI 方案，当前项目在**交互直觉性、默认能力可见性与工具面收敛**上仍有继续优化空间。

### 4.1 当前问题之一：V2 默认工具面与 Legacy 保留能力之间存在落差

#### 已证实事实

- Legacy 中已存在：
  - `watch_*`
  - `xhr_breakpoint_*`
  - `event_breakpoint_*`
  - `blackbox_*`
- 这些能力在 `MCPServer.ts` 中可以直接看到；
- 但 `.env.example` 默认 `ENABLE_LEGACY_TOOLS=false`；
- 当前 README 对外主叙事已经切到 V2 + flow.*。

#### `jshook-skill` vs 当前 V2 逐命令覆盖对比

以下对比表基于 `jshook-skill` 的 30+ 命令，逐一检查当前 V2 默认工具面的覆盖情况：

| jshook-skill 命令 | 当前 V2 对应能力 | 覆盖状态 | 差距说明 |
|---|---|---|---|
| `collect <url>` | `flow.collect-site` | **已覆盖** | V2 参数更丰富 |
| `search "keyword"` | `inspect.scripts(action: "search")` | **已覆盖** | 支持 worker 搜索/分页，但 action enum 增加认知成本 |
| `deobfuscate <code>` | 无直接等价 V2 工具 | **缺失** | 见 4.5 反混淆差距分析 |
| `understand <code>` | 无直接等价 V2 工具 | **缺失** | jshook-skill 有 `CodeAnalyzer` + `AISummarizer` |
| `summarize code/collected` | 无直接等价 V2 工具 | **缺失** | jshook-skill 支持批量摘要 |
| `detect-crypto <code>` | `analyze.crypto`（若存在） | **部分** | `CryptoRules.ts` 有规则体系，但 V2 入口不明确 |
| `debugger enable/disable` | `debug.control(action: "enable")` | **已覆盖** | action enum 不如独立命令直觉 |
| `breakpoint set-url/set-script` | `debug.breakpoint` | **已覆盖** | -- |
| `debug-step pause/resume/into/over/out` | `debug.control` | **已覆盖** | -- |
| `debug-eval <expression>` | `debug.control(action: "evaluate")` | **已覆盖** | -- |
| `debug-vars` | `debug.control(action: "variables")` | **已覆盖** | -- |
| `watch add/list/evaluate/remove` | 仅 Legacy 中存在 | **V2 缺失** | Legacy `watch_*` 未迁入 V2 默认面 |
| `xhr-breakpoint set/list/remove` | 仅 Legacy 中存在 | **V2 缺失** | Legacy `xhr_breakpoint_*` 未迁入 V2 默认面 |
| `event-breakpoint set/list/remove` | 仅 Legacy 中存在 | **V2 缺失** | Legacy `event_breakpoint_*` 未迁入 V2 默认面 |
| `blackbox set/list/remove/set-common` | 仅 Legacy 中存在 | **V2 缺失** | Legacy `blackbox_*` 未迁入 V2 默认面 |
| `script list/get/find/search` | `inspect.scripts(action: "list/source")` | **已覆盖** | -- |
| `hook generate <type> <target>` | `flow.generate-hook` / `hook.generate` | **已覆盖（更强）** | 当前项目有 AI 生成 + RAG 模板 |
| `hook list/remove/enable/disable/clear` | `hook.*` | **已覆盖** | -- |
| `hook anti-debug` | 不确定 V2 入口 | **待确认** | -- |
| `hook-data` | `hook.data` | **已覆盖** | -- |
| `stealth inject/inject-preset/set-ua` | 通过 `flow.collect-site` 内置 | **间接覆盖** | 不如独立命令灵活，但自动化程度更高 |
| `stealth presets/status/features` | 无独立 V2 入口 | **V2 缺失** | `StealthScripts2025.ts` 有能力，缺 V2 暴露 |
| `dom query/query-all/structure/clickable/style/wait` | `inspect.dom(action: ...)` | **已覆盖** | action enum 不如独立命令清晰 |
| `page navigate/click/type/scroll/screenshot` | `browser.navigate` + `inspect.dom` | **分散覆盖** | 页面操作分散在多个工具中 |
| `browser launch/status/close` | `browser.launch/status/close` | **已覆盖** | -- |

**覆盖小结**：

- **已覆盖**：约 18 个命令（55%）
- **间接/部分覆盖**：约 6 个命令（18%）
- **V2 默认面缺失**：约 9 个命令（27%），主要集中在 Watch/XHR/Event/Blackbox 四类调试能力和反混淆/代码理解能力

#### 结论

因此，当前更准确的问题不是“项目缺少 watch / xhr-breakpoint / blackbox”，而是：

> **这些能力主要仍停留在 Legacy 面，尚未在 V2 默认工具面与工作流叙事中形成清晰、一等的入口。**

这会导致：

- 老能力仍在，但默认使用者不一定能直接接触到；
- 文档、默认暴露面、底层总代码能力之间存在落差；
- 新用户容易只看到 V2 主路径，而忽略 Legacy 中仍保留的专家级能力。

### 4.2 当前问题之二：分组工具 + action enum 的使用成本仍偏高

相较 `jshook-skill` 这类“一个命令 = 一个动作”的命令式体验，当前项目虽然在工具设计上更结构化，但也存在：

- 某些工具通过 `action` 区分多个行为；
- 需要用户或 Agent 先理解分组，再理解参数 schema；
- 高频动作的心智成本相对更高。

这并不说明当前设计错误，而是说明：

- **结构化** 与 **直觉性** 之间存在平衡；
- 对 Agent/新用户而言，仍可通过更强的路由文档、别名映射或示例调用，进一步降低门槛。

### 4.3 当前问题之三：部分代码已实现，但主路径叙事没有完全覆盖

例如：

- `StealthScripts2025.ts` 显示项目具备较完整的 stealth 注入逻辑；
- `CaptchaDetector.ts` 显示项目具备验证码检测与等待机制；
- Legacy 中也保留了较完整的动态调试辅助能力。

但这些能力在当前 V2 主 README 叙事中，不一定都以“默认主路径能力”的形式出现。因此优化重点之一应是：

- 让“默认主路径能力”与“总代码能力”之间更一致；
- 或明确区分“V2 默认面”与“Legacy 扩展面”。

### 4.4 当前问题之四：部分文件体量偏大，影响维护

当前最明显的例子是：

- `src/server/v2/tools/createV2Tools.ts` 约 1848 行。

这类文件往往意味着：

- 工具定义过于集中；
- 后续按组维护困难；
- 不利于按场景裁剪工具面；
- 不利于未来做更细的测试与职责拆分。

因此，“按工具组拆分 V2 tool 定义”是较为稳妥的中期优化项。

---

### 4.5 当前问题之五：反混淆与代码理解能力缺少 V2 一等入口

#### 与 `jshook-skill` 的差距

`jshook-skill` 在反混淆方向有 **5 个独立模块**：

| 模块 | 功能 | 当前项目对标 |
|---|---|---|
| `Deobfuscator.ts` | 基础反混淆 | 无直接 V2 入口 |
| `AdvancedDeobfuscator.ts` | 高级模式反混淆 | 无直接 V2 入口 |
| `ASTOptimizer.ts` | AST 层级优化 | 无对应模块 |
| `JSVMPDeobfuscator.ts` | JSVMP 虚拟机保护破解 | 当前项目无此能力 |
| `PackerDeobfuscator.ts` | Packer 解包 | 当前项目无此能力 |

此外，`jshook-skill` 还有：

- `CodeAnalyzer.ts` — 代码结构分析
- `AISummarizer.ts` — AI 驱动的代码摘要（支持批量摘要 `summarize collected --batch`）

#### 评价

当前项目在 Hook 生成、加密检测方面已超越 `jshook-skill`，但在“拿到一段混淆代码 → 还原 → 理解”这条链路上，`jshook-skill` 的专项能力更丰富。尤其是 JSVMP 和 Packer 这两类常见保护方案的专用破解器，在前端逆向实战中有较高价值。

#### 建议

- **短期**：可在 V2 工具面中新增 `analyze.deobfuscate` 入口，封装现有 LLM 能力进行基础反混淆；
- **中期**：评估是否引入 AST 层级的反混淆能力（如 Babel transform pipeline）；
- **长期**：评估 JSVMP / Packer 专用破解器的投入产出比（这类能力开发成本较高，但实战价值显著）。

> 需注意：反混淆能力的开发投入较大，且效果高度依赖具体混淆方案。建议在有明确的目标站点需求后再决定优先级。

---

### 4.5 当前问题之五：反混淆与代码理解能力缺少 V2 一等入口

#### 与 `jshook-skill` 的差距

`jshook-skill` 在反混淆方向有 **5 个独立模块**：

| 模块 | 功能 | 当前项目对标 |
|---|---|---|
| `Deobfuscator.ts` | 基础反混淆 | 无直接 V2 入口 |
| `AdvancedDeobfuscator.ts` | 高级模式反混淆 | 无直接 V2 入口 |
| `ASTOptimizer.ts` | AST 层级优化 | 无对应模块 |
| `JSVMPDeobfuscator.ts` | JSVMP 虚拟机保护破解 | 当前项目无此能力 |
| `PackerDeobfuscator.ts` | Packer 解包 | 当前项目无此能力 |

此外，`jshook-skill` 还有：

- `CodeAnalyzer.ts` — 代码结构分析
- `AISummarizer.ts` — AI 驱动的代码摘要（支持批量摘要 `summarize collected --batch`）

#### 评价

当前项目在 Hook 生成、加密检测方面已超越 `jshook-skill`，但在“拿到一段混淆代码 → 还原 → 理解”这条链路上，`jshook-skill` 的专项能力更丰富。尤其是 JSVMP 和 Packer 这两类常见保护方案的专用破解器，在前端逆向实战中有较高价值。

#### 建议

- **短期**：可在 V2 工具面中新增 `analyze.deobfuscate` 入口，封装现有 LLM 能力进行基础反混淆；
- **中期**：评估是否引入 AST 层级的反混淆能力（如 Babel transform pipeline）；
- **长期**：评估 JSVMP / Packer 专用破解器的投入产出比（这类能力开发成本较高，但实战价值显著）。

> 需注意：反混淆能力的开发投入较大，且效果高度依赖具体混淆方案。建议在有明确的目标站点需求后再决定优先级。

---

## 五、Token / 上下文与工具暴露问题（估算性质）

### 5.1 已证实的事实

以下事实可直接由仓库确认：

- 当前项目工具面分为：
  - V2 工具；
  - 可选 Legacy 工具；
- `ToolRegistry.ts` 会将注册后的工具全部暴露给 `ListToolsRequestSchema`；
- `response.ts` 使用 `INLINE_BYTES_LIMIT = 24 * 1024` 作为内联阈值；
- 大型脚本、网络详情、DOM 结构等天然存在返回体较大的风险；
- README 中强调工作流工具优先、专家工具其次，说明项目本身也意识到工具面与上下文成本之间的平衡问题。

### 5.2 合理推断

基于以上事实，可以较有把握地推断：

- 当暴露工具数量较多时，MCP 客户端侧的工具选择与上下文成本通常会上升；
- 当工具返回过大的源码、网络详情、DOM 结构时，会加重会话上下文负担；
- 对大型站点或长会话来说，工具面收敛、响应摘要化、artifact 外置化是有价值的优化方向。

### 5.3 需要避免的误区

当前没有足够仓库内证据支持以下强结论：

- “每轮一定额外消耗多少 token”；
- “某个工具面设计一定能节省百分之多少 token”；
- “20 轮会话一定能降到某个确定区间”。

因此，在正式文档中更稳妥的写法应是：

- 使用“可能”“通常”“值得优化”“需实测验证”等措辞；
- 若给出数字，必须标注为 **粗略估算**，并说明依赖具体客户端。

### 5.4 当前更合理的优化方向

结合当前仓库状态，更合理的优化方向是：

1. **进一步明确默认工具面**
   - 不是因为 Legacy 默认没关，而是因为仍需进一步减少“能力存在但默认不可见/不直观”的认知负担。
2. **强化响应摘要与 artifact 外置化策略**
   - 当前已存在 `maybeExternalize()`，但是否要进一步调低阈值，需要 benchmark 决策。
3. **优先引导使用 `flow.*` 完成高频任务**
   - 这比一开始就暴露大量原子工具更符合当前架构方向。
4. **为高频动作补充更直观的路由文档或别名层**
   - 这一点更适合在 Skill/文档层做，而非直接破坏 MCP 工具语义。

---

## 六、`mcp2cli` 的适用性与边界

### 6.1 `mcp2cli` 的 Token 节省核心机制

`mcp2cli` 把任意 MCP Server 的工具暴露为 CLI 子命令，其 token 节省的核心原理可概括为：

```
原生 MCP 模式：
  每轮成本 = ~121 tokens/tool × N 个工具 × 每轮
  → 累计成本 = O(N × turns)，工具数与轮次双重放大
  → 27 个工具 × 10 轮 ≈ 36,000+ tokens（仅 schema 注入）

mcp2cli 模式：
  每轮成本 = ~67 tokens（固定 CLI 指令提示）
  一次性成本 = ~464 tokens（--list 发现，仅首轮）
  按需成本 = ~120 tokens/tool（--help，仅首次使用该工具时）
  → 累计成本 = O(turns + used_tools)，仅与实际使用的工具数线性相关
  → 27 个工具 × 10 轮，实际使用 4 个 ≈ 1,734 tokens
```

**关键差异**：原生 MCP 的 schema 注入成本与“工具总数 × 轮次”成正比；`mcp2cli` 的成本仅与“轮次 + 实际使用工具数”线性相关。这解释了为什么在工具数多、会话轮次长的场景下，差距会被急剧放大。

`mcp2cli` 官方仓库给出了基于 `cl100k_base` tokenizer 的实测数据（非估算）：

| 场景 | 原生 MCP tokens | mcp2cli tokens | 节省率 |
|---|---|---|---|
| 30 工具 × 10 轮，使用 4 个工具 | 36,310 | 1,734 | 95.2% |
| 120 工具 × 25 轮 | — | — | 约 357,169 tokens saved |
| 3 个 Server / 60 工具 × 20 轮 | 145,060 | 3,288 | 97.7% |

> 需注意：以上数字来自 `mcp2cli` 官方测试，基于特定的 schema 规模和使用模式。当前项目的实际节省比例需通过 benchmark 验证。

### 6.2 可以成立的判断

从原理上看，`mcp2cli` 这类 MCP → CLI 代理方案，确实可能带来以下收益：

- 把原本通过 MCP tool schema 暴露的能力转为 shell / subcommand 形式调用；
- 在某些 Agent 或 CLI 环境中，降低工具描述带来的额外上下文成本；
- 让某些不方便直接接 MCP 的环境也能间接使用能力。

因此，把 `mcp2cli` 视为一种 **外部适配层** 是合理的。

### 6.3 不能直接下强结论的部分

当前仓库内没有直接证据证明：

- 接入 `mcp2cli` 后一定能达到某个明确节省比例；
- 它对所有目标客户端都比原生 MCP 更优；
- 它会天然改善所有上下文问题。

尤其需要注意：

- `mcp2cli` 解决的是“工具暴露方式”的一部分问题；
- 它并不能自动解决“单次工具返回值过大”的问题；
- 它也不能替代当前项目的 session / artifact / evidence 等结构化能力。

### 6.4 `mcp2cli` 的 TOON 输出格式

`mcp2cli` 提供了一个值得关注的附加特性：**TOON（Token-Optimized Object Notation）输出格式**。

```bash
mcp2cli --mcp https://example.com/sse --toon list-tags
```

TOON 是一种针对 LLM 消费场景优化的编码格式，对大型均匀数组（如脚本列表、网络请求列表）可节省 **40-60% 的 tokens**。

这与当前项目第五节讨论的“响应摘要化策略”直接相关：即使不引入 `mcp2cli`，TOON 的设计思路——对重复结构的数据使用更紧凑的序列化格式——也值得在 `response.ts` 的响应格式化中借鉴。例如：

- `inspect.scripts(action: "list")` 返回的脚本元数据列表
- `inspect.network` 返回的请求记录列表
- `hook.list` 返回的 Hook 列表

这些场景下，JSON 的冗余键名会显著膨胀 token 数。可考虑在 `response.ts` 中增加可选的紧凑序列化模式。

### 6.5 更稳妥的定位

因此，更稳妥的结论是：

> `mcp2cli` 值得作为特定场景下的外部调用层进行评估，但不应被视为替代当前 MCP 架构的主方案。当前项目更优先的优化仍然是：工具面收敛、响应裁剪、工作流优先、文档路由优化与 V2 能力补齐。
>
> 同时，`mcp2cli` 的两个设计思路——按需发现（`--list` / `--help` 延迟加载）与紧凑序列化（TOON）——可作为当前项目内部优化的参考方向，即使不直接引入 `mcp2cli` 作为外部依赖。
>

---

## 七、建议的优化优先级

以下优先级排序以“当前仓库已证实问题 + 实施性价比”综合判断。

### 7.1 建议优先级摘要表

| 优先级阶段 | 建议项 | 主要目标 | 涉及模块 | 风险/备注 |
|---|---|---|---|---|
| 立即可做 | 明确 V2 默认能力与 Legacy 保留能力边界 | 降低认知混乱，避免误判 | `README.md`、设计文档、使用说明 | 不涉及底层改动，低风险 |
| 立即可做 | 为高频动作补充“场景 → 工具”路由说明 | 降低 grouped tools 使用门槛 | `README.md`、后续 skill 文档 | 当前工作区未见完整 skill 文档，需先确认文件位置 |
| 立即可做 | 为 `response.ts` 阈值补充说明与 benchmark 计划 | 避免拍脑袋调整 externalize 阈值 | `src/server/v2/response.ts`、设计文档 | 建议先测再改 |
| 中期演进 | 将 Watch/XHR breakpoint/Blackbox 等高价值能力迁入 V2 | 弥合 Legacy 与 V2 默认能力面差距 | `createV2Tools.ts`、V2 debug 工具层、底层调试模块 | 不是补底层缺失，而是补默认入口 |
| 中期演进 | 拆分 `createV2Tools.ts` | 提升可维护性、便于后续裁剪工具面 | `src/server/v2/tools/` | 低到中风险，偏重构 |
| 中期演进 | 建立统一摘要化响应策略 | 降低高体量返回带来的上下文压力 | `response.ts`、相关 V2 handler | 需兼顾可读性与完整数据获取 |
| 长期演进 | 基于真实客户端做 token/context benchmark | 将经验判断升级为可复现实测结论 | MCP 客户端接入层、典型逆向样例 | 依赖外部运行环境 |
| 长期演进 | 评估动态 `tools/list`、新手/专家模式与 `mcp2cli` | 优化工具暴露方式与跨环境适配 | `V2MCPServer.ts`、`ToolRegistry.ts`、外部调用层 | 需验证客户端兼容性 |

### 7.2 立即可做（低风险、高收益）

#### A. 明确区分 V2 默认能力与 Legacy 保留能力

| 维度 | 说明 |
|---|---|
| **涉及文件** | `README.md`、`skills/jshook-reverse-operator/SKILL.md`（或新建 `docs/v2-vs-legacy.md`） |
| **具体操作** | 基于 4.1 节逐命令对比表，在文档中新增“V2 默认能力 / Legacy 保留能力 / 迁移计划”三栏表 |
| **预估工时** | 1-2 小时 |

建议：

- 在 README 或独立设计文档中补充一节：
  - 哪些能力属于 V2 默认主路径（约 18 个命令等价）；
  - 哪些能力仍保留在 Legacy 中（Watch / XHR / Event / Blackbox 四类）；
  - 在什么场景下需要开启 Legacy（`ENABLE_LEGACY_TOOLS=true`）。

价值：

- 降低认知混乱；
- 避免“代码里有但默认看不到”带来的误判；
- 比“简单关闭 Legacy”更贴近当前现状。

#### B. 为高频动作补充更直观的路由说明

| 维度 | 说明 |
|---|---|
| **涉及文件** | `skills/jshook-reverse-operator/SKILL.md`、`skills/jshook-reverse-operator/references/tool-routing.md` |
| **具体操作** | 新增“场景 → 工具”映射表，覆盖以下高频场景 |
| **预估工时** | 2-3 小时 |

建议映射表示例（可嵌入 Skill 文档）：

| 用户意图 / 场景 | 推荐工具调用 |
|---|---|
| 首次站点侦察 | `flow.collect-site(url: URL)` |
| 搜索关键词 | `inspect.scripts(action: "search", keyword: KEYWORD)` |
| 查看脚本列表 | `inspect.scripts(action: "list")` |
| 获取脚本源码 | `inspect.scripts(action: "source", scriptId: X)` |
| 定位签名/加密路径 | `flow.find-signature-path()` |
| 跟踪请求链路 | `flow.trace-request(urlPattern: PATTERN)` |
| 生成 Hook | `flow.generate-hook(description: DESC, autoInject: true)` |
| 查看 Hook 捕获数据 | `hook.data(hookId: ID)` |
| 启用/禁用调试 | `debug.control(action: "enable/disable")` |
| 设断点 | `debug.breakpoint(action: "set", url: URL, line: LINE)` |
| 生成逆向报告 | `flow.reverse-report(focus: "overview")` |
| 恢复已有会话 | `flow.resume-session(sessionId: SID)` |

价值：

- 降低 V2 grouped tools 的使用门槛；
- 提升 Agent 与人工使用的一致性；
- Agent 可直接从映射表选择工具，而无需在 27 个工具中逐一搜索。

#### C. 为 `response.ts` 增加阈值说明与 benchmark 计划

| 维度 | 说明 |
|---|---|
| **涉及文件** | `src/server/v2/response.ts`（代码注释）、设计文档（benchmark 计划） |
| **具体操作** | ① 在 `INLINE_BYTES_LIMIT = 24 * 1024` 处添加设计依据注释；② 编写 benchmark 计划文档 |
| **预估工时** | 1-2 小时（文档）+ 后续 benchmark 执行时间 |

建议：

- 不急于直接将 `INLINE_BYTES_LIMIT` 改到某个更小值；
- 先在 `response.ts` 中以注释形式记录当前 24KB 的设计依据；
- 增加 benchmark 计划，用真实会话验证 24KB / 8KB / 4KB 的差异：
  - 指标：单次响应 token 数、Agent 可用性（是否需要额外调用获取完整数据）、artifact 引用频率
  - 样本：选取 3-5 个典型逆向场景（大站点脚本源码、网络详情、DOM 结构）

价值：

- 避免拍脑袋改阈值；
- 让后续优化更可验证。

### 7.3 中期演进（需一定实现工作）

#### D. 将 Legacy 中高价值专家能力有选择地迁入 V2

优先级较高的候选：

- Watch 表达式
- XHR breakpoint
- Blackbox

注意：

- 这里不是补“底层缺失”，而是补“V2 默认面缺口”；
- 应尽量以 V2 当前的 grouped / workflow 风格暴露，而不是简单复制 Legacy 命名。

#### E. 拆分 `createV2Tools.ts`

建议按 group 拆分，例如：

- `browser-tools.ts`
- `inspect-tools.ts`
- `debug-tools.ts`
- `analyze-tools.ts`
- `hook-tools.ts`
- `flow-tools.ts`

价值：

- 提升可维护性；
- 降低后续新增/迁移工具时的复杂度；
- 更利于后续做工具面裁剪或条件暴露。

#### F. 对高体量响应做更清晰的摘要化策略

建议：

- 对脚本源码、网络记录、DOM 结构等建立统一摘要返回模型；
- 保持 artifact 外置化作为完整数据获取手段；
- 减少一次响应返回过多原始内容的情况。

### 7.4 长期演进（偏架构/生态）

#### G. 基于真实客户端做 token / context benchmark

建议围绕以下维度做实测：

- Claude / Codex / 其他 MCP 客户端
- 仅 V2 / V2+Legacy
- 不同 externalize 阈值
- 大站点与中小站点
- `flow.*` 主路径 vs 原子工具路径

目标：

- 把当前“经验判断”升级为“可复现实测结论”。

#### H. 评估动态 `tools/list` 与外部适配层

包括但不限于：

- 动态工具列表；
- 新手/专家模式；
- `mcp2cli` 作为外部桥接；
- 与 Skill/CLI 的组合方式。

这类工作更适合在完成 benchmark 之后推进。

---

## 八、风险与注意事项

### 8.1 不要把 Legacy 能力“默认关闭”误写成“项目已经去除了 Legacy 问题”

当前事实是：

- Legacy 默认关闭；
- 但代码仍存在，且部分高价值专家能力仍主要停留在 Legacy。

因此，真正的问题是：

- 能力迁移是否完成；
- 文档与默认路径是否清晰；
- 是否需要进一步收敛而非仅配置关闭。

### 8.2 不要把 CLI/Skill 的交互优势误判为底层能力优势

命令式 Skill 的优势主要在：

- 交互更直观；
- 高频动作心智成本更低；
- 在 Claude Code 这类环境中更贴近用户操作方式。

但这并不等于其底层能力一定比当前项目更强。当前项目在：

- 会话管理
- 结构化响应
- artifact/evidence
- 工作流工具
- 工程化验证

方面，已经表现出更强的平台属性。

### 8.3 不要在未实测前写死 token 节省收益

如果后续文档或 PR 说明中需要出现数字，应统一注明：

- “粗略估算”；
- “依赖客户端实现”；
- “需 benchmark 验证”。

### 8.4 不要把 Playwright-only V2 误写成多引擎系统

当前仓库证据显示：

- V2 是 Playwright-only runtime；
- 即使存在 engine choice 相关代码结构，也不能据此把现状写成“多引擎成熟支持”。

---

## 九、最终结论

基于当前工作区代码与文档证据，可以得出以下结论：

1. **当前项目已经完成了实质性的系统化优化，而非只做了表层交互调整。**
   这些优化集中体现在：
   - V2 / Legacy 双轨结构；
   - `V2MCPServer` / `ToolRegistry` / `ToolExecutor` / `ToolRuntimeContext` 的分层；
   - 会话生命周期、artifact、evidence、browser pool 的引入；
   - `flow.*` 工作流工具；
   - 测试、验证、manifest、打包等工程化提升。

2. **当前项目仍有清晰的下一阶段优化空间，但重点不应再简单表述为“关闭 Legacy”。**
   因为 Legacy 默认已关闭，真正应优化的是：
   - 默认能力面与总代码能力之间的清晰映射；
   - V2 对高价值专家能力的承接；
   - 高体量响应的摘要化与 artifact 化；
   - 文档/skill 层的高频动作路由。

3. **关于 token / context / `mcp2cli` 的讨论，当前更适合作为方向性判断，而非定量结论。**
   这些方向值得继续推进，但必须通过真实客户端和真实逆向任务进行 benchmark 才能形成可信结论。

综合来看，当前项目的优化状态可以概括为：

> 项目已经从“传统平铺逆向工具集”演进为“面向 Agent 的工作流化 MCP 平台”，并具备明显的架构、工程化和分析能力升级；下一步优化的重点，不是推翻当前设计，而是在保持 V2 平台化优势的前提下，继续收敛默认工具面、补齐 V2 默认入口、优化高频交互路径，并用实测数据验证上下文成本优化策略。

---

## 附录：适合 README / 设计说明 / 汇报材料的精简摘要版

- 当前项目默认入口已切换到 `V2MCPServer`，并形成了 **默认 V2、可选 Legacy** 的双层结构。
- 相比传统平铺工具集，项目已完成明显的 **平台化重构**：引入 `ToolRegistry`、`ToolExecutor`、`ToolRuntimeContext`、`SessionLifecycleManager` 等分层组件。
- 当前 V2 已具备面向长流程逆向分析的基础设施：`sessionId`、`artifactId`、`evidenceId`、`BrowserPool`、结构化响应与 artifact 外置化。
- README 中已建立 `flow.collect-site`、`flow.find-signature-path`、`flow.trace-request`、`flow.generate-hook`、`flow.reverse-report` 等工作流入口，说明项目已从“原子工具优先”转向“工作流优先”。
- 项目在 Hook、加密分析、SourceMap、Bundle 指纹、函数排序等方向已有实质增强，证明优化不只是交互层改造。
- 工程化方面已具备测试、验证、manifest、package smoke 等脚本，项目已具备面向发布与持续维护的基础。
- 当前的主要问题不是“是否还有 Legacy”，而是 **默认能力面、总代码能力与文档叙事之间仍存在落差**。
- 下一阶段优化重点应放在：明确 V2 / Legacy 能力映射、将高价值专家能力逐步迁入 V2、完善高频动作路由文档、优化高体量响应摘要策略。
- 关于 token / context / `mcp2cli` 的讨论，当前更适合作为方向性判断；若要形成强结论，应基于真实 MCP 客户端和典型逆向任务做 benchmark。

