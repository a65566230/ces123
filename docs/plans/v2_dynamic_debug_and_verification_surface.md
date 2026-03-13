# V2 动态调试与验证工具面设计

> 本文聚焦于一个明确问题：当前项目的自动逆向、自动 Hook 和最终关键签名点定位能力，已经拥有 V2 工作流骨架，但仍缺少一组足够强的 **动态验证与运行时追踪工具面**。这些能力在 Legacy 中部分存在，但尚未以清晰的 V2 风格进入默认主路径。

---

## 1. 文档目标

本文不是讨论 Legacy 是否“落后”，而是回答以下可执行问题：

1. 当前 V2 默认调试工具面已经覆盖了什么；
2. 哪些动态验证能力仍主要停留在 Legacy；
3. 哪些能力必须迁入 V2，才能支撑自动逆向与自动 Hook 的精度提升；
4. 这些能力迁入 V2 时，应如何设计成 **grouped / session-aware / evidence-aware / workflow-friendly** 的新工具，而不是原样复制 Legacy 工具名。

---

## 2. 证据边界

### 2.1 已由代码证实

以下结论已由当前工作区代码直接确认：

- V2 默认调试工具面存在：
  - `debug.control`
  - `debug.evaluate`
  - `debug.breakpoint`
  - `debug.watch`
  - `debug.xhr`
  - `debug.event`
  - `debug.blackbox`
- `debug.control` 当前 action 枚举包括：
  - `enable`
  - `disable`
  - `pause`
  - `resume`
  - `stepInto`
  - `stepOver`
  - `stepOut`
  - `state`
- `debug.breakpoint` 当前可直接看到的 action 枚举包括：
  - `set`
  - `remove`
  - `list`
  - `clear`
  - `setOnException`
- `debug.watch` 当前可直接看到的 action 枚举包括：
  - `add`
  - `remove`
  - `list`
  - `evaluate`
  - `clear`
- `debug.xhr` / `debug.event` / `debug.blackbox` 已在当前 V2 expert surface、README 与测试中公开可见
- Legacy 中明确存在：
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
- V2 运行时内部已接入更完整的调试基础：
  - `session.debuggerManager`
  - `session.runtimeInspector`
  - `session.debuggerManager.initAdvancedFeatures(...)`
  - 当前代码中还能看到 `_xhrManager`、`_eventManager` 等高级管理器被初始化的痕迹

### 2.2 README / 文档可见但未完全核验

- README 强调 V2 为 `debug.*` / `flow.*` 的主路径；
- README 已把 `debug.xhr` / `debug.event` / `debug.blackbox` 列入 debug 组 expert surface；
- 但 README 仍不能替代对 `flow.*` 内部消费路径的完整核验；
- `optimization_analysis.final.md` 也明确指出：动态验证能力是当前迁移缺口的核心之一。

### 2.3 信息不足 / 无法完全确认

- `flow.find-signature-path` / `flow.trace-request` 是否已经统一输出并消费 `debug.xhr` / `debug.event` / `debug.blackbox` 这类 V2 工具名；
- V2 是否存在未被当前抓取命中的 `inspect.function-trace` 或类似工具；
- V2 是否已把 interceptor / coverage 作为内部 workflow 能力直接使用而未单独暴露。

因此，本文设计以**当前可见工具面为准**，不把“底层管理器存在”直接等同于“V2 默认工具面已完整覆盖”。

---

## 3. 当前动态调试工具面的现实状态

## 3.1 V2 已有的调试主路径

从当前代码可直接确认，V2 已经拥有一套基础调试主路径：

- `debug.control`
  - enable / disable / pause / resume / stepInto / stepOver / stepOut / state
- `debug.evaluate`
  - call-frame / global runtime evaluation
- `debug.breakpoint`
  - 基础断点管理与 pause-on-exception
- `debug.watch`
  - watch expression 增删查评估清理
- `debug.xhr`
  - XHR/fetch breakpoint 管理
- `debug.event`
  - 事件断点与 category 管理
- `debug.blackbox`
  - 噪音脚本黑盒管理

### 结论
基础 debugger lifecycle 已经不需要继续依赖 Legacy。后续迁移重点不在“再造一个基础调试器”，而在**把现有 expert 入口真正接入 workflow，并补齐缺失的 tracer/interceptor 等能力**。

---

## 3.2 Legacy 仍承担的动态验证能力

Legacy 当前仍保留一批对自动逆向/自动 Hook 直接有价值的运行时能力：

### A. 已有 V2 expert 入口、但仍保留 Legacy 平铺别名的能力
- XHR breakpoint
- Event breakpoint
- Blackbox

### B. 仍主要停留在 Legacy 的主动拦截/追踪类
- XHR interceptor
- Fetch interceptor
- Function tracer
- Script monitor

### C. 运行时行为分析类
- Coverage
- Heap snapshot

### D. 站点可达性辅助类
- Stealth
- Captcha

### 结论
这些能力不是“Legacy 尾巴”，而是**V2 工作流精度提升所缺的关键验证层**。

---

## 4. 为什么这组能力必须迁入 V2

## 4.1 自动逆向的短板不在“会不会搜”，而在“能不能验证”

当前项目已经有：

- `flow.find-signature-path`
- `flow.trace-request`
- `FunctionRanker`
- `SourceMapAnalyzer`
- `BundleFingerprintService`
- `inspect.scripts`
- `inspect.network`

这些说明：
- 静态候选发现能力已具基础；
- request 到脚本/函数的初步线索能力已具基础。

但对于：
- `vkey` 这类派生字段
- 最终签名点
- 周边函数过多、链路较长的站点

真正的问题往往不是“找不到任何候选”，而是：
- 候选太多；
- 周边函数和关键函数混在一起；
- 缺少验证谁才是最后写入者或最关键调用点的动态手段。

这就是为什么：
- XHR breakpoint
- function tracer
- interceptor
- blackbox
- coverage

这类能力必须进入 V2 主路径。

---

## 4.2 自动 Hook 精度提升依赖“候选验证层”

`AIHookGenerator.ts` 已有：

- target normalize
- object path derive
- fallback target
- condition derive
- RAG/LLM planning

但它真正缺的不是“会不会生成 Hook 代码”，而是：
- 候选目标是否真的关键；
- 注入后是否命中；
- 没命中时应退回哪个候选；
- 是否需要换 object path / 换注入时机 / 换目标函数。

这些问题没有动态验证工具面，就很难闭环。

---

## 5. V2 动态验证工具面设计原则

### 原则 1：不原样复刻 Legacy 命名
不建议继续使用：
- `xhr_breakpoint_set`
- `console_inject_fetch_interceptor`

这种命名可以保留在 Legacy bridge，但不适合 V2 主面。

### 原则 2：能力按语义分组，而不是按低层实现细节分组
建议以以下风格设计：
- `debug.xhr`
- `debug.event`
- `debug.blackbox`
- `inspect.function-trace`
- `inspect.interceptor`
- `analyze.coverage`

### 原则 3：所有新工具都必须 session-aware
统一要求：
- `sessionId`
- 结构化响应
- artifact/evidence 集成
- diagnostics / nextActions

### 原则 4：所有新工具都必须可被 `flow.*` 消费
新能力不是为了“再多几个专家工具”，而是为了：
- `flow.find-signature-path` 能调用它们做验证
- `flow.trace-request` 能利用它们补全链路
- `flow.generate-hook` 能依赖它们提升精度

---

## 6. 建议优先增强/新增的 V2 工具与能力

## 6.1 `debug.xhr`

### Legacy 来源
- `xhr_breakpoint_set`
- `xhr_breakpoint_remove`
- `xhr_breakpoint_list`

### 当前状态
- Legacy 明确存在
- V2 expert surface 已直接证实存在
- 当前缺口在 `flow.*` 仍未统一消费 `debug.xhr`

### 设计目标
为请求驱动的动态验证提供一等入口，服务于：
- 请求发起前暂停
- 定位最终签名写入点
- 自动 trace / Hook 候选验证

### 建议输入
```json
{
  "sessionId": "session_xxx",
  "action": "set|remove|list|clear",
  "urlPattern": "*/api/*",
  "method": "POST",
  "fieldHints": ["songmid", "vkey"]
}
```

### 建议输出
- breakpoint 列表或结果
- 命中次数
- 最近一次命中摘要
- `evidenceIds`
- `nextActions`

### 当前应优先做的不是再新增名字
- 保持 `debug.xhr` 作为 request-oriented 独立入口；
- 让 `flow.trace-request` / `flow.generate-hook` 直接输出 `debug.xhr` 调用建议；
- 把最近命中摘要、field-aware hint、evidence 反馈补齐。

---

## 6.2 `debug.event`

### Legacy 来源
- `event_breakpoint_set`
- `event_breakpoint_set_category`
- `event_breakpoint_remove`
- `event_breakpoint_list`

### 当前状态
- V2 expert surface 已直接证实存在
- 当前缺口在事件命中结果还未稳定进入 request/function 关联链

### 设计目标
支撑以下场景：
- 关键点击、提交、输入事件前后暂停
- 排查页面事件触发的签名链
- 协助定位“事件 → 请求 → 计算函数”的触发链

### 建议输入
- `sessionId`
- `action: set|set-category|remove|list|clear`
- `eventName`
- `category`

### 建议输出
- 激活的事件断点列表
- 事件命中情况
- 对应 stack / evidence

---

## 6.3 `debug.blackbox`

### Legacy 来源
- `blackbox_add`
- `blackbox_add_common`
- `blackbox_list`

### 当前状态
- V2 expert surface 已直接证实存在
- 当前缺口在黑盒结果尚未进入候选重排与 evidence 反馈

### 设计目标
用于：
- 去掉 React/Vue/webpack/runtime/第三方库噪音
- 提高关键签名函数候选的纯度
- 提升自动逆向的 signal-to-noise ratio

### 建议输入
- `sessionId`
- `action: add|remove|list|add-common|clear`
- `pattern`

### 建议输出
- 当前黑盒列表
- 新增/删除结果
- 对候选路径压缩建议

### 与自动逆向的关系
对 `vkey` 类问题尤其关键，因为这类问题往往不是找不到调用点，而是噪音太多。

---

## 6.4 `inspect.function-trace`

### Legacy 来源
- `console_inject_function_tracer`

### 设计目标
把“手工注入 tracer”升级为：
- 候选函数验证工具
- 最终写入点发现工具
- 自动重排输入信号提供者

### 建议输入
- `sessionId`
- `targetType: function|object-method|pattern`
- `target`
- `captureArgs`
- `captureReturn`
- `captureStack`
- `fieldHints`
- `autoStopAfterHits`

### 建议输出
- trace hits
- matched call sites
- final write candidates
- `artifactId`
- `evidenceIds`

### 关键说明
它不应该只是“把 console tracer 放进 V2”，而应该成为：
> `flow.find-signature-path` 和 `flow.generate-hook` 的动态验证器。

---

## 6.5 `inspect.interceptor`

### Legacy 来源
- `console_inject_xhr_interceptor`
- `console_inject_fetch_interceptor`

### 设计目标
用于定位：
- 请求发出前最后被修改的字段
- request body / headers / query 的最终形成点
- 与具体调用函数的运行时关联

### 建议输入
- `sessionId`
- `type: xhr|fetch|both`
- `urlPattern`
- `captureHeaders`
- `captureBody`
- `captureResponse`
- `fieldHints`
- `correlateWithNetwork: true|false`

### 建议输出
- intercepted requests
- final payload diff
- caller stack summary
- candidate function hints
- `evidenceIds`

### 价值
对于 `vkey` 这类“最终请求里才出现、静态搜索不友好”的字段，这个工具的价值极高。

---

## 6.6 `analyze.coverage`

### Legacy 来源
- `performance_start_coverage`
- `performance_stop_coverage`

### 设计目标
不是为了做通用性能分析，而是为了：
- 热路径发现
- 动态脚本优先级压缩
- 关键签名点候选收缩

### 建议输入
- `sessionId`
- `action: start|stop|summary`
- `scope: scripts|functions|both`

### 建议输出
- used scripts/functions
- hot path summary
- candidate refinement hints
- artifact/evidence

### 说明
当前无法直接量化它对自动逆向的提升倍数，但它是最可能带来明显增益的“高级辅助验证”能力之一。

---

## 6.7 `browser.stealth` / `browser.captcha`

### Legacy 来源
- `stealth_*`
- `captcha_*`

### 当前状态
- `StealthScripts2025.ts` 和 `CaptchaDetector.ts` 已存在底层实现
- 但 V2 未见默认主路径工具

### 设计目标
- `browser.stealth`：保证目标站点可达性和初始化阶段稳定性
- `browser.captcha`：避免自动逆向在入口阶段就被阻断

### 设计说明
虽然它们不直接等于“自动逆向精度”，但会影响自动逆向是否能顺利进入分析阶段，因此应作为 V2 辅助能力承接。

---

## 7. 新工具与 `flow.*` 的联动设计

## 7.1 `flow.find-signature-path`
应消费：
- `debug.blackbox`
- `inspect.function-trace`
- `analyze.coverage`
- `debug.watch`

输出不应只给“候选函数”，还应给：
- 推荐 trace 计划
- 推荐 blackbox 方案
- 推荐 watch 表达式
- 推荐 hook 目标
- 推荐 breakpoint 计划

---

## 7.2 `flow.trace-request`
应消费：
- `inspect.interceptor`
- `debug.xhr`
- `debug.event`
- `inspect.network`

输出不应只给请求摘要，还应给：
- request → candidate scripts
- request → candidate functions
- request → object paths
- final write candidate hints
- evidence 关系图

---

## 7.3 `flow.generate-hook`
应消费：
- `inspect.function-trace`
- `inspect.interceptor`
- `debug.watch`
- `debug.xhr`

这样它才能完成：
- 候选目标选择
- 注入后命中验证
- 未命中自动回退
- 结果回灌 evidence

---

## 8. 可立即执行的重构顺序

## 批次一（优先级最高）
### 目标
补齐动态验证主面，使 V2 有能力承接关键验证链路。

### 交付物
- 将 `debug.xhr` 接入 `flow.trace-request` / `flow.generate-hook`
- 将 `debug.event` 接入事件触发链分析
- 将 `debug.blackbox` 接入候选降噪与 evidence
- `inspect.function-trace`
- `inspect.interceptor`

### Legacy 处理
- 先保留对应 Legacy 能力
- 标记“V2 migration in progress”
- 不做立即删除

---

## 批次二
### 目标
让 `flow.find-signature-path` / `flow.trace-request` 真正使用这些能力形成验证闭环。

### 交付物
- 增强的 `flow.find-signature-path`
- 增强的 `flow.trace-request`
- 与 evidence / artifact 的反馈整合

---

## 批次三
### 目标
让 Hook 进入“多候选 + 命中验证 + 自动回退”模式。

### 交付物
- 增强的 `hook.generate`
- `hook.inject`
- `hook.data`
- 增强的 `flow.generate-hook`

---

## 批次四
### 目标
补齐 V2 辅助能力面，准备真正收缩 Legacy。

### 交付物
- `browser.stealth`
- `browser.captcha`
- `analyze.coverage`
- `browser.interact` / `browser.capture` / `browser.storage`

---

## 9. 删除 Legacy 前的验收门槛

在以下条件满足之前，不建议删除 Legacy 中对应动态验证能力：

1. V2 已有上述一等工具入口；
2. `flow.find-signature-path` 能消费这些工具的结果；
3. `flow.trace-request` 能输出 request→function 的候选链；
4. `flow.generate-hook` 能完成注入后命中验证和自动回退；
5. 至少在：
   - 一个 `songmid` 场景
   - 一个 `vkey` 场景
   - 一个高噪音/高混淆站点
   上完成回归验证。

---

## 10. 最终结论

1. **当前项目的核心缺口不是“没有调试能力”，而是“缺少一组进入 V2 主路径的动态验证工具面”。**
2. **V2 已经足以替代 Legacy 的主架构与基础调试主路径，但仍不足以替代 Legacy 的专家级动态验证能力。**
3. **如果目标是提升自动逆向与自动 Hook 精度，最应优先推进的不是 UI 类辅助工具，而是：**
   - 把 `debug.xhr` / `debug.event` / `debug.blackbox` 真正接进 `flow.*`
   - 补齐 `inspect.function-trace`
   - 补齐 `inspect.interceptor`
4. **这些能力进入 V2 的方式，应该是优先复用现有 grouped 工具名，并只为真正缺失的能力新增一等入口。**
5. **只有当这些能力进入 V2 并被 `flow.*` 真正消费之后，Legacy 才有可能进入实质删除阶段。**
