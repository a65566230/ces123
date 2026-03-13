# JSHook Reverse Tool 优化修复总控方案

> 本文是当前阶段的母计划文档，用于统一此前多轮分析、修订与专项设计的结论。  
> 它不替代现有专项方案，而是负责定义：优先级、依赖关系、阶段闸门、验收顺序、以及哪些子方案是当前有效依据。

---

## 1. 目标

当前项目的重点已经不再是继续扩张 V2 工具面，而是：

1. 将现有 V2 运行时加固到可长期运行、可感知故障、可控速、可恢复的状态；
2. 补齐自动逆向与自动 Hook 闭环中的关键缺口，尤其是派生字段（如 `vkey`）场景；
3. 用 V2-only 验收门槛而不是工具数量，来判断是否具备 Legacy 收缩条件；
4. 在平台能力趋稳后，再清理源码形态与文档体系债务。

---

## 2. 当前收敛结论

### 2.1 当前已成立的基础判断

- V2 分层运行时骨架已经完整；
- `expert` profile 下的 V2 工具面已经覆盖绝大多数主路径与专家路径；
- Legacy 当前主要是兼容层，而不是设计中心；
- 自动逆向与自动 Hook 的核心短板，不再是“没有工具”，而是：
  - Property Hook / Event Hook 缺失或不足；
  - 候选验证闭环仍不够强；
  - 运行时执行治理仍不统一；
  - 自动故障探测与恢复状态可见性仍需补强；
  - 源码形态仍拖累长期维护。

### 2.2 当前最应继续沿用的专项文档

以下文档应作为当前实施依据继续使用：

- `docs/plans/final_converged_analysis.md` 的桌面版对应结论
- `docs/plans/comprehensive_project_analysis_reaudit.md`
- `docs/plans/cross_reference_verification_reaudit.md`
- `docs/plans/auto_hook_precision_enhancement.md`
- `docs/plans/auto_reverse_pipeline_enhancement.md`
- `docs/plans/legacy_v2_capability_matrix.md`
- `docs/plans/legacy_retirement_strategy.md`
- `docs/plans/benchmark_and_acceptance_plan.md`

### 2.3 当前不应再直接当作事实面的旧文档

以下文档如继续引用，必须通过后续修订口径约束使用：

- `docs/plans/project_analysis.md`
- `docs/plans/mcp_deep_analysis.md`
- 根目录旧版分析文档

原因不是它们完全无价值，而是其中部分结论已被后续代码与复核文档纠正。

---

## 3. 阶段路线

## 3.1 第一阶段：运行时治理加固

### 目标

把 V2 运行时做成：

- 工具不会无限挂起；
- 故障状态对调用方可见；
- 限流策略不再只散落在局部高成本路径；
- 会话在浏览器故障后具备明确恢复路径。

### 当前已落地

- `ToolExecutor` 已补充统一超时治理；
- `ToolExecutor` 已补充统一执行层限流入口（当前先落在 session-aware 执行路径）；
- 超时与限流错误已返回统一 diagnostics / nextActions；
- `browser.status` 已能透出 engine 侧的 degraded / lastFailure 状态，而不再被 session 旧状态覆盖。

### 仍需继续完成

- 将统一限流策略扩展到更完整的执行面；
- 明确不同工具的默认超时策略边界；
- 继续补强浏览器 / CDP 自动故障探测与自动恢复衔接。

### 主要代码触点

- `src/server/v2/ToolExecutor.ts`
- `src/server/v2/tools/createV2Tools.ts`
- `src/server/v2/browser/PlaywrightEngineAdapter.ts`
- `src/services/BrowserPool.ts`

---

## 3.2 第二阶段：自动逆向与 Hook 精度闭环

### 目标

解决当前最影响 `vkey` / 派生字段定位能力的核心缺口：

- Property Hook 缺失；
- Event Hook 缺失；
- Hook 命中反馈还不够像真正的排序反馈层；
- 默认复杂场景下的候选竞争仍不够自动化。

### 当前已落地

- `AIHookGenerator` 已补上 Property Hook 代码生成；
- `AIHookGenerator` 已补上 Event Hook 代码生成；
- 这两类 Hook 现在不再返回 `not yet implemented` stub。

### 当前已具备但需继续增强的基础

- `hook.inject` 已支持 `pre-init` / `runtime` / `delayed` / `auto` 注入策略；
- `hook.data(targetField)` 已具备命中质量摘要；
- `flow.generate-hook` 已具备候选竞争、source evidence 提升、autoInject 场景下的有限验证与回退；
- field-aware reverse 与 hook feedback 主链已在现有实现中具备雏形。

### 仍需继续完成

- 将多候选竞争从“显式候选优先”推进到“默认复杂场景也能自动竞争”；
- 让 Hook 命中结果更稳定地写回 evidence / rerank 体系；
- 补 AST 结构特征与 final-write-adjacent 信号，继续提升 `FunctionRanker` 外层候选排序质量。

### 主要代码触点

- `src/modules/hook/AIHookGenerator.ts`
- `src/server/v2/tools/hookBlueprints.ts`
- `src/server/v2/tools/flowBlueprints.ts`
- `src/server/v2/tools/createV2Tools.ts`

---

## 3.3 第三阶段：V2-only 验收与 Legacy 收缩

### 目标

不再靠“V2 工具数量”判断是否能删 Legacy，而是用代表性场景证明：

- V2-only 可用；
- 动态验证路径仍在；
- `songmid` 与 `vkey` 两类场景都不会退化；
- 高噪音场景仍有有效降噪与验证建议。

### 默认验收样例

- `songmid` 类显式字段样例
- `vkey` 类派生字段样例
- 高噪音站点样例

### 收缩策略

1. 先冻结 Legacy 为 compatibility-only
2. 再文档降级 Legacy
3. 再弃用别名
4. 最后才讨论物理删除 bridge / legacy handlers

### 不满足以下条件前，不进入真正删除阶段

- V2-only 样例通过
- Hook 回退 / 验证闭环通过
- 动态验证建议来自 V2 工具名
- 当前有效文档不再错误宣称现有 V2 expert 能力缺失

### 主要依据文档

- `docs/plans/benchmark_and_acceptance_plan.md`
- `docs/plans/legacy_retirement_strategy.md`
- `docs/plans/legacy_v2_capability_matrix.md`
- `docs/superpowers/specs/2026-03-12-v2-acceptance-and-legacy-contraction-design.md`

---

## 3.4 第四阶段：代码质量与文档体系收尾

### 目标

解决两个长期拖尾问题：

1. 源码形态与大文件问题；
2. 文档事实面不统一问题。

### 建议动作

- 建立单一有效文档面；
- 为过时文档增加状态标记；
- 单列 backlog 跟踪：
  - 大文件拆分
  - `@ts-nocheck` 收缩
  - 类型恢复
  - 配置一致性修复

### 说明

这一阶段重要，但不作为前三阶段的阻断条件。  
优先级应低于运行时稳定性、Hook 精度与 V2-only 验收。

---

## 4. 当前实施状态

### 已完成

- 阶段 1 的首批治理已落地：
  - `ToolExecutor` 统一超时
  - `ToolExecutor` 统一 session-aware 限流入口
  - 超时 / 限流 diagnostics 与 nextActions
  - `browser.status` 的 degraded 状态透出
  - `browser.status` / `flow.resume-session` 在 degraded 场景下会直接给出 `browser.recover` 恢复建议
- 阶段 2 的首批关键缺口已落地：
  - Property Hook 生成
  - Event Hook 生成
  - `flow.generate-hook` 在 source evidence 驱动场景下可进入默认候选竞争
  - autoInject 成功后的验证结果会自动沉淀 `hook-data` evidence
- 阶段 3 的代表性验收基线已具备：
  - `tests/integration/v2-acceptance.test.ts` 已覆盖 `songmid`
  - `tests/integration/v2-acceptance.test.ts` 已覆盖 `vkey`
  - `tests/integration/v2-acceptance.test.ts` 已覆盖高噪音 blackbox 推荐场景
  - V2-only acceptance 当前已通过
  - Legacy bridge 暴露的旧工具描述已明确标为 `compatibility-only`

### 已验证

已通过定向测试验证：

- `tests/unit/tool-executor.test.ts`
- `tests/unit/ai-hook-generator.test.ts`
- `tests/unit/analysis.test.ts`
- `tests/unit/config.test.ts`
- `tests/unit/legacy-tool-filter.test.ts`
- `tests/integration/v2-flow-extended.test.ts`
- `tests/integration/v2-acceptance.test.ts`

### 待继续推进

- 统一执行治理的进一步扩展
- 默认复杂场景下的 Hook 候选竞争进一步增强
- request/function/hook/evidence 反馈闭环继续增强
- Legacy 收缩执行与 compatibility-only 文档化

---

## 5. 下一步建议顺序

建议严格按以下顺序继续实施：

1. 继续收尾阶段 1：
   - 故障探测 / 恢复链补强
   - 统一执行治理边界明确

2. 继续推进阶段 2：
   - Hook 命中反馈回写
   - 默认复杂场景候选竞争
   - 排序器结构信号增强

3. 进入阶段 3：
   - 以 `songmid` / `vkey` / 高噪音样例做 V2-only 验收
   - 只在通过门槛后再开始 Legacy 收缩

4. 最后推进阶段 4：
   - 清理文档事实面
   - 建立长期代码质量治理 backlog

---

## 6. 一句话结论

> 当前项目已经完成了“平台化”主体建设，现在最值得投入的不是继续加工具，而是把运行时治理、Property/Event Hook、Hook 反馈闭环和 V2-only 验收真正做扎实；只有这样，Legacy 收缩才会变成低风险决策，而不是纸面迁移。
