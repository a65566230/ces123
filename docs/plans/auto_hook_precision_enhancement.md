# 自动 Hook 精准度增强设计

> 本文专注于一个明确问题：当前项目已经具备 `hook.generate`、`hook.inject`、`hook.data` 与 `flow.generate-hook` 等能力，但自动 Hook 的精度仍不够稳定，尤其在最终关键签名点定位（如 `vkey` 这类派生字段）场景下，仍然容易命中“周边函数”而非“最关键函数”。本文的目标是给出一套可立即接入当前 V2 架构的 Hook 精度增强设计。

---

## 1. 文档目标

本文回答以下问题：

1. 当前自动 Hook 精准度为什么不够；
2. 线索收集、候选筛选、target normalize、注入时机、命中验证、自动回退分别卡在哪里；
3. `hook.generate`、`hook.inject`、`hook.data`、`flow.generate-hook` 应如何重构；
4. 如何让 Hook 更适合命中最终关键签名点，而不是只命中“周边函数”；
5. 如何让 Hook 结果进入 evidence / artifact 反馈回路，支撑下一轮自动逆向排序。

---

## 2. 证据边界

### 2.1 已由代码证实

- 当前 V2 已存在：
  - `hook.generate`
  - `hook.inject`
  - `hook.data`
  - `flow.generate-hook`
- `src/modules/hook/AIHookGenerator.ts` 已具备以下能力：
  - `isValidIdentifier()`
  - `isUsableFunctionName()`
  - `isValidObjectPath()`
  - `deriveTargetFromObjectPath()`
  - `selectFallbackTarget()`
  - `normalizeTarget()`
  - `deriveCondition()`
  - `planHookRequest()`
  - `generateHook()`
- `AIHookGenerator.ts` 已支持多类目标：
  - `function`
  - `object-method`
  - `api`
  - `property`
  - `event`
  - `custom`
- 当前项目已有：
  - `ArtifactStore`
  - `EvidenceStore`
  - `flow.find-signature-path`
  - `flow.trace-request`
  - `debug.watch`
- Legacy 中明确存在以下动态验证相关能力：
  - `console_inject_function_tracer`
  - `console_inject_xhr_interceptor`
  - `console_inject_fetch_interceptor`
  - `xhr_breakpoint_*`
  - `event_breakpoint_*`
  - `blackbox_*`

### 2.2 合理推断

- 当前 Hook 精度问题不是“不会生成 Hook 代码”，而是“生成前的候选目标不够稳定、生成后的命中验证不够强”；
- 当前最关键的闭环缺失在：
  - 注入后命中判定
  - 自动回退
  - 多候选竞争
  - evidence 反馈重排
- `vkey` 类问题比 `songmid` 类问题更难，原因不在 Hook 能不能注入，而在 Hook 是否打在正确的最终写入点/计算点上。

### 2.3 信息不足

- 当前 `flow.generate-hook` 的完整内部实现细节未完全逐段核验；
- 当前 `hook.inject` 是否已支持注入时机策略（如 pre-init / delayed）无法完全确认；
- 当前 `hook.data` 是否已有命中质量判定字段无法完全确认。

因此，以下设计以当前**可证实能力 + 明显缺口**为基础，不把 README 或旧文档中的推断当成已完成实现。

---

## 3. 当前 Hook 流程现状

## 3.1 当前主路径

当前 V2 中，Hook 主路径大致可理解为：

1. `flow.find-signature-path`
   - 生成候选签名点线索
2. `flow.generate-hook` / `hook.generate`
   - 基于候选线索生成 Hook
3. `hook.inject`
   - 把 Hook 注入目标会话
4. `hook.data`
   - 读取捕获结果

### 结论
这条链已经存在，但它当前更像：
- 候选驱动的 Hook 生成流程

而不是：
- 候选生成 → 候选验证 → 命中竞争 → 自动回退 → 反馈重排 的完整闭环

---

## 3.2 当前精度短板的结构性来源

### 短板 1：线索收集还不够细
当前 Hook 生成的输入线索更多来自：
- scripts search
- request trace
- rank-functions
- object path 推断

而缺少：
- function tracer 反馈
- interceptor 反馈
- final write 反馈
- blackbox 后的净化调用链

### 短板 2：候选筛选还不够“关键点导向”
即使 `AIHookGenerator` 有 target normalize 和 fallback，它也只能在给定上下文质量足够高时发挥较好效果。

如果上游提供的是：
- 相关函数
- 周边对象方法
- 通用 API

而不是：
- 最终写入点
- 最终派生结果生成点

那 Hook 仍然容易打偏。

### 短板 3：object path / target normalize 的边界问题
`AIHookGenerator` 当前更适合处理：
- 全局函数
- 可解析的 object path
- 常见 API

但不一定稳定适合：
- 局部闭包函数
- 运行时临时绑定函数
- 在初始化早期注册又快速替换的方法
- 混淆后对象层级不稳定的方法

### 短板 4：注入时机不稳定
即使 target 选对了，如果：
- Hook 注入太晚
- 关键函数只在初始化期执行一次
- 绑定在脚本加载初期完成

那么最终效果也会很差。

### 短板 5：缺少注入后命中验证
当前更像：
- 生成 Hook
- 注入 Hook
- 查看是否有数据

但没有形成：
- 命中质量评分
- 未命中自动重试
- 候选回退
- 候选重排

### 短板 6：evidence / artifact 还不是 Hook 反馈层
当前 Hook 结果还没有明显进入：
- 下一轮目标重排
- 下一轮 flow 自动决策
- “哪些目标更稳定”的经验积累

---

## 4. 当前自动 Hook 为什么容易命中“周边函数”

## 4.1 因为当前候选更多来自静态可见线索
静态可见线索通常更容易命中的对象包括：
- 关键词明显的函数
- 离请求较近的函数
- 公开 object path 上的函数

这些函数不一定是最终关键点，很多只是：
- 参数加工函数
- 请求包装函数
- 调用链中间层
- 辅助日志/组装函数

---

## 4.2 `vkey` 这类派生字段更容易触发这个问题
原因在于：
- 它更可能是最终产物而不是中间业务字段
- 生成链可能比较深
- 最关键点可能是某个被混淆的局部函数、最终写入点、或隐式计算分支

所以静态候选链更容易命中“接近 vkey 的函数”，而不是“真正生成 vkey 的函数”。

---

## 5. Hook 精准度增强的核心设计原则

### 原则 1：把 Hook 设计成“多候选竞争系统”，而不是“单候选下注”
当前最需要改的，不是某个 Hook 模板，而是：
- 同时生成多候选
- 让多个候选竞争
- 自动根据命中结果选最优候选

### 原则 2：Hook 必须进入验证闭环
Hook 不应只是注入工具，而应成为：
- 关键签名点验证器
- 最终写入点识别器
- 候选排序反馈源

### 原则 3：Hook 与 trace / watch / breakpoint / interceptor 联动
Hook 单独使用的效果有限。要提升精度，必须与：
- `debug.watch`
- `debug.xhr`
- `inspect.function-trace`
- `inspect.interceptor`
- `debug.blackbox`
联动。

### 原则 4：Hook 结果必须 evidence 化
只有当 Hook 结果被结构化记录并反向喂给排序器，系统才会越来越准。

---

## 6. `hook.generate` 增强设计

## 6.1 当前定位
当前 `hook.generate` 更像：
- 从一个描述/上下文生成一个 Hook 方案

后续应增强为：
- **从多候选输入生成多套 Hook 候选与评分信息**

---

## 6.2 建议新增输入

```json
{
  "sessionId": "session_xxx",
  "description": "trace final vkey generation",
  "targetField": "vkey",
  "fieldRole": "derived|final-signature",
  "candidates": [ ... ],
  "sourceEvidenceIds": ["evidence_xxx"],
  "preferredHookTypes": ["function", "object-method", "api"],
  "injectStrategy": "auto"
}
```

### 核心作用
- 让 Hook 生成器知道：
  - 当前是围绕哪个字段定位；
  - 候选来自哪些 evidence；
  - 候选之间优先级如何；
  - 目标是“调试性 Hook”还是“关键点验证 Hook”。

---

## 6.3 建议新增输出

输出不应只是一个 Hook 代码块，而应包含：

- candidate hook list
- each candidate target
- target stability score
- injection timing recommendation
- verification strategy recommendation
- expected hit mode
- evidence linkage

示例结构：

```json
{
  "candidates": [
    {
      "target": {"type": "object-method", "object": "window.xxx", "property": "yyy"},
      "score": 0.84,
      "reasoning": ["final-write-proximity", "request-correlated"],
      "recommendedInjection": "pre-init",
      "verification": ["watch:vkey", "xhr-breakpoint:*/api/*"]
    }
  ]
}
```

---

## 7. `hook.inject` 增强设计

## 7.1 当前问题
当前 `hook.inject` 更像“执行注入动作”，但实际精度问题里，注入时机非常关键。

---

## 7.2 建议支持的注入策略

### A. `pre-init`
在页面关键脚本执行前注入，用于：
- 初始化即绑定/初始化即执行的函数
- 早期对象方法 Hook

### B. `runtime`
在已有会话中直接注入，用于：
- 已加载对象
- 需要即时调试的函数

### C. `delayed`
延迟注入，用于：
- 目标在异步脚本加载后才出现
- 某些路由切换或动态模块加载时机

### D. `auto`
由系统根据 target 特征与历史 evidence 自动选择。

---

## 7.3 注入后应返回什么

建议返回：
- injected candidates
- resolved targets
- injection timestamps
- readiness diagnostics
- immediate probe result
- next validation actions

这能减少“注入了但不知道是否对了”的黑箱状态。

---

## 8. `hook.data` 增强设计

## 8.1 当前问题
单纯返回捕获到的数据不够。真正关键的是：
- 是否命中目标字段
- 是否命中目标函数
- 是否离最终签名点更近

---

## 8.2 建议新增命中质量分析

`hook.data` 建议在返回原始数据之外，增加：

- hitCount
- targetFieldObserved
- fieldWriteObserved
- requestCorrelationObserved
- finalPayloadCorrelationObserved
- bestHitSummary
- rerankHint

### 示例
```json
{
  "hitCount": 3,
  "targetFieldObserved": true,
  "fieldWriteObserved": true,
  "requestCorrelationObserved": true,
  "bestHitSummary": {
    "argsPreview": "...",
    "returnPreview": "...",
    "matchedField": "vkey"
  },
  "rerankHint": "promote-candidate"
}
```

---

## 9. `flow.generate-hook` 增强设计

## 9.1 当前定位问题
当前应将其从：
- “帮你生成并注入一个 Hook”

升级成：
- **管理多候选 Hook 竞争、验证、回退的工作流工具**

---

## 9.2 目标工作流

建议把 `flow.generate-hook` 设计成以下闭环：

1. 接收来自 `flow.find-signature-path` / `flow.trace-request` 的候选
2. 调用 `hook.generate` 生成多套 Hook 候选
3. 调用 `hook.inject` 注入候选
4. 调用 `hook.data` 读取结果
5. 对命中质量打分
6. 自动淘汰低质量候选
7. 产出最佳 Hook 方案
8. 写回 evidence / artifact

---

## 9.3 建议新增输出字段

- selectedCandidate
- candidateScores
- rejectedCandidates
- hitValidationResult
- fallbackAttempts
- evidenceIds
- nextActions

---

## 10. 多候选 Hook 竞争机制设计

## 10.1 为什么必须做多候选竞争
因为当前自动逆向的现实不是“找不到候选”，而是“候选太多、很难知道哪个最关键”。

### 单候选方案的问题
- 命中一个周边函数后容易误判为成功
- 一次失败后缺少下一步自动动作

### 多候选竞争的优势
- 可以比较候选之间的命中质量
- 可以发现“虽然命中了，但不是最终写入点”的情况
- 可以自动将 `vkey` 这类最终结果字段拉回主排序逻辑

---

## 10.2 候选竞争评分建议

建议综合以下信号：

1. 命中次数
2. 是否观察到目标字段
3. 是否观察到 final payload correlation
4. 是否观察到 final write behavior
5. 是否接近 request dispatch
6. 是否位于 blackbox 之外的可疑代码区域
7. 是否与 trace / watch / interceptor 线索一致

---

## 11. Hook 注入后命中验证与自动回退

## 11.1 命中验证应回答的问题
- Hook 是否真的触发了？
- 触发时是否观察到目标字段？
- 目标字段是输入、输出、还是最终写入？
- 是否与目标请求关联？
- 是否比其他候选更接近最终签名点？

---

## 11.2 自动回退机制

当某候选出现以下情况时，应自动回退：
- 长时间无命中
- 命中但未观察到目标字段
- 命中字段但不接近目标请求
- 命中位置明显属于周边函数

### 回退方式
- 切换到次优候选
- 切换注入时机
- 切换 target type（function → object-method）
- 切换验证策略（watch / interceptor / tracer 联动）

---

## 12. 与 evidence / artifact 的反馈式集成

## 12.1 当前问题
当前 Hook 结果更像一次性输出，而不是系统学习输入。

## 12.2 应沉淀的 evidence 类型
建议增加：
- hook-candidate-generated
- hook-injected
- hook-hit
- hook-hit-validated
- hook-candidate-rejected
- hook-promoted-to-best

## 12.3 应写回排序系统的信号
- 哪个 target 稳定命中
- 哪个 target 触发但未涉及关键字段
- 哪个 target 只命中周边逻辑
- 哪个 target 接近最终写入点

---

## 13. 可立即执行的实施设计

## 批次一：把 Hook 从“单目标生成”升级为“多候选输出”

### 动作
- 扩展 `hook.generate` 的输入输出结构
- 支持多个 candidate hook
- 输出稳定性评分与注入建议

### 价值
这是后续命中验证与回退的前提。

---

## 批次二：增强 `hook.inject` 的注入时机能力

### 动作
- 引入 `pre-init | runtime | delayed | auto`
- 注入返回结构化 diagnostics

### 价值
解决“目标找对了但注入晚了”的问题。

---

## 批次三：增强 `hook.data` 命中质量判定

### 动作
- 输出命中质量摘要
- 输出与字段/请求的关联度
- 输出 rerank hint

### 价值
让 Hook 从“取日志工具”变成“验证器”。

---

## 批次四：重构 `flow.generate-hook` 为竞争式工作流

### 动作
- 管理多个 Hook 候选
- 自动回退
- evidence 写回
- 产出最优候选

### 价值
这是“自动 Hook 精准度提升”真正落地的一步。

---

## 14. 与 `songmid` / `vkey` 的关系

## `songmid`
当前流程对它较友好，因为：
- 明文字段更容易被看到
- Hook 条件更容易表达
- 结果更容易和请求相关联

## `vkey`
当前流程更容易失准，因为：
- 它更像最终派生结果
- 更依赖 final-write trace
- 更依赖动态验证工具与回退机制

### 结论
Hook 精准度增强对 `vkey` 的收益会比对 `songmid` 更明显。

---

## 15. 删除 Legacy 前的验收门槛

以下条件不满足前，不建议删除 Legacy 中与 Hook 精度强相关的动态验证能力：

1. `inspect.function-trace` 已落地并可被 `flow.generate-hook` 调用；
2. `inspect.interceptor` 已落地并可给出 final write / payload correlation；
3. `hook.generate` 已支持多候选输出；
4. `hook.inject` 已支持注入时机策略；
5. `hook.data` 已支持命中质量评估；
6. 至少一个 `songmid` 和一个 `vkey` 样例通过 V2-only Hook 闭环验证。

---

## 16. 最终结论

1. **当前自动 Hook 精度不足的核心，不在于“不会生成 Hook 代码”，而在于“缺少多候选竞争、命中验证和自动回退闭环”。**
2. **如果目标是提升最终关键签名点定位能力，Hook 必须从注入工具升级为验证工具。**
3. **对 `vkey` 这类派生字段，Hook 的主要价值不是记录调用，而是识别 final write / final payload correlation。**
4. **最值得优先做的 Hook 方向，不是继续堆模板，而是：**
   - 多候选 Hook 竞争
   - 注入时机策略
   - 命中质量判定
   - 自动回退
   - evidence 反馈重排
5. **当 Hook 闭环与 request / trace / validation 闭环打通后，V2 才可能真正超越 Legacy 在自动逆向场景下的实战效果。**
