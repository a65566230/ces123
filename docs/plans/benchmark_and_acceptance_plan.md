# Legacy → V2 迁移与自动逆向增强的 Benchmark / 验收方案

> 本文用于给 Legacy → V2 迁移、自动逆向增强、自动 Hook 精度增强提供统一的验证与验收基线。它不负责定义能力如何设计，而是负责回答：能力做完之后，怎么证明没有退化、怎么证明迁移可接受、怎么判断 V2 是否真的具备替代 Legacy 的条件。

---

## 1. 文档目标

本文回答以下问题：

1. 迁移后的能力应该如何验证；
2. 如何判断“V2 已替代 Legacy”不是纸面判断而是真实现实可用；
3. 自动逆向增强后的效果应如何评估；
4. 自动 Hook 精度增强后的效果应如何评估；
5. `songmid` 与 `vkey` 场景应如何作为代表性样例；
6. token/context 改动为什么不能只靠感觉，应如何做 benchmark。

---

## 2. 证据边界

### 2.1 已由代码证实

- 当前项目存在 V2 / Legacy 双轨；
- 默认入口为 V2；
- Legacy 默认关闭但仍保留；
- V2 已具备 session / artifact / evidence / workflow-first 基础设施；
- 当前高价值动态验证与 follow-on browser/coverage 能力已进入 V2；
- 当前业务观察为：
  - `songmid` 命中较好；
  - `vkey` 效果一般；
  - 自动 Hook 精度仍有明显提升空间。

### 2.2 合理推断

- benchmark 必须覆盖“显式字段场景”与“派生字段场景”；
- benchmark 不应只看“能不能跑通”，而要看：
  - 候选质量
  - 验证闭环完整度
  - Hook 命中质量
  - evidence 反馈质量

---

## 3. Benchmark 维度设计

## 3.1 能力替代维度
用于验证某项 Legacy 能力是否真的被 V2 替代。

### 核心问题
- V2 是否有等价工具面？
- V2 是否具备等价效果？
- V2 是否保留或提升了专家路径？
- 删除 Legacy 后是否会伤害实际逆向效果？

### 适用对象
- `watch`
- XHR breakpoint
- Event breakpoint
- Blackbox
- tracer/interceptor
- page/dom 细操作
- stealth/captcha/coverage 等辅助能力

---

## 3.2 自动逆向流程维度
用于验证 `flow.collect-site` / `flow.find-signature-path` / `flow.trace-request` 的真实效果。

### 核心问题
- 是否能给出高质量候选函数；
- 是否能建立 request → script → function 的链；
- 是否能围绕业务字段输出合适的验证计划；
- 是否能在不依赖 Legacy 主路径的情况下完成核心分析。

---

## 3.3 自动 Hook 精度维度
用于验证 `hook.generate` / `hook.inject` / `hook.data` / `flow.generate-hook` 的真实效果。

### 核心问题
- 是否命中目标候选；
- 是否命中目标字段；
- 是否命中最终关键签名点；
- 未命中时是否能自动回退；
- evidence 是否能支持下一轮重排。

---

## 3.4 token / context 维度
用于验证：
- 工具面收敛是否实际降低上下文负担；
- 响应摘要化 / artifact 外置化是否起效；
- 动态验证工具引入后是否导致上下文负担不可接受。

### 说明
当前无法在本仓库内直接给出严格 token 数值结论，因此 benchmark 应以：
- 相对对比
- 客户端实测
- 典型会话截面
为主，而不是依赖静态估算。

---

## 4. 样例集设计

## 4.1 基础样例集

建议至少准备 4 组样例：

### 样例 A：显式业务字段样例（`songmid` 类）
目标：
- 验证 V2 对显式字段定位是否稳定
- 验证 `flow.find-signature-path` 与 `flow.trace-request` 的基础候选质量

### 样例 B：派生字段样例（`vkey` 类）
目标：
- 验证最终结果字段的反向追踪能力
- 验证动态验证链是否真正提升定位质量

### 样例 C：通用 sign/token 样例
目标：
- 验证通用签名 heuristics 是否仍有效
- 验证引入字段导向后不会破坏已有通用能力

### 样例 D：高噪音 / 高混淆站点样例
目标：
- 验证 blackbox / function trace / coverage 的价值
- 验证 V2 在复杂站点上的稳定性

---

## 4.2 每个样例应记录的固定信息

- 目标站点 / 页面
- 目标请求模式
- 目标字段
- 字段角色（explicit / derived / final-signature）
- 站点噪音等级（低 / 中 / 高）
- 是否需要 stealth / captcha
- 是否存在强混淆或压缩
- 基线方式（Legacy-only / V2-only / mixed）

---

## 5. 验收指标设计

## 5.1 能力替代指标

| 指标 | 含义 |
|---|---|
| Tool Availability | V2 是否有明确一等入口 |
| Workflow Integration | 是否被 `flow.*` 消费 |
| Structured Output | 是否支持 session/artifact/evidence |
| Expert Path Preservation | 是否仍保留专家级调试路径 |
| Legacy Removability | 在当前状态下是否可删 Legacy 对应能力 |

---

## 5.2 自动逆向指标

| 指标 | 含义 |
|---|---|
| Candidate Recall | 候选函数是否能覆盖真实关键点 |
| Candidate Precision | 前几名候选是否接近真正关键点 |
| Request Correlation Quality | request → script → function 关联是否合理 |
| Validation Plan Quality | 是否给出了有效的 trace/watch/hook/breakpoint 建议 |
| Evidence Completeness | 是否形成完整证据链 |

---

## 5.3 Hook 精度指标

| 指标 | 含义 |
|---|---|
| Hook Candidate Quality | 候选 Hook 目标是否合理 |
| Hook Hit Rate | 注入后是否命中目标 |
| Target Field Observation | 是否观察到目标字段 |
| Final Write Correlation | 是否接近最终写入点 |
| Fallback Success | 未命中时是否能成功回退到下一候选 |
| Evidence Feedback Quality | Hook 结果是否能反哺排序与决策 |

---

## 5.4 迁移门槛指标

| 指标 | 含义 |
|---|---|
| Legacy Capability Coverage | 当前 Legacy 关键能力是否已在 V2 主面承接 |
| V2-only Scenario Pass Rate | V2-only 是否能通过关键样例 |
| Regression Safety | 是否未破坏既有显式字段效果 |
| Expert Validation Retention | 是否未丢失关键验证路径 |

---

## 6. Benchmark 方式设计

## 6.1 三种对比模式

### 模式 A：Legacy-only baseline
目标：
- 建立当前老能力的现实上限/下限

### 模式 B：V2-only current
目标：
- 观察当前 V2 的真实能力边界

### 模式 C：V2-after-enhancement
目标：
- 验证增强是否真正补齐关键缺口

---

## 6.2 对比粒度

建议按以下层级记录：

1. **工具层**
   - 某个工具能否完成目标动作
2. **工作流层**
   - `flow.*` 能否串起完整路径
3. **结果层**
   - 是否命中候选
   - 是否命中最终关键点
4. **证据层**
   - evidence / artifact 是否完整

---

## 6.3 输出形式

每次 benchmark 建议输出统一模板：

```md
# Benchmark Result
- Scenario:
- Target Field:
- Field Role:
- Mode: Legacy-only / V2-only / V2-enhanced
- Candidate Recall:
- Candidate Precision:
- Hook Hit Rate:
- Final Write Correlation:
- Evidence Completeness:
- Notes:
```

---

## 7. `songmid` 与 `vkey` 的验收策略差异

## 7.1 `songmid` 类验收重点

关注：
- scripts search 是否命中
- request correlation 是否稳定
- Hook 是否能快速观察到该字段

### 验收标准
- 不求动态链极复杂，但要确保 V2-only 主路径稳定可用

---

## 7.2 `vkey` 类验收重点

关注：
- 是否能从最终请求中的 `vkey` 反向追到关键写入/生成点
- 是否需要 tracer / interceptor / breakpoint / blackbox
- Hook 是否命中真正关键点而不是周边函数
- evidence 是否能帮助重排

### 验收标准
- 不要求一次命中百分百，但要求：
  - 候选更聚焦
  - 动态验证闭环已形成
  - Hook 竞争与回退机制可用

---

## 8. token / context benchmark 设计

## 8.1 为什么要单独测

当前不能只凭“工具数变少”“response 更紧凑”就断定效果提升，因为：
- 客户端实现不同
- 工具使用模式不同
- 返回数据大小差异很大

---

## 8.2 建议记录的指标

- tool list 规模
- 单轮工具调用次数
- 单次响应是否 externalize
- artifact 命中比例
- 平均对话轮数
- 大站点场景下的上下文膨胀趋势

### 说明
这些指标建议在真实 MCP 客户端中观察，不应仅靠静态文档估算。

---

## 9. 删除 Legacy 的最终验收门槛

只有当以下门槛满足时，才建议从“兼容层保留”进入“可删除”：

1. V2 动态验证工具面完整：
   - XHR breakpoint
   - Event breakpoint
   - Blackbox
   - function trace
   - interceptor
2. `flow.find-signature-path` 能输出字段导向候选和验证计划
3. `flow.trace-request` 能输出 request → function 候选链
4. `flow.generate-hook` 已支持命中验证和自动回退
5. `songmid` 样例通过
6. `vkey` 样例通过
7. 至少一个高噪音/高混淆样例通过
8. 关键 Legacy 能力映射表已清零到可接受范围

---

## 10. 可立即执行的 Benchmark 计划

## 第一轮：建立现状基线

### 动作
- 对 `songmid` 做 Legacy-only / V2-only 对比
- 对 `vkey` 做 Legacy-only / V2-only 对比
- 记录当前差距

### 目的
先知道问题到底在哪一层，不要凭感觉优化。

---

## 第二轮：现有 expert 工具接入 flow 后做对比

### 动作
- 验证 `debug.xhr` / `debug.event` / `debug.blackbox` 在 workflow 推荐链中的表现
- 验证 `inspect.function-trace`
- 验证 `inspect.interceptor`

### 目的
观察 workflow 集成后是否显著改善 `vkey` 候选定位质量。

---

## 第三轮：Hook 闭环增强后做对比

### 动作
- `hook.generate` 支持多候选
- `hook.inject` 支持注入时机
- `hook.data` 支持命中质量摘要
- `flow.generate-hook` 支持自动回退

### 目的
观察是否提升最终关键签名点命中率与稳定性。

---

## 11. 最终结论

1. **没有 benchmark，就无法严肃判断 Legacy 是否真的可以删，也无法严肃判断自动逆向增强是否真的有效。**
2. **`songmid` 与 `vkey` 必须作为两类不同代表样例，因为它们分别代表显式字段链路和派生字段链路。**
3. **V2 增强后的验收不应只看“功能有没有”，而应看：**
   - 候选质量是否提升
   - 动态验证是否更完整
   - Hook 精度是否提升
   - evidence 是否形成可回用反馈
4. **当前最重要的 benchmark 目标不是量化夸张收益，而是证明：V2 在不依赖 Legacy 主路径的情况下，已经能完成关键样例的闭环验证。**
5. **只有在关键样例通过、动态验证主面补齐、Hook 闭环增强完成之后，Legacy 才有资格进入真正删除阶段。**
