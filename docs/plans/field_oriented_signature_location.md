# 字段导向的签名点定位设计（面向 `songmid`、`vkey`、`sign`、`token`）

> 本文面向当前项目中的一个关键现实问题：并不是所有字段都适合用同一套自动逆向策略。像 `songmid` 这样的显式业务字段，当前系统往往更容易命中；而 `vkey` 这类派生字段、最终签名点字段，则显著更难。本文的目标是给出一套字段导向的签名点定位设计，用于驱动 `flow.find-signature-path`、`flow.trace-request`、`flow.generate-hook` 的后续增强。

---

## 1. 文档目标

本文重点解决以下问题：

1. 为什么当前 `songmid` 比 `vkey` 更容易命中；
2. 为什么不能继续用一套通用 heuristics 同时处理显式字段和派生字段；
3. 应如何围绕字段角色（explicit / derived / final-signature）设计自动逆向策略；
4. 应如何让字段导向策略参与：
   - request trace
   - candidate ranking
   - dynamic validation
   - hook competition
   - evidence feedback

---

## 2. 证据边界

### 2.1 已由代码证实

- 当前项目已存在：
  - `flow.find-signature-path`
  - `flow.trace-request`
  - `flow.generate-hook`
  - `inspect.scripts`
  - `inspect.network`
  - `analyze.rank-functions`
  - `hook.generate/inject/data`
  - `ArtifactStore` / `EvidenceStore`
- 当前项目具备 Hook 候选规划能力（`AIHookGenerator.ts`）
- 当前项目具备加密、source map、bundle 指纹、函数排名等辅助定位能力
- 当前 Legacy 中仍有：
  - function tracer
  - interceptor
  - XHR breakpoint
  - blackbox
  等动态验证工具，尚未完整迁入 V2

### 2.2 合理推断

- `songmid` 这类字段更接近显式业务字段，因此更容易通过搜索、请求抓取、Hook 条件命中；
- `vkey` 这类字段更接近派生结果或最终签名点，因此更依赖动态追踪与验证；
- 当前自动逆向流程对显式字段天然更友好，对派生字段和最终写入点的反向追踪仍较弱。

### 2.3 信息不足

- 当前 `flow.find-signature-path` 是否已经存在字段导向参数无法完全确认；
- 当前评分逻辑是否已显式区分 explicit / derived / final-signature 无法完全确认。

因此本文以“后续应如何设计”为主，而不假设当前已经完整具备这套机制。

---

## 3. 为什么必须做字段导向策略

## 3.1 通用 heuristics 的上限已经显现

当前项目已经有：
- 脚本搜索
- 请求追踪
- 函数排序
- Hook 生成
- 动态调试基础

这些能力足以建立“通用自动逆向骨架”。

但当前业务现象表明：
- 显式字段效果更好
- 派生字段效果一般
- 最终关键签名点定位仍不稳定

### 结论
这说明问题不只是“工具不够多”，而是：
> **不同类型字段应使用不同定位策略。**

---

## 3.2 字段本身决定定位难度

一个字段在逆向中的“好不好定位”，取决于它属于哪种角色，而不是字段名本身是否看起来重要。

例如：
- `songmid`：通常更像显式业务字段
- `vkey`：通常更像派生字段或最终结果字段
- `sign` / `token`：有时是明文字段，有时是最终派生字段

这要求系统先理解“字段角色”，再选择定位策略。

---

## 4. 字段角色分类模型

建议在 V2 中统一引入字段角色分类：

### 4.1 `explicit`
#### 特征
- 明文字段名易见
- 通常直接出现在 request payload / query / body / JSON 中
- 易被脚本搜索命中

#### 典型例子
- `songmid`
- `id`
- `mid`
- 某些业务参数

#### 适用策略
- scripts search
- network correlation
- rank-functions + keyword boost
- 一般 Hook 条件

---

### 4.2 `derived`
#### 特征
- 来自中间计算结果
- 可能只在少数运行时阶段出现
- 生成函数不一定含字段名
- 更依赖动态验证

#### 典型例子
- `vkey`
- 某些中间摘要/校验值

#### 适用策略
- request trace
- final write trace
- tracer / interceptor
- field-aware watch
- Hook 候选竞争

---

### 4.3 `final-signature`
#### 特征
- 紧贴最终请求发出阶段
- 可能只在 payload 组装的最后阶段出现
- 更像“最后写入点”问题，而不是“哪段脚本提到这个字段”问题

#### 典型例子
- `sign`
- `token`
- 一些最终 auth header / signature param

#### 适用策略
- interceptor
- XHR breakpoint
- final write detection
- request dispatch proximity ranking
- Hook 命中验证与回退

---

## 5. `songmid` 为什么效果较好

## 5.1 更接近显式业务字段

它通常具备以下特征：
- 字段名明文出现；
- 请求中直接可见；
- 在代码中可能以对象键/参数名形式出现；
- 更容易被 `inspect.scripts` 搜索命中。

---

## 5.2 当前 V2 主链对这类字段天然更友好

当前项目已有：
- `inspect.network`
- `inspect.scripts`
- `flow.trace-request`
- `analyze.rank-functions`
- `hook.generate`

这些工具天然更适合处理：
- 能搜到
- 能看到
- 能直接作为条件写入 Hook 的字段

因此 `songmid` 表现较好，是当前自动逆向骨架能够发挥作用的正常表现。

---

## 6. `vkey` 为什么效果一般

## 6.1 更像派生字段 / 最终结果字段

`vkey` 往往不是“原始输入”，而更像：
- 某段计算后的结果
- 请求发出前最后填入的值
- 多层函数间接产生的派生字段

### 直接后果
- 在源码里不一定能搜索到关键生成点；
- 搜到的可能只是“使用点”，而不是“生成点”；
- rank-functions 可能只能找到周边函数。

---

## 6.2 `vkey` 的生成链更依赖动态验证

对 `vkey` 这类字段，仅靠：
- 搜索关键词
- 通用函数排序
- 通用 Hook 目标推测

往往不够。

更需要：
- interceptor
- function tracer
- XHR breakpoint
- final write detection
- Hook 命中后回溯

### 结论
`vkey` 类问题的难点，本质上不是“脚本太大”，而是：
> **最终结果字段的生成链不容易通过静态线索直接命中。**

---

## 7. 字段导向的自动逆向策略设计

## 7.1 在 `flow.find-signature-path` 中引入字段角色

### 建议输入
```json
{
  "targetField": "vkey",
  "fieldRole": "derived",
  "requestPattern": "*/api/*"
}
```

### 作用
- 决定候选收集策略
- 决定候选打分策略
- 决定推荐验证计划

---

## 7.2 显式字段策略（如 `songmid`）

### 重点动作
1. 搜索脚本中是否出现字段名
2. 在 `inspect.network` 中查找该字段出现在哪些请求里
3. 找到字段相关对象结构
4. 基于上下文生成 Hook/Watch 计划

### 优先信号
- keyword hit
- request visibility
- object key presence
- request body proximity

---

## 7.3 派生字段策略（如 `vkey`）

### 重点动作
1. 从目标请求出发，先找到最终 payload 中的字段
2. 用 interceptor / breakpoint / tracer 回溯最终写入链
3. 从写入链回推候选函数和对象路径
4. 再做 Hook 候选竞争验证

### 优先信号
- final payload presence
- final write proximity
- request dispatch proximity
- runtime mutation correlation
- trace hit quality

---

## 7.4 最终签名字段策略（如 `sign` / `token`）

### 重点动作
1. 先定位请求触发与 dispatch 点
2. 再定位请求体/header 最终写入点
3. 再定位签名生成函数链
4. 最后做 Hook/validation 闭环

### 重点工具
- `flow.trace-request`
- `inspect.interceptor`
- `debug.xhr`
- `inspect.function-trace`
- `flow.generate-hook`

---

## 8. 候选函数打分的字段导向增强

## 8.1 当前问题
当前候选打分更像“通用签名函数排序”。

### 对显式字段有效的原因
- 字段名可见
- 请求相关性高

### 对派生字段失效的原因
- 最关键函数不含字段名
- 只靠通用 sign/crypto 关键词不够

---

## 8.2 建议新增的字段导向分数

建议在现有候选评分基础上，增加：

1. `fieldLiteralScore`
   - 字段名是否以明文出现

2. `requestAssociationScore`
   - 候选是否与目标请求链强相关

3. `finalWriteScore`
   - 候选是否接近最终写入点

4. `mutationScore`
   - 候选是否改变目标字段值

5. `dispatchProximityScore`
   - 候选是否靠近请求 dispatch 点

6. `validationHitScore`
   - tracer/watch/hook/interceptor 是否已命中该候选

### 角色加权建议
- `explicit`：更偏重 `fieldLiteralScore`
- `derived`：更偏重 `mutationScore` + `validationHitScore`
- `final-signature`：更偏重 `finalWriteScore` + `dispatchProximityScore`

---

## 9. 字段导向的 request → script → function → hook 闭环

## 9.1 对 `songmid` 类字段

### 推荐闭环
1. request 中识别字段
2. scripts search 命中字面量
3. rank-functions 给出候选
4. Hook/Watch 命中验证
5. 结果写回 evidence

## 9.2 对 `vkey` 类字段

### 推荐闭环
1. request 中识别最终字段
2. 用 interceptor 捕获最终 payload
3. 用 tracer / breakpoint 回溯最终写入点
4. 用 blackbox 去除噪音脚本
5. 对多个候选 Hook 进行竞争
6. 用 Hook 命中质量反向提升候选评分
7. 写回 evidence / artifact

---

## 10. 对 `flow.trace-request` 的字段导向增强

## 建议新增输出
- fieldRole-aware candidate list
- final payload write hints
- candidate functions by field role
- recommended validation plan
- recommended Hook targets
- recommended blackbox patterns

### 目标
让 `flow.trace-request` 不只是“看请求”，而是：
> **围绕目标字段给出下一步最可能有效的验证和 Hook 方案。**

---

## 11. 对 `flow.generate-hook` 的字段导向增强

## 建议新增输入
- `targetField`
- `fieldRole`
- `sourceEvidenceIds`
- `hookObjective: observe-input | observe-derived | observe-final-write`

### 目的
不同字段角色应该生成不同类型的 Hook：

- 对 `songmid`：可更偏参数输入观察
- 对 `vkey`：可更偏返回值/最终写入观察
- 对 `sign` / `token`：可更偏 final payload / dispatch 前写入观察

---

## 12. 字段导向的 evidence 设计

建议为 evidence 增加字段角色维度：

- `field-role: explicit`
- `field-role: derived`
- `field-role: final-signature`

并记录：
- 字段第一次可见位置
- 字段最终写入位置
- 与请求的关联关系
- 与 Hook 命中关系
- 候选提升/淘汰原因

这能让后续自动化不再只依赖一次性静态候选，而开始具备“记住哪类线索对哪类字段有效”的基础。

---

## 13. 可立即执行的实施建议

## 批次一：把字段角色引入 `flow.find-signature-path` 和 `flow.trace-request`

### 动作
- 新增 `targetField`
- 新增 `fieldRole`
- 输出 role-aware candidate summaries

### 价值
先让工作流层知道“不是所有字段都该用同一套策略”。

---

## 批次二：为 `derived/final-signature` 引入动态验证计划

### 动作
- 对 `fieldRole=derived/final-signature` 的场景，自动输出：
  - tracer plan
  - interceptor plan
  - xhr-breakpoint plan
  - blackbox plan
  - hook plan

### 价值
让 `vkey` 不再只走静态 heuristics 链路。

---

## 批次三：把字段导向评分纳入 Hook 和 evidence 重排

### 动作
- `hook.generate` 支持字段角色输入
- `hook.data` 支持字段导向命中质量摘要
- evidence 增加字段角色与 final write 标签

### 价值
让 `vkey` 这类问题得到真正的“专项对待”。

---

## 14. 删除 Legacy 前的前置条件

对于 `vkey` 类问题，如果以下能力未进入 V2，就不建议删除 Legacy 中的相关动态验证工具：

1. function tracer
2. XHR/fetch interceptor
3. XHR breakpoint
4. Blackbox
5. Hook 命中验证与回退机制

原因很直接：
- `songmid` 可依赖显式字段链路；
- `vkey` 更依赖动态验证链路；
- 先删 Legacy 再谈 `vkey` 精度提升，风险很高。

---

## 15. 最终结论

1. **字段角色差异，是当前自动逆向效果差异的根本原因之一。**
2. **`songmid` 效果较好，说明当前系统对显式业务字段已有不错支撑；`vkey` 效果一般，说明当前系统对派生字段和最终结果字段的动态验证能力不足。**
3. **如果继续只用一套通用 heuristics 去找所有字段，自动逆向精度很难继续提升。**
4. **后续必须把字段角色（explicit / derived / final-signature）引入 `flow.find-signature-path`、`flow.trace-request`、`flow.generate-hook` 的输入、输出和评分逻辑中。**
5. **只有当字段导向策略 + 动态验证工具面 + Hook 闭环三者打通后，V2 才真正具备针对 `vkey` 这类最终关键签名点的稳定定位能力。**
