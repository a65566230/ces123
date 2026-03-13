# JSHook Reverse Tool — 综合交叉核对审核（基于当前工作区快照）

> 本文用于替代基于旧快照形成的“系统性问题分析”版本。审核对象为桌面版 `C:\Users\Administrator\Desktop\comprehensive_project_analysis.md`，判断基准严格限定为**当前工作区的实际实现**。  
> 证据优先级：**代码与工具注册事实 > 配置与清单文件 > README > 当前工作区内其他正式分析文档**。

---

## 1. 文档概述

目标文档并非完全失真。它抓住了一批当前仍然成立的重要问题，例如：

- `src/` 中存在大量带 `@ts-nocheck` 和 `sourceMappingURL` 的 `.ts` 文件；
- `FunctionRanker` 仍然主要依赖短代码预览的静态关键词打分；
- Property Hook / Event Hook 仍未完整实现；
- `ToolExecutor` 缺少统一的超时与取消层；
- V2 / Legacy 双轨仍然带来维护负担。

但该文档的核心缺陷也很明显：

- 对 **V2 当前工具面** 的认知明显滞后；
- 多处把 **expert surface / core surface / legacy alias** 混写为“V2 缺失”；
- 把部分“旧问题”写成了“当前仍成立的事实”；
- 把本地工作区现象误写成了仓库提交事实；
- 遗漏了当前 V2 架构中非常关键的 `artifact/evidence`、`flow.reverse-report`、`flow.resume-session`、`browser.recover`、`responseMode="compact"` 等机制。

**总体判断**：目标文档可作为“历史问题草稿”参考，但**不能直接代表当前工作区的真实现状**。

---

## 2. 当前工作区事实基线

以下内容已由当前工作区直接证实：

- 默认入口是 `src/index.ts`，启动的是 `V2MCPServer`，而不是 Legacy `MCPServer`。
- V2 已形成分层运行时骨架：`V2MCPServer`、`ToolRegistry`、`ToolExecutor`、`ToolRuntimeContext`、`SessionLifecycleManager`。
- V2 当前不仅有 `browser.*` / `inspect.*` / `flow.*`，也已经公开了大量 expert 工具：
  - `debug.watch`
  - `debug.xhr`
  - `debug.event`
  - `debug.blackbox`
  - `inspect.function-trace`
  - `inspect.interceptor`
  - `analyze.understand`
  - `analyze.coverage`
  - `analyze.obfuscation`
  - `analyze.deobfuscate`
  - `browser.storage`
  - `browser.capture`
  - `browser.interact`
  - `browser.stealth`
  - `browser.captcha`
- README 已明确区分三类 surface：
  - `JSHOOK_TOOL_PROFILE=expert`
  - `JSHOOK_TOOL_PROFILE=core`
  - `JSHOOK_TOOL_PROFILE=legacy` / `ENABLE_LEGACY_TOOLS=true`
- V2 当前已具备结构化响应 envelope、`artifactId` / `detailId` / `evidenceIds`、artifact 外置化与 evidence 存储。

主要证据位置：

- `src/index.ts`
- `src/server/V2MCPServer.ts`
- `src/server/v2/runtime/runtimeOptions.ts`
- `src/server/v2/response.ts`
- `src/server/v2/tools/browserBlueprints.ts`
- `src/server/v2/tools/debugBlueprints.ts`
- `src/server/v2/tools/inspectBlueprints.ts`
- `src/server/v2/tools/analyzeBlueprints.ts`
- `src/server/v2/tools/flowBlueprints.ts`
- `README.md`
- `.env.example`

---

## 3. 正确的判断

### 3.1 源码状态与工程质量

以下判断当前仍然成立：

1. **`src/` 中存在大量“看起来像回写编译产物”的 `.ts` 文件**
   - 当前 `src` 下共扫描到 116 个 `.ts` 文件，其中 97 个包含 `@ts-nocheck`，67 个同时包含 `sourceMappingURL`。
   - 典型文件包括：
     - `src/server/v2/ToolExecutor.ts`
     - `src/server/v2/tools/createV2Tools.ts`
     - `src/server/v2/runtime/SessionLifecycleManager.ts`
     - `src/server/v2/analysis/FunctionRanker.ts`
   - 这会显著削弱 `tsconfig.json` 中 `strict`、`noUnusedLocals`、`noUnusedParameters` 等配置的实际收益。

2. **ESLint 关键规则被关闭**
   - `eslint.config.mjs` 中关闭了：
     - `@typescript-eslint/ban-ts-comment`
     - `@typescript-eslint/no-explicit-any`
     - `@typescript-eslint/no-this-alias`
     - `@typescript-eslint/no-unsafe-function-type`
     - `@typescript-eslint/no-unused-vars`

3. **存在重复类型声明**
   - `src/types/index.ts` 中 `HookCondition` 被声明了两次。

4. **存在大型文件与职责堆叠**
   - 当前仍可直接确认的高体量文件包括：
     - `src/server/v2/tools/flowBlueprints.ts`
     - `src/server/v2/tools/createV2Tools.ts`
     - `src/services/LLMService.ts`
     - `src/services/StorageService.ts`
     - `src/server/MCPServer.ts`

### 3.2 运行时与稳定性

以下问题当前仍然成立：

1. **`ToolExecutor` 缺少统一超时 / 取消层**
   - `src/server/v2/ToolExecutor.ts` 中的执行路径只是等待 `runtime.ready` 后直接调用 descriptor handler。
   - 当前未见统一 `AbortController`、统一 `Promise.race` 超时封装或统一取消协议。

2. **浏览器与 CDP 断连的自动恢复机制仍不充分**
   - `src/services/BrowserPool.ts` 中未见浏览器 `disconnected` 事件监听；
   - `src/modules/debugger/DebuggerManager.ts` 可见 CDP 会话创建与 `waitForPaused()`，但当前未见自动断连重建逻辑；
   - `BrowserPool` 关闭 page/context 时存在吞错路径，如 `page.close().catch(() => undefined)`。

3. **LRU 风格驱逐仍然过于粗糙**
   - `BrowserPool` 达到 `maxContexts` 后会按 `lastUsedAt` 选择最老 session 关闭；
   - 当前未看到“是否存在活跃调试状态/断点/Hook”的更细粒度保护条件。

### 3.3 自动逆向与 Hook 能力

以下问题当前仍然成立：

1. **`FunctionRanker` 仍然偏静态、偏关键词**
   - `src/server/v2/analysis/FunctionRanker.ts` 仍只对函数代码前 240 字符做关键词匹配；
   - 打分仍以 `sign / signature / token / nonce / timestamp / crypto / encrypt / decrypt / fetch / xmlhttprequest` 等关键词为主。

2. **Property Hook / Event Hook 仍为 stub**
   - `src/modules/hook/AIHookGenerator.ts` 中对应生成函数仍直接返回 `not yet implemented`。

3. **LLM Hook 规划链路仍偏脆弱**
   - 仍采用正则截取 JSON + `JSON.parse(...)`；
   - 失败后存在静默吞错分支。

4. **Hook 主流程虽已增强，但仍未形成“完全自动收敛”的闭环**
   - 当前 `flow.generate-hook` 已支持候选尝试与验证；
   - 但默认路径下仍不是对所有候选进行完全自动穷举，也未证明对复杂派生字段形成稳定自动收敛。

### 3.4 V2 / Legacy 架构层

以下判断当前仍然成立：

1. **Legacy 并未退出仓库，只是退居兼容层**
   - `src/server/V2MCPServer.ts` 仍会按配置挂载 `LegacyToolBridge`；
   - `src/server/MCPServer.ts` 仍是完整 Legacy 服务面；
   - `src/server/v2/legacy/LegacyToolBridge.ts` 仍保留 bridge 逻辑。

2. **双轨维护成本仍然存在**
   - 当前仓库既维护 grouped v2 surface，又维护 legacy flat aliases；
   - README 也明确说明 legacy 仍可通过配置启用。

---

## 4. 基本合理但表述不够严谨的判断

### 4.1 “V2 主路径迁移未完成”

这个方向**部分成立**，但原文表述过头。

更准确的说法应为：

- V2 **架构主路径** 已经建立；
- V2 **expert tool surface** 已显著扩张；
- 当前真正未完全完成的是：
  - workflow 与 expert tools 的联动深度；
  - 自动验证闭环；
  - Legacy alias 的安全收缩时机；
  - `core` profile 与 `expert` profile 的认知边界文档化。

因此，不应再笼统写成“V2 主路径未为 Watch/XHR/Event/Blackbox 创建一等入口”。

### 4.2 “自动逆向主要依赖静态分析”

这个判断**有一部分成立**，但不能再写成“完全依赖静态分析”。

当前 `flow.find-signature-path` 已经引入了：

- coverage evidence boost
- hook evidence boost
- exception-derived candidates
- paused-state-derived candidates
- `inspect.function-trace` / `inspect.interceptor` / `debug.blackbox` / `debug.watch` 推荐链

因此更准确的表述应是：

> 当前候选发现仍以静态脚本扫描与关键词命中为主，运行时信号已经开始介入，但整体权重与闭环强度仍不足。

### 4.3 “Hook 验证闭环不完整”

这个判断方向正确，但要修正为：

- 当前并非“完全没有自动尝试”；
- `flow.generate-hook` 在显式候选/显式 target 场景下，已经存在候选尝试与 runtime validation；
- 但还不能证明它已对默认复杂场景形成充分自动收敛。

### 4.4 “浏览器无恢复能力”

应改为：

- 当前**缺自动崩溃检测与自动恢复**；
- 但项目并非完全没有恢复模型。

当前已存在：

- `browser.recover`
- session `health`
- `recoverable`
- `recoveryCount`
- `lastFailure`

这些都说明系统已有手动恢复与健康状态表达。

---

## 5. 不准确或与当前项目不符的内容

以下内容应明确判定为**不准确、过时，或与当前代码不符**。

### 5.1 把多个 expert 工具误写为“仅 Legacy 存在”

原文将以下能力写成“仅 Legacy 中存在”或“V2 默认面缺失”：

- `debug.watch`
- `debug.xhr`
- `debug.event`
- `debug.blackbox`
- `inspect.function-trace`
- `inspect.interceptor`
- `analyze.understand`
- `analyze.coverage`
- `analyze.deobfuscate`
- `browser.storage`
- `browser.capture`
- `browser.interact`
- `browser.stealth`
- `browser.captcha`

这些说法均与当前代码不符。以上工具当前都已经在 V2 中注册，只是部分被归类为 `expert` / `legacy` profile，而不是 `core` profile。

主要证据：

- `src/server/v2/tools/debugBlueprints.ts`
- `src/server/v2/tools/inspectBlueprints.ts`
- `src/server/v2/tools/analyzeBlueprints.ts`
- `src/server/v2/tools/browserBlueprints.ts`
- `README.md`

### 5.2 把 profile 差异误写成“V2 缺失”

原文忽略了：

- `expert`
- `core`
- `legacy`

三类 surface 的差异。

当前真实情况是：

- 默认 `.env.example` 为 `JSHOOK_TOOL_PROFILE=expert`；
- `core` profile 会隐藏大量专家工具；
- `legacy` profile 或 `ENABLE_LEGACY_TOOLS=true` 会额外暴露 flat aliases。

因此，“默认不可见”不等于“V2 不存在”，更不等于“只能通过 Legacy 使用”。

### 5.3 “`ToolRateLimiter.check()` 从未被调用”

此结论当前**错误**。

当前 `src/server/v2/tools/createV2Tools.ts` 中有统一 helper：

- `enforceRateLimit(runtime, sessionId, toolName)`

其内部会调用：

- `runtime.toolRateLimiter.check(...)`

当前至少可直接确认在以下路径生效：

- `inspect.scripts(action: 'search')`
- `inspect.network`

更准确的批评应为：

> 速率限制器尚未成为统一执行层的全局强制能力，目前仅在部分高成本工具路径使用。

### 5.4 “`.env` 中硬编码 API Key 已提交仓库”

此结论当前**不能成立**。

当前能确认的是：

- 工作区本地存在 `.env`；
- 但 `.gitignore` 明确忽略 `.env`、`.env.local`、`.env.*.local`；
- git 跟踪状态下 `.env` 并未被纳入版本控制。

因此更准确的说法只能是：

> 本地工作区存在 `.env` 文件，若其中含敏感信息则存在本地泄漏风险；但当前无法据此得出“已提交到仓库”的结论。

### 5.5 “`StorageService.init()` 未自动调用”

此结论当前也不准确。

当前可确认的初始化路径包括：

- V2：`ToolRuntimeContext.ready = this.storage.init().then(...)`
- Legacy bridge：`LegacyToolBridge.init()` 中调用 `surface.storage.init()`
- Legacy server 启动路径中也存在 `this.storage.init()`

因此，这个问题不能再写成“系统性缺陷”。

### 5.6 “覆盖率路径不清晰 / 未被 flow 消费”

此结论已过时。

当前 `flow.find-signature-path` 已明确读取 `coverage-analysis` evidence，并生成 `coverageByScriptId` / `coverageByUrl` boost map。

因此更准确的说法应是：

> 覆盖率信号已经接入，但权重设计与真实命中收益仍需进一步验证。

---

## 6. 文档遗漏的重要点

目标文档遗漏了以下当前项目的关键能力与边界：

### 6.1 V2 的结构化响应与证据模型

当前 V2 的重要差异不只是 grouped tools，而是：

- 结构化 envelope：`ok` / `summary` / `data` / `detailId` / `evidenceIds` / `nextActions`
- artifact 外置化
- evidence store
- `inspect.artifact`
- `inspect.evidence`

这是当前项目从“原子工具集”向“可追踪 workflow 平台”转型的核心。

### 6.2 工作流层的新增能力

目标文档没有充分强调以下 V2 新能力：

- `flow.reverse-report`
- `flow.resume-session`
- `browser.recover`

这三项对于“长流程逆向会话”非常关键，不能在现状审计中缺席。

### 6.3 profile 模型

目标文档遗漏了当前理解 V2 的关键边界：

- `expert` 是默认完整 surface；
- `core` 是 workflow-first surface；
- `legacy` 是兼容面；
- “代码存在但未暴露为默认 V2 一等入口”与“只在 core 中隐藏”是两回事。

### 6.4 response shaping 与 compact 模式

当前 README 和 response 层已经强调：

- `inspect.scripts`
- `inspect.network`
- `flow.trace-request`

支持 `responseMode="compact"`，并结合 artifact 外置化减少大响应压力。

目标文档未纳入这一点，导致其对“工具上下文成本”的分析不完整。

### 6.5 当前工程化验证面

当前 `package.json` 已包含较完整的工程脚本：

- `lint`
- `typecheck`
- `test:unit`
- `test:integration`
- `verify`
- `verify:manifest`
- `verify:skill`
- `package:smoke`
- `benchmark:v2:fixtures`
- `evaluate:mcp2cli`

目标文档若要评价项目工程化成熟度，不能忽略这些已存在的验证能力。

---

## 7. 隐藏问题或潜在风险

### 7.1 真正的 rate limit 问题不是“没有”，而是“未全局统一”

当前隐藏风险在于：

- 限流能力已经存在；
- 但并没有在 `ToolExecutor` 统一强制；
- 目前主要分布在部分高成本工具路径中。

这意味着系统更准确的问题是：

> 限流策略存在，但尚未形成全局一致的执行治理层。

### 7.2 真正的稳定性风险不是“完全没恢复”，而是“缺自动故障探测”

当前已经有：

- session health
- recoverable
- recoveryCount
- `browser.recover`

但系统仍缺：

- browser 崩溃自动探测
- `disconnected` 自动监听
- CDP 自动重连
- 自动断点恢复

### 7.3 版本配置存在细微不一致

当前：

- `package.json` 为 `2.0.1`
- `server.json` 为 `2.0.1`
- `.env.example` 为 `2.0.1`
- 但 `src/utils/config.ts` 中 `MCP_SERVER_VERSION` 的 fallback 仍是 `2.0.0`

这不是高危问题，但属于应被正式审计文档点出的配置一致性瑕疵。

### 7.4 旧文档之间已经出现相互矛盾

当前工作区内较新的文档，如：

- `docs/plans/legacy_v2_capability_matrix.md`

已经明确修正了多项承接关系。但目标文档仍沿用了“V2 缺失”的旧口径。

因此，项目当前不仅有“代码 vs 文档”的偏差，也有“旧分析文档 vs 新分析文档”的偏差。

---

## 8. 修改建议

### 8.1 应优先重写的部分

如果要把旧文档修订成可对外使用的正式版本，应优先修改以下部分：

1. **V2 / Legacy 能力承接章节**
   - 必须按 `expert / core / legacy` 重新梳理；
   - 明确“V2 存在但 core 隐藏”与“尚无 V2 一等入口”的差异。

2. **“V2 缺失能力”清单**
   - 删除已经被当前代码证伪的条目；
   - 保留真正仍缺失的能力，如 Property Hook / Event Hook 完整实现、自动恢复、统一执行治理等。

3. **安全结论中的 `.env` 相关表述**
   - 改为 git 跟踪事实口径；
   - 禁止把“本地存在”直接写成“已提交仓库”。

4. **自动逆向与 Hook 精度章节**
   - 保留对 `FunctionRanker`、Property Hook、LLM Hook 规划脆弱性的批评；
   - 同时补上 coverage / hook evidence / exception-derived candidate 已接入的事实。

5. **补充遗漏的 V2 架构核心**
   - response envelope
   - artifact / evidence
   - `flow.reverse-report`
   - `flow.resume-session`
   - `browser.recover`
   - `responseMode="compact"`

### 8.2 更合理的现状表述方式

建议把项目现状总结改写为：

> 当前项目已经完成从 Legacy 平铺工具集向 V2 workflow-first MCP 平台的主体迁移，且 expert surface 已显著扩张；当前主要问题不再是“V2 没有这些能力”，而是：
>
> - 部分旧文档仍未跟上当前工具面；
> - `core` / `expert` / `legacy` 边界容易被误读；
> - 自动逆向与自动 Hook 的精准度仍受 `FunctionRanker`、Property Hook 缺口、验证闭环强度不足等问题限制；
> - 统一执行治理（超时、全局限流、自动恢复）仍需补强；
> - 生成痕迹严重的源码形态仍然拖累类型安全与维护性。

---

## 9. 最终结论

### 9.1 这份旧文档整体是否靠谱？

**部分靠谱，但不能作为当前项目的正式现状说明。**

它对“工程债、Hook 缺口、静态排名局限、运行时治理薄弱”这些问题的把握有价值；但对“当前 V2 已有哪些一等工具、哪些只是 profile 隐藏、哪些只是 Legacy alias”这一层的理解已经明显落后。

### 9.2 哪些地方正确？

以下内容总体正确：

- 源码生成痕迹与类型安全削弱；
- 大型文件与维护负担；
- V2 / Legacy 双轨仍在；
- `FunctionRanker` 静态关键词导向明显；
- Property Hook / Event Hook 仍未完成；
- LLM Hook 规划链路脆弱；
- `ToolExecutor` 缺统一超时/取消层；
- 自动恢复与执行治理仍需增强。

### 9.3 哪些地方有偏差？

以下内容偏差明显：

- 把多个 V2 expert tools 写成“仅 Legacy 可用”；
- 把 profile 差异误写成“V2 缺失”；
- 把 `.env` 本地存在误写成“已提交仓库”；
- 把 rate limiter 写成“完全未生效”；
- 把 storage init 写成“未自动调用”；
- 忽略 coverage / hook evidence / exception-derived candidate 已接入事实；
- 忽略 `flow.reverse-report` / `flow.resume-session` / `browser.recover` / artifact/evidence 等 V2 核心能力。

### 9.4 是否存在隐藏遗漏问题？

**存在。**

尤其遗漏了：

- `expert/core/legacy` surface 边界；
- response envelope 与 artifact/evidence；
- `browser.recover`；
- `flow.reverse-report` / `flow.resume-session`；
- `responseMode="compact"`；
- 当前工程化验证脚本与基准测试脚本。

### 9.5 如果要修订，应优先修改哪些部分？

优先级建议：

1. 重写 V2 / Legacy 能力矩阵；
2. 删除已经被代码证伪的“V2 缺失能力”说法；
3. 改正 `.env` / rate limit / storage init 等事实性错误；
4. 重写自动逆向与 Hook 精度章节，使其同时体现“仍有缺陷”和“已有增强”；
5. 补齐 V2 当前真正关键的结构化能力与 session/report/evidence 机制。

---

## 10. 一句话结论

> 目标文档最有价值的部分，是它识别出了当前项目仍然存在的运行时治理、Hook 能力与源码形态问题；但它对“当前 V2 已经做到哪一步”的判断明显过时。对外使用前，必须先按当前工作区代码把 V2 expert surface、profile 模型、artifact/evidence 架构和 workflow 能力重新写实。
