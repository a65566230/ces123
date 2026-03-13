# 自动逆向主流程增强设计（面向最终关键签名点定位）

> 本文面向当前项目的 V2 主流程，重点设计如何把现有的 `flow.collect-site`、`flow.find-signature-path`、`flow.trace-request`、`flow.generate-hook` 从“已有自动逆向框架”升级为“具备动态验证闭环的自动逆向系统”，尤其解决 `vkey` 这类派生字段的定位难题。

---

## 1. 文档目标

本文回答以下问题：

1. 当前自动逆向为什么“已有框架但精度不够”；
2. 为什么 `songmid` 效果较好，而 `vkey` 这类派生字段效果一般；
3. 当前最关键签名点定位具体卡在哪些链路；
4. `flow.find-signature-path`、`flow.trace-request` 应如何增强；
5. 如何构建 `request -> script -> function -> hook -> verification -> evidence` 的闭环；
6. 哪些 Legacy 动态验证能力必须迁入 V2，才能让这条流程真正闭环。

---

## 2. 证据边界

### 2.1 已由代码证实

- 当前 V2 工作流工具存在：
  - `flow.collect-site`
  - `flow.find-signature-path`
  - `flow.trace-request`
  - `flow.generate-hook`
  - `flow.reverse-report`
  - `flow.resume-session`
- 当前 V2 分析辅助存在：
  - `analyze.rank-functions`
  - `analyze.bundle-fingerprint`
  - `analyze.source-map`
  - `analyze.script-diff`
  - `analyze.obfuscation`
  - `analyze.deobfuscate`
- 当前 V2 检查工具存在：
  - `inspect.scripts`
  - `inspect.network`
  - `inspect.runtime`
  - `inspect.artifact`
  - `inspect.evidence`
- 当前 V2 已具备：
  - `SessionLifecycleManager`
  - `ArtifactStore`
  - `EvidenceStore`
  - `BrowserPool`
  - `response.ts` 的结构化 envelope
- `AIHookGenerator.ts` 已具备：
  - target normalize
  - object path derive
  - fallback target
  - 条件推导
  - RAG / LLM 规划
- 当前 Legacy 明确存在的动态验证能力包括：
  - XHR/Event breakpoint
  - Blackbox
  - function tracer
  - XHR/fetch interceptor
  - coverage

### 2.2 README / 文档可见但实现未完全核验

- README 中 workflow-first 叙事与 `flow.*` 主路径存在；
- 但每个 flow 的完整内部实现效果、稳定性和候选质量并未全部由当前核验覆盖。

### 2.3 合理推断

- 当前自动逆向链路的短板主要在“动态验证闭环不足”，不是纯粹的静态分析缺失；
- `songmid` 更容易命中，因为更接近显式业务字段；
- `vkey` 更难，是因为它更像派生字段或最终签名结果；
- 引入 tracer / interceptor / blackbox / xhr breakpoint 等能力，最可能带来显著效果提升，但当前无法直接量化倍数。

---

## 3. 当前自动逆向流程现状

## 3.1 现有流程骨架

从当前 V2 能力看，自动逆向主流程已经具备最基本的闭环骨架：

1. `flow.collect-site`
   - 建立 session
   - 收集站点初始上下文
   - 整理首轮脚本与网络信息

2. `flow.find-signature-path`
   - 从脚本中搜索候选
   - 借助 rank-functions / source-map / fingerprint 等能力做候选推测

3. `flow.trace-request`
   - 把请求与相关线索关联起来

4. `flow.generate-hook`
   - 根据候选线索生成 Hook

5. `hook.inject` / `hook.data`
   - 注入并读取 Hook 结果

### 结论
当前项目不是“没有自动逆向能力”，而是：
> **自动逆向已经具备主路径骨架，但动态验证和反馈重排能力还不够强。**

---

## 3.2 当前链路的核心短板

### 短板 1：request → script → function 的关联仍不够强
当前已有：
- `inspect.network`
- `inspect.scripts`
- `analyze.rank-functions`
- `flow.trace-request`

但从业务现象看，当前更像能做到：
- 找到相关请求
- 找到相关脚本
- 找到一些候选函数

还不稳定地做到：
- 找到最后写入签名字段的函数
- 找到真正关键签名点

### 短板 2：候选打分偏通用 heuristics
当前 `FunctionRanker` 明显更偏关键词/预览启发式。对以下类函数更友好：
- sign
- token
- crypto
- nonce
- encrypt

对以下目标更不友好：
- 业务私有派生字段
- 混淆对象方法
- 局部闭包函数
- 最终写入点函数

### 短板 3：缺少动态验证闭环
当前主要还停留在：
- 静态候选发现
- 手动或半自动验证

而不是：
- 自动建立候选
- 自动插入验证手段
- 自动评估候选质量
- 自动回灌下一轮排序

### 短板 4：evidence/artifact 还不是强反馈层
当前 evidence/artifact 更像是：
- 结构化沉淀层

但还没有完全成为：
- 候选重排信号源
- Hook 命中反馈源
- 字段定位策略的迭代输入

---

## 4. `songmid` 与 `vkey` 表现差异的原因

## 4.1 `songmid` 为什么更容易命中

### 合理推断 1：它更像显式业务字段
- 容易以明文出现在请求参数里
- 容易以明文字段名出现在对象结构里
- 容易在源码中通过搜索命中

### 合理推断 2：它更容易进入静态候选链
当前 V2 有：
- `inspect.scripts`
- `flow.find-signature-path`
- `inspect.network`

这些对显式字段天然更友好，因为：
- 搜索能命中
- 请求能捕获
- Hook 条件更容易表达

### 合理推断 3：它更像“输入”，不是“最终结果”
输入字段一般更靠近：
- 请求体
- 业务对象
- 参数构建函数

因此更容易被当前链路发现。

---

## 4.2 `vkey` 为什么更难

### 合理推断 1：它更像派生字段/最终结果字段
`vkey` 更可能是：
- 多层计算之后的结果
- 请求发出前的最终写入值
- 某个中间函数链最后输出的派生结果

### 合理推断 2：它不一定在关键生成函数中以明文存在
可能出现的情况：
- 生成逻辑中根本不出现 `vkey` 字符串
- 只在最终 payload 组装时才写入 `vkey`
- 生成链路中是 `a() -> b() -> c()` 这种混淆函数链

### 合理推断 3：现有候选排序更偏“通用签名函数”，不偏“最终结果字段写入链”
也就是说，当前更容易找到：
- 看起来像签名函数的函数

而不一定能找到：
- 最终把 `vkey` 写进请求体/参数对象的函数

### 合理推断 4：缺少最终结果反向追踪能力
如果没有：
- interceptor
- tracer
- XHR breakpoint
- final write detection
- field-aware watch

那么 `vkey` 类字段就更容易“看到结果，但找不到源头”。

---

## 5. 当前“最关键签名点定位”为何不够理想

## 5.1 request 到 script/function 的关联链不够强
当前更像：
- request -> 可疑脚本
- 可疑脚本 -> 候选函数

但还不够像：
- request -> 最终字段构建链 -> 最终写入点 -> 最终调用点

### 直接后果
- 容易命中周边逻辑
- 容易命中“相关函数”但不是“关键函数”
- 容易把 Hook 打在接近点而非最关键点

---

## 5.2 缺少围绕字段的定向策略
当前推断中，V2 更像通用自动逆向流程，缺少：
- `targetField` 维度
- 显式字段 vs 派生字段区分
- 最终签名字段专项流程

### 直接后果
- `songmid` 这种显式字段效果较好
- `vkey` 这类派生字段效果一般

---

## 5.3 缺少动态断点/观察/验证闭环
这一点与 `vkey` 问题直接相关。

当前自动逆向的真正短板是：
- 候选发现后，没有足够强的 V2 工具面去自动验证这些候选
- `inspect.function-trace` / `inspect.interceptor` 已进入 V2 主路径，而 `debug.xhr` / `debug.blackbox` 也已被 workflow 推荐链消费；当前重点转为 acceptance 与 Legacy 收缩

### 直接后果
- 关键签名点定位只能停在“高概率候选”层面
- 很难稳定提升到“高置信度命中”层面

---

## 6. `flow.find-signature-path` 增强设计

## 6.1 当前定位
当前应将 `flow.find-signature-path` 明确定义为：
- **候选发现 + 候选验证计划生成器**

而不只是：
- 静态搜索工具

---

## 6.2 建议新增的输入参数

建议增加：

```json
{
  "targetField": "vkey",
  "fieldRole": "derived|explicit|final-signature",
  "requestPattern": "*/api/*",
  "preferredValidation": ["debug.watch", "debug.xhr", "inspect.function-trace", "hook.generate"]
}
```

### 设计目的
让 `flow.find-signature-path` 从“找看起来像签名的函数”升级为：
- 找与目标字段更相关的函数
- 自动推荐验证方案

---

## 6.3 候选评分增强方向

建议在当前候选排序上增加以下信号：

1. **Field proximity score**
   - 是否接近 `targetField`
   - 是否参与最终 payload 组装

2. **Request proximity score**
   - 是否接近目标请求触发点
   - 是否出现在 request chain 中

3. **Final write score**
   - 是否可能是字段最后写入点
   - 是否出现在 interceptor/tracer 捕获链中

4. **Runtime validation score**
   - 是否被 watch 观察到变化
   - 是否被 tracer 命中
   - 是否被 Hook 命中

5. **Noise penalty**
   - 是否属于第三方框架 / runtime / 已 blackbox 区域

---

## 6.4 输出增强方向

输出不应只返回 candidate list，而应返回：

- candidate scripts
- candidate functions
- candidate object paths
- candidate write sites
- recommended `debug.watch`
- recommended `debug.xhr`
- recommended `debug.blackbox`
- recommended `inspect.function-trace`
- recommended `hook.generate`
- initial evidence chain

---

## 7. `flow.trace-request` 增强设计

## 7.1 当前定位问题
当前 `flow.trace-request` 更像：
- 请求观察 / 请求整理工具

后续应升级为：
- **请求到关键函数链构建器**

---

## 7.2 建议新增输出维度

建议输出：

1. **request summary**
2. **candidate scripts**
3. **candidate functions**
4. **candidate object paths**
5. **payload assembly hints**
6. **final write hints**
7. **recommended validation plan**
8. **artifact / evidence references**

---

## 7.3 必须与哪些 V2 能力联动

为了让 `flow.trace-request` 真正变强，它必须能消费：
- `inspect.network`
- `inspect.interceptor`
- `debug.xhr`
- `debug.event`
- `debug.watch`
- `inspect.function-trace`

### 目标
把 request trace 从“静态观察”升级为“动态关联与回溯链构建”。

---

## 8. request → script → function → hook → verification → evidence 闭环设计

这是本项目自动逆向增强的核心闭环，建议明确抽象为 6 个阶段：

### 阶段 1：request capture
输入：
- URL / method / request pattern / field hints

输出：
- request snapshot
- relevant payload fields
- artifact/evidence

### 阶段 2：script correlation
输入：
- request snapshot
- script inventory
- source map / fingerprint signals

输出：
- candidate scripts

### 阶段 3：function ranking
输入：
- candidate scripts
- field role / request hints
- rank-functions / obfuscation / source-map

输出：
- candidate functions
- candidate object paths

### 阶段 4：runtime validation
输入：
- candidate functions
- dynamic debug tools

输出：
- tracer hits
- watch changes
- breakpoint hits
- interceptor hits

### 阶段 5：hook competition
输入：
- validated candidates

输出：
- best hook candidates
- injection plans
- hit results

### 阶段 6：feedback and rerank
输入：
- hook data
- validation artifacts
- request correlation

输出：
- reranked candidates
- final signature point hypothesis
- final evidence chain

---

## 9. 与 evidence / artifact 的反馈式集成

## 9.1 当前问题
当前 evidence / artifact 更像：
- 结构化沉淀层

### 9.2 增强方向
后续要让它们变成：
- 候选重排输入
- trace 命中统计输入
- hook 命中统计输入
- 字段导向策略反馈输入

### 建议记录的 evidence 类型
- request evidence
- script correlation evidence
- function ranking evidence
- validation evidence
- hook hit evidence
- final write evidence

---

## 10. 可立即执行的增强批次

## 批次一：字段导向 + 动态验证接口准备

### 目标
让 `flow.find-signature-path` 和 `flow.trace-request` 拥有可消费动态验证能力的接口形态。

### 立即动作
1. 在 flow 工具入参中增加：
   - `targetField`
   - `fieldRole`
   - `requestPattern`
   - `preferredValidation`
2. 在输出中增加：
   - recommended validation plan
   - candidate object paths
   - candidate write sites
3. 定义 evidence 类型结构

---

## 批次二：把动态验证工具真正接入 flow

### 依赖
- `debug.xhr`
- `debug.blackbox`
- `inspect.function-trace`
- `inspect.interceptor`

### 动作
1. `flow.find-signature-path` 接入 tracer / watch / blackbox
2. `flow.trace-request` 接入 interceptor / `debug.xhr`
3. 输出动态验证证据

---

## 批次三：与 Hook 闭环打通

### 动作
1. `flow.generate-hook` 直接消费 candidate validation output
2. `hook.data` 返回命中质量信息
3. 命中结果写回 evidence
4. 失败候选自动回退并重排

---

## 11. 当前阶段的删除前提

在以下条件满足前，不建议将 Legacy 中与动态验证相关的能力删除：

1. `flow.find-signature-path` 已能输出字段导向候选与验证计划；
2. `flow.trace-request` 已能输出 request → function 链；
3. V2 已具备 `debug.xhr` / `debug.event` / `debug.blackbox` 一等工具，并补齐 tracer/interceptor 一等入口；
4. `songmid` 与 `vkey` 至少各有一个样例在 V2-only 流程下通过验证；
5. Hook 竞争与回退机制可正常工作。

---

## 12. 最终结论

1. **当前自动逆向能力的真正短板不是没有 workflow，而是 workflow 缺少动态验证闭环。**
2. **`songmid` 效果较好、`vkey` 效果一般，根因是当前主流程更擅长处理显式字段，而不擅长处理派生字段与最终写入链。**
3. **如果要显著增强最关键签名点定位能力，最值得优先做的不是继续堆静态 heuristics，而是把动态验证工具面（tracer/interceptor/xhr-breakpoint/blackbox）接入 `flow.*` 主流程。**
4. **`flow.find-signature-path` 和 `flow.trace-request` 应从“候选发现工具”升级为“候选发现 + 验证计划 + 反馈重排工具”。**
5. **当 request → script → function → hook → verification → evidence 闭环跑通后，V2 才真正具备取代 Legacy 并进一步提升自动逆向精度的条件。**
