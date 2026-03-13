# Legacy → V2 迁移重构设计（面向自动逆向与自动 Hook 精度提升）

> 本文目标不是简单删除 Legacy，而是基于当前项目实际代码与既有分析结论，给出一套可以立即执行的迁移重构设计：在收敛 Legacy 工具面的同时，把真正影响自动逆向能力、自动 Hook 精度与最终关键签名点定位的能力重构为 V2 风格体系，并为最终淘汰 Legacy 建立前提条件。

---

## 背景与目标

当前项目已经形成了明显的 **V2 主路径 + Legacy 兼容层** 结构：

- `src/index.ts` 默认启动 `V2MCPServer`
- `.env.example` 默认 `ENABLE_LEGACY_TOOLS=false`
- `src/server/v2/legacy/LegacyToolBridge.ts` 说明 Legacy 已不再是主入口，而是兼容桥接层

同时，当前项目也已经完成了明显的 V2 平台化重构：

- `V2MCPServer.ts`
- `ToolRegistry.ts`
- `ToolExecutor.ts`
- `ToolRuntimeContext.ts`
- `SessionLifecycleManager.ts`
- `ArtifactStore` / `EvidenceStore`
- `response.ts` 的结构化 envelope
- `flow.collect-site` / `flow.find-signature-path` / `flow.trace-request` / `flow.generate-hook` / `flow.reverse-report`

这些都说明：**V2 已经替代了 Legacy 的主架构、主工作流和大部分基础主路径。**

但从当前工作区代码看，Legacy 仍保留一批对“自动逆向精度”“自动 Hook 精度”“专家级调试验证”至关重要的能力，例如：

- XHR breakpoint
- Event breakpoint
- Blackbox
- `console_inject_function_tracer`
- `console_inject_xhr_interceptor`
- `console_inject_fetch_interceptor`
- `stealth_*`
- `captcha_*`
- `performance_*`
- 一些 page / dom 细粒度交互能力

因此，本次迁移的目标不是：

- 立刻暴力删除 Legacy；
- 把 Legacy 工具 1:1 改名搬到 V2；
- 只做一层命名重构。

而是：

1. **把真正仍有价值的 Legacy 能力迁移到 V2 风格体系**
2. **把仅是旧交互方式的问题能力直接淘汰**
3. **把需要重设计的能力改造成面向 session / artifact / evidence / flow 的 V2 工具**
4. **借迁移同步补齐自动逆向闭环和自动 Hook 闭环**
5. **为最终删除 Legacy 建立可验证前提**

---

## 证据边界与判断标准

### 已由代码证实

以下结论已由当前工作区代码直接确认：

- 默认入口是 `V2MCPServer`
- Legacy 默认关闭（`.env.example`）
- V2 是 Playwright-only runtime
- V2 已具备：
  - `ToolRegistry`
  - `ToolExecutor`
  - `ToolRuntimeContext`
  - `SessionLifecycleManager`
  - `ArtifactStore`
  - `EvidenceStore`
  - `response.ts` 统一 envelope
- 当前 V2 工具名（代码抓取）包括：
  - `browser.launch/status/recover/close/navigate`
  - `inspect.dom/scripts/network/runtime/artifact/evidence`
  - `debug.control/evaluate/breakpoint/watch/xhr/event/blackbox`
  - `analyze.understand/crypto/bundle-fingerprint/source-map/script-diff/rank-functions/obfuscation/deobfuscate`
  - `hook.generate/inject/data`
  - `flow.collect-site/find-signature-path/trace-request/generate-hook/reverse-report/resume-session`
- Legacy 中明确存在：
  - `watch_*`
  - `xhr_breakpoint_*`
  - `event_breakpoint_*`
  - `blackbox_*`
  - `console_inject_script_monitor`
  - `console_inject_xhr_interceptor`
  - `console_inject_fetch_interceptor`
  - `console_inject_function_tracer`
  - `captcha_*`
  - `stealth_*`
  - `performance_*`
  - `page_click/type/hover/scroll/screenshot/...`
  - `page_get/set_cookies`
  - `page_get/set_local_storage`

### README / 文档可见但实现未完全核验

以下内容在 README 或文档中可见，但不应直接视为已完整实现：

- 所有 `flow.*` 工具内部实现细节的完整度
- V2 是否在隐藏 action 中已经支持所有 breakpoint 子类型
- Skill 层完整路由文档是否齐全
- 某些自动逆向流程效果是否已稳定达成

### 合理推断

- 当前自动逆向问题的主要短板在动态验证闭环，而非静态分析骨架缺失
- `songmid` 更容易命中，是因为它更接近显式业务字段
- `vkey` 更难，是因为它更接近派生结果字段/最终签名点
- 动态 tracer / interceptor / breakpoint / blackbox 对 `vkey` 类问题具有直接价值

### 信息不足 / 无法完全确认

- `debug.xhr` / `debug.event` / `debug.blackbox` 已公开存在，但 `flow.*` 是否已稳定输出并消费这些 V2 工具名
  当前从 `flow.find-signature-path` 的调试建议实现看：**尚未完成统一**
- V2 是否已完整承接 page 细粒度交互与 screenshot/storage/cookie 工具
  当前**信息不足**
- `inspect.function-trace` / `inspect.interceptor` 是否已有公开一等入口
  当前**未直接证实**
- `flow.find-signature-path` 内部具体打分函数和命中链路的全部细节
  当前只能部分推断，不应过度写死

---

## 当前 Legacy → V2 迁移现状

### 1. 架构层：已替代

V2 已经明确替代 Legacy 成为项目主架构：

- `src/index.ts` 直接启动 `V2MCPServer`
- `LegacyToolBridge.ts` 说明 Legacy 已是桥接兼容层
- `.env.example` 默认 `ENABLE_LEGACY_TOOLS=false`

#### 结论

从架构主线看，**迁移已经开始且方向明确**，不需要再争论是否要以 V2 为主。

### 2. 工作流层：已替代

V2 已经拥有 Legacy 没有的高层工作流工具：

- `flow.collect-site`
- `flow.find-signature-path`
- `flow.trace-request`
- `flow.generate-hook`
- `flow.reverse-report`
- `flow.resume-session`

#### 结论

从工作流层看，**V2 已明显优于 Legacy**，并且已经成为自动逆向主路径。

### 3. 基础能力层：大面积替代，但不是 100% 完整确认

当前可由代码确认，V2 已明确承接的主路径包括：

- 浏览器启动/状态/关闭/导航
- 脚本检查与搜索
- 网络检查
- 运行时检查
- 断点基础控制
- watch
- 通用分析（understand / crypto / rank-functions / obfuscation / deobfuscate）
- Hook 生成/注入/取数

#### 但仍存在信息不足的基础边角能力

- page click/type/hover/scroll 等细交互
- screenshot
- cookies / localStorage
- debugger 会话持久化等旧能力

#### 结论

从基础能力主路径看，V2 已替代了“大多数”，但还没有证实“所有边角能力都替代”。

### 4. 专家级调试与运行验证层：尚未完全替代

这是当前迁移的最大缺口。

#### 已由 Legacy 代码直接证实存在的能力

- `xhr_breakpoint_*`
- `event_breakpoint_*`
- `blackbox_*`
- `console_inject_script_monitor`
- `console_inject_xhr_interceptor`
- `console_inject_fetch_interceptor`
- `console_inject_function_tracer`
- `performance_start_coverage`
- `performance_stop_coverage`
- `performance_take_heap_snapshot`
- `stealth_*`
- `captcha_*`

#### 当前 V2 中已存在的一等专家入口

- `debug.xhr`
- `debug.event`
- `debug.blackbox`

#### 当前 V2 中未见明确一等工具入口的能力

- `inspect.function-trace`
- `inspect.interceptor`
- `analyze.coverage`
- `browser.stealth`
- `browser.captcha`
- `browser.interact`（细粒度 page 交互总入口）

#### 结论

当前不能说 V2 已完整替代 Legacy 的专家级调试与运行时追踪能力。  
**但最核心的缺口已经从“没有 xhr/event/blackbox 工具”转为“这些工具尚未完成 workflow 集成，且 tracer/interceptor 仍未落地”。**

---

## Legacy 能力分类与处理策略

这里不按“工具名”逐个迁，而按“能力”分类处理。

### 一、可直接淘汰

#### 判断标准

- V2 已有更优实现
- 代码已证实，不只是 README 宣称
- 删除不会损失关键专家路径
- 对自动逆向精度没有实质伤害

#### 当前建议纳入此类的能力

1. `collect_code`
   - V2 对应：`flow.collect-site` + `inspect.scripts`
   - 原因：V2 不只是替代，而且引入了 session / artifact / workflow

2. `search_in_scripts`
   - V2 对应：`inspect.scripts`
   - 原因：V2 已有分页、worker search、artifact 外置化等更优设计

3. `understand_code`
   - V2 对应：`analyze.understand`
   - 原因：已有 V2 一等入口

4. `detect_crypto`
   - V2 对应：`analyze.crypto`
   - 原因：已有 V2 一等入口，底层 `CryptoRules.ts` 明确存在

5. `watch_*`
   - V2 对应：`debug.watch`
   - 原因：已由代码证实 V2 已有 add/remove/list/evaluate/clear

6. `ai_hook_generate` / `ai_hook_inject` / `ai_hook_get_data` 的主流程使用面
   - V2 对应：`hook.generate` / `hook.inject` / `hook.data` + `flow.generate-hook`
   - 原因：V2 已更适合工作流和自动化路径

> 注意：这些可以“设计上进入淘汰列表”，但不意味着立刻删除代码。应在回归验证后再标记 deprecated，再进入正式移除阶段。

### 二、先迁移再删除

#### 判断标准

- V2 有近似能力，但替代不完整
- 删除会伤害专家调试路径
- 自动逆向 / Hook 精度仍依赖它们

#### 当前建议纳入此类的能力

1. `xhr_breakpoint_*`
2. `event_breakpoint_*`
3. `blackbox_*`
4. `page_click/type/hover/scroll/press_key/select`
5. `page_screenshot`
6. `page_get/set_cookies`
7. `page_get/set_local_storage`
8. `debugger_save/load/export/list_sessions`（若当前使用场景仍依赖）

#### 处理策略

- 不应按 Legacy 命名直接照搬
- 应先在 V2 中做 grouped 入口和结构化响应
- 验证主流程与专家路径都不退化后，再进入删除阶段

### 三、保留兼容层一段时间

#### 判断标准

- 仍有老用户/老 Agent 路径价值
- V2 尚无稳定替代
- 但不应继续作为未来主面发展

#### 当前建议纳入此类的能力

- Legacy 的整套专家级调试调用路径
- 部分 page / dom 老式细粒度操作
- 一些旧的“直接打点/直接注入”路径

#### 处理策略

- 保留 bridge
- 在文档中标记为“兼容层”
- 新增 deprecated 标记与替代路径说明
- 一旦 V2 等价能力完成验收，再逐步收缩

### 四、必须重新设计后再迁移

#### 判断标准

- 能力本身很有价值
- 但不适合按 Legacy 工具形态直接搬到 V2
- 应转化为 session / artifact / evidence / workflow 风格能力

#### 当前最重要的此类能力

1. `console_inject_function_tracer`
2. `console_inject_xhr_interceptor`
3. `console_inject_fetch_interceptor`
4. `stealth_*`
5. `captcha_*`
6. `performance coverage / heap`
7. `page_emulate_device/set_viewport`

#### 处理原则

这些能力应重构为 V2 工具层，而不是“原样复刻 Legacy 名字”。

例如建议重构成：

- `inspect.function-trace`
- `inspect.interceptor`
- `browser.stealth`
- `browser.captcha`
- `analyze.coverage`
- `browser.profile` / `browser.emulation`

---

## V2 需要新增/重构的能力设计

以下是“现在就可以开始设计”的 V2 工具面，不是抽象愿景。

### 1. `debug.watch`

#### 当前状态

- **已由代码证实：已存在**
- 不应继续作为迁移缺口讨论

#### 处理建议

- 保留并强化，不再作为 Legacy 迁移重点
- 重点改为让 `flow.*` 自动利用 `debug.watch`

### 2. XHR breakpoint

#### Legacy 对应

- `xhr_breakpoint_set/remove/list`

#### 当前 V2 状态

- **已由代码、README 与测试直接证实存在**
- 当前公开入口是 `debug.xhr`
- 当前缺口不在 catalog，而在 `flow.*` 仍未统一输出/消费该 V2 工具名

#### 增强设计

##### 处理策略

- 不新增重复 API
- 继续以 `debug.xhr` 作为一等 expert 入口
- 重点增强 `flow.trace-request` / `flow.generate-hook` 对它的消费

##### 输入建议

- `sessionId`
- `action: set/remove/list/clear`
- `urlPattern`
- `method`
- `requestFieldHints`

##### 输出建议

- 结构化 response
- 命中统计
- 建议 nextActions
- evidence 记录

##### 进一步增强方向

- 增加 field-aware 提示（如 `fieldHints`）
- 增加命中摘要与最近一次触发上下文
- 让 `flow.*` 推荐项直接输出 `debug.xhr` 而不是 Legacy 风格动作名

### 3. Event breakpoint

#### Legacy 对应

- `event_breakpoint_set/set_category/remove/list`

#### 当前 V2 状态

- **已由代码、README 与测试直接证实存在**
- 当前公开入口是 `debug.event`
- 当前缺口在 workflow/evidence 集成，而不是工具名缺失

#### 增强设计

##### 处理策略

- 不新增重复 API
- 保持 `debug.event` 作为独立 grouped 入口
- 优先让 `flow.trace-request` / 事件触发链分析能直接消费它

##### 设计目标

- 面向自动验证和事件触发链路分析
- 支持 category 模式
- 支持 evidence 输出

### 4. Blackbox

#### Legacy 对应

- `blackbox_add/add_common/list`

#### 当前 V2 状态

- **已由代码、README 与测试直接证实存在**
- 当前公开入口就是 `debug.blackbox`
- 当前缺口主要在候选降噪结果还未反馈给 `flow.find-signature-path`

#### 增强设计

##### 处理策略

- `debug.blackbox`

##### 设计目标

- 对框架/第三方库/噪音脚本做降噪
- 支持：
  - add
  - remove
  - list
  - add-common
  - clear
- 可与 `flow.find-signature-path` 联动自动建议黑盒模式

##### 价值

这不是“附加能力”，而是：

> **提高关键签名点定位纯度的核心工具**

### 5. Function tracer

#### Legacy 对应

- `console_inject_function_tracer`

#### 当前 V2 状态

- 未见 V2 一等入口

#### 迁移设计

##### 建议新增

- `inspect.function-trace`

##### 输入建议

- `sessionId`
- `target`
- `mode: function / object-method / pattern`
- `captureArgs`
- `captureReturn`
- `captureStack`
- `autoStop`
- `fieldHints`

##### 输出建议

- trace results
- artifactId
- evidenceIds
- trace summary
- matchedCallSites

##### 为什么必须重做，而不是原样搬运

因为它在 V2 中应承担：

- 动态候选验证
- 候选函数重排
- 关键字段最终写入点识别

而不仅是“注入一个 console tracer”

### 6. XHR / Fetch interceptor

#### Legacy 对应

- `console_inject_xhr_interceptor`
- `console_inject_fetch_interceptor`

#### 当前 V2 状态

- 未见 V2 一等入口

#### 迁移设计

##### 建议新增

- `inspect.interceptor`

##### 输入建议

- `sessionId`
- `type: xhr | fetch | both`
- `urlPattern`
- `captureRequestBody`
- `captureResponseBody`
- `captureHeaders`
- `fieldHints`
- `autoCorrelate`

##### 输出建议

- 请求/响应截获结果
- 与 `inspect.network` 的关联索引
- object path / caller stack 线索
- evidence 记录

##### 价值

这类工具对 `vkey` 类问题非常关键，因为它能帮助回答：

- 请求发出前最后是谁写入了签名字段
- 哪个函数链最接近最终写入点

### 7. Stealth

#### Legacy 对应

- `stealth_inject`
- `stealth_set_user_agent`

#### 当前 V2 状态

- `StealthScripts2025.ts` 存在
- 但 V2 未见一等入口

#### 迁移设计

##### 建议新增

- `browser.stealth`

##### 输入建议

- `sessionId`
- `action: enable/status/set-user-agent/apply-profile`
- `profile`
- `userAgent`

##### 输出建议

- applied settings
- session metadata
- warnings

##### 说明

这是“能力已存在但 V2 主路径未承接”的典型例子。

### 8. Captcha

#### Legacy 对应

- `captcha_detect`
- `captcha_wait`
- `captcha_config`

#### 当前 V2 状态

- `CaptchaDetector.ts` 存在
- V2 未见一等入口

#### 迁移设计

##### 建议新增

- `browser.captcha`

##### 输入建议

- `sessionId`
- `action: detect/wait/config`
- `timeout`
- `strategy`

##### 说明

这不是自动逆向核心路径，但对实际站点可达性强相关。

### 9. Performance coverage / heap snapshot

#### Legacy 对应

- `performance_start_coverage`
- `performance_stop_coverage`
- `performance_take_heap_snapshot`

#### 当前 V2 状态

- 未见 V2 一等入口

#### 迁移设计

##### 建议新增

- `analyze.coverage`
- `analyze.heap`

##### 为什么重做

因为 coverage 不应只是性能工具，而应服务于：

- 热路径发现
- 关键签名点候选收缩
- 高动态脚本优先识别

##### 这对自动逆向的重要性

虽然当前无法直接量化收益，但这是最可能带来**数量级定位提升**的能力之一，尤其对 `vkey` 这类派生字段。

### 10. 细粒度 page / dom 交互能力

#### Legacy 对应

- `page_click/type/hover/scroll/...`
- `page_screenshot`
- `cookies`
- `localStorage`

#### 当前 V2 状态

- 未完全核验
- 从当前工具面看没有独立一等入口

#### 迁移设计

##### 建议新增

- `browser.interact`
- `browser.storage`
- `browser.capture`

##### 目标

- 把零散 page/dom 细操作整合成 grouped 设计
- 避免继续回到 Legacy 的平铺命名

---

## 自动逆向能力增强设计

### 当前为什么“有框架但精度不够”

#### 已由代码与现象共同支撑

当前项目已经有：

- `flow.find-signature-path`
- `flow.trace-request`
- `FunctionRanker`
- `BundleFingerprintService`
- `SourceMapAnalyzer`
- `ArtifactStore`
- `EvidenceStore`

这说明“找候选”这件事已经有明显框架。

#### 但短板在于：

1. request → script → function 关联不够强
2. 候选函数排序偏通用关键词
3. 对结果字段反向追踪能力不足
4. 动态验证能力未完全进入 V2 主流程
5. evidence 更多是沉淀层，还不是强反馈层

### `flow.find-signature-path` 应如何增强

#### 当前问题

它更像：

- 候选发现器
- 而不是候选验证器

#### 增强设计

##### 1. 引入字段导向模式

新增输入：

- `targetField`
- `fieldRole: explicit | derived | final-signature`

示例：

- `songmid` → explicit
- `vkey` → derived/final-signature

##### 2. 候选评分增强

除了现有通用 heuristics，再加入：

- request proximity score
- final write proximity score
- runtime hit score
- hook hit score
- trace score

##### 3. 集成动态验证计划

输出不只给候选函数，还要给：

- 推荐 `debug.watch`
- 推荐 `debug.xhr`
- 推荐 `debug.blackbox`
- 推荐 `inspect.function-trace`
- 推荐 `hook.generate`

##### 4. 支持反向追踪最终结果字段

对 `vkey` 这种字段，需要设计：

- 结果字段出现在请求中时，反向追到最近写入点
- 从写入点回溯调用链和相关函数

### `flow.trace-request` 应如何增强

#### 当前问题

它更像“请求观察工具”，还不是“请求到关键函数链构建器”。

#### 增强设计

新增输出：

- candidate scripts
- candidate functions
- candidate object paths
- suggested watches
- suggested breakpoints
- suggested hooks
- correlated evidence ids

##### 目标

把它从：

> “看到了哪些请求”

升级为：

> “请求和可疑函数链之间是什么关系”

### 自动逆向为什么对 `vkey` 更难

#### 原因 1：显式字段 vs 派生字段差异

- `songmid` 更容易作为明文参数、对象键、搜索关键字出现
- `vkey` 更可能是最终结果，不直接暴露生成过程

#### 原因 2：请求参数与最终签名结果之间有断层

- 当前 trace 更容易命中“使用点”
- 但不一定命中“生成点”或“最后写入点”

#### 原因 3：当前排序策略对通用签名关键词更友好

- 对 `sign/token/crypto` 类函数更友好
- 对 `vkey` 这种业务派生值不够友好

#### 原因 4：动态验证能力未完整纳入主流程

- 没有 tracer / interceptor / blackbox / breakpoint 闭环，`vkey` 更容易漏掉最关键点

---

## 自动 Hook 精准度增强设计

### 当前自动 Hook 为什么不够准

这是多因素叠加，而不是单一问题。

#### 1. 线索收集不足

当前线索更多来自：

- 静态搜索
- request trace
- rank-functions
- object path 推断

但对复杂站点，这些还不够。

#### 2. 候选筛选仍不稳定

`AIHookGenerator.ts` 已有：

- normalize
- fallback
- RAG/LLM planning

但这只能说明它“会做候选规划”，不等于它已经能稳定找到“最关键函数”。

#### 3. 注入时机问题

当前未见完整“预注入 / 延迟注入 / 双阶段注入”的策略工具化。

#### 4. 缺少命中验证与自动回退

当前最关键的缺口之一是：

- 命中没命中？
- 是否打在关键函数？
- 未命中是否自动换下一候选？

如果没有这个闭环，就很难真正提升 Hook 精准度。

### `hook.generate` / `hook.inject` / `hook.data` / `flow.generate-hook` 应如何增强

#### 1. `hook.generate`

##### 增强方向

- 增加字段导向参数：`targetField`
- 增加来源线索参数：`sourceEvidenceIds`
- 增加目标稳定性评分
- 增加注入时机建议

#### 2. `hook.inject`

##### 增强方向

- 支持：
  - pre-init injection
  - runtime injection
  - delayed injection
- 返回：
  - injectedAt
  - targetResolved
  - readiness diagnostics

#### 3. `hook.data`

##### 增强方向

- 不只返回原始捕获数据
- 还返回：
  - 是否命中目标字段
  - 是否命中目标函数
  - 哪类参数/返回值最相关
  - 是否建议回退到下一候选

#### 4. `flow.generate-hook`

##### 增强方向

从“生成并注入”升级成“多候选竞争式 Hook 流程”：

###### 建议流程

1. 生成 N 个候选
2. 逐个或并行注入
3. 收集命中数据
4. 计算命中质量
5. 选择最佳候选
6. 失败则自动回退
7. 输出 evidence / artifact

---

## `songmid` / `vkey` / 最终签名点定位专项设计

### 目标

不要用一套 heuristics 同时处理：

- 显式业务字段
- 派生字段
- 最终签名点

必须分开处理。

### 一、`songmid` 类字段策略

#### 特征

- 明文字段
- 搜索友好
- 请求中直观可见

#### 适合策略

- `inspect.scripts search`
- `inspect.network`
- `flow.trace-request`
- 一般 Hook 条件即可

### 二、`vkey` 类字段策略

#### 特征

- 派生值 / 最终结果
- 不一定在脚本里直接作为生成逻辑关键词出现
- 更依赖动态链路

#### 必要策略

- result-field backtrace
- function tracer
- interceptor
- XHR breakpoint
- blackbox
- final write detection
- Hook 命中验证与回退

### 三、最终签名点定位专项改造

建议为 V2 增加“最终结果字段定位模式”：

- 输入：
  - `targetField`
  - `requestPattern`
  - `fieldRole=final-signature`
- 输出：
  - final write candidates
  - nearest call sites
  - hook plans
  - validation plans

---

## 可立即执行的迁移重构方案

这里不写空泛路线，而写“现在开始可以怎么做”。

### 批次一：补齐 V2 动态验证主面（优先级最高）

#### 目标

先把最影响自动逆向精度的能力迁入 V2。

#### 本批次新增/重构内容

1. 将 `debug.xhr` 接入 `flow.trace-request` / `flow.generate-hook`
2. 将 `debug.event` 接入事件触发链分析与 evidence
3. 将 `debug.blackbox` 接入 `flow.find-signature-path` 候选降噪
4. `inspect.function-trace`
5. `inspect.interceptor`

#### 本批次完成后可标记 deprecated 的 Legacy 工具

- 暂不直接删除
- 先标记：
  - `xhr_breakpoint_*`
  - `event_breakpoint_*`
  - `blackbox_*`
  - `console_inject_xhr_interceptor`
  - `console_inject_fetch_interceptor`
  - `console_inject_function_tracer`
  为“V2 已有替代路径（待验收）”

#### 验收方式

- 至少验证：
  - 一个 `songmid` 场景
  - 一个 `vkey` 场景
- 验证是否：
  - 能给出候选函数
  - 能命中有效 trace
  - 能命中有效 Hook
  - 能保留 evidence

### 批次二：把 `flow.*` 升级为真正闭环工作流

#### 目标

让 `flow.*` 不只是“帮找候选”，而是“帮验证候选”。

#### 本批次改动

1. 增强 `flow.find-signature-path`
2. 增强 `flow.trace-request`
3. 增强 `flow.generate-hook`

#### 重点能力

- 字段导向模式
- 候选重排
- Hook 命中验证
- 自动回退
- evidence 回灌

#### 本批次后可进入 deprecated 观察的 Legacy 能力

- 一部分专家级断点/追踪路径
- 但仍不建议正式删除 Legacy bridge

### 批次三：补 page/dom / stealth / captcha / performance 的 V2 风格承接

#### 目标

收齐主路径工具面，避免 V2 继续长期缺一块。

#### 本批次新增/重构内容

1. `browser.interact`
2. `browser.capture`
3. `browser.storage`
4. `browser.stealth`
5. `browser.captcha`
6. `analyze.coverage`
7. `analyze.heap`

#### 本批次后可考虑进入真正 Legacy 收缩阶段

### 批次四：Legacy 收缩与删除准备

#### 目标

在能力已证实承接完成后，进入真正删减。

#### 动作

1. 更新 capability matrix
2. 更新 README / docs
3. 标记 deprecated
4. 默认不再文档化 Legacy
5. 如果 benchmark / 回归验证通过，再考虑删除

---

## 风险、依赖与删除前提

### 当前为什么不能直接删除 Legacy

因为当前仍未完成：

- 动态验证能力迁移
- tracer / interceptor 承接
- page/dom 细交互承接
- stealth / captcha / performance 承接
- 自动逆向闭环强化

如果现在删 Legacy，最可能退化的是：

1. 自动逆向验证能力
2. 自动 Hook 精度
3. `vkey` 类最终签名点定位能力
4. 专家手工验证路径

### 未来彻底删除 Legacy 的前提

必须至少满足以下条件：

1. **V2 动态验证工具面齐全**
   - XHR breakpoint
   - Event breakpoint
   - Blackbox
   - tracer
   - interceptor

2. **V2 工作流完成闭环增强**
   - `flow.find-signature-path`
   - `flow.trace-request`
   - `flow.generate-hook`
   能形成完整验证回路

3. **关键业务样例通过**
   - `songmid`
   - `vkey`
   - 至少一个混淆严重站点

4. **Legacy capability matrix 清零到可接受范围**
   - 剩余 Legacy 能力不再影响主路径和专家关键调试路径

5. **回滚策略明确**
   - 即使开始移除，也应保留临时 fallback 方案一段时间

---

## 最终结论

1. **本次迁移的目标不是“删掉 Legacy”，而是“把真正仍有价值的 Legacy 能力重构为 V2 风格体系”。**
2. **当前不适合直接删除 Legacy。**
3. **最关键的未完成项，是专家级动态验证闭环：**
   - `debug.xhr` / `debug.event` / `debug.blackbox` 仍需真正接入 `flow.*`
   - `inspect.function-trace`
   - `inspect.interceptor`
4. **如果要显著提升全自动逆向 + 自动 Hook + 最终签名点定位（尤其 `vkey` 类派生字段），最关键的改造方向不是继续堆静态 heuristics，而是：**
   > **把动态验证闭环真正纳入 V2 主流程：request → script → function → hook → verification → evidence → rerank**
5. **可立即执行的最优迁移顺序是：**
   - 先补动态验证工具面
   - 再增强 `flow.*`
   - 再补 page/dom/stealth/captcha/performance
   - 最后再收缩和删除 Legacy
