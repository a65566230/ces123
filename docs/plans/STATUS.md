# 文档状态总览

> 本文件用于标记 `docs/plans/` 下哪些文档是当前有效事实面，哪些文档只适合作为历史参考。  
> 使用原则：**代码与配置事实优先于任何文档；当前有效文档优先于历史分析文档。**

---

## 当前有效

以下文档可作为当前阶段的主要依据继续使用：

- `optimization_repair_master_plan.md`
  - 当前母计划
  - 用于统一阶段路线、依赖关系、闸门与推进顺序
- `comprehensive_project_analysis_reaudit.md`
  - 当前项目事实面修订版
- `cross_reference_verification_reaudit.md`
  - 对认证文档质量的修订版
- `auto_hook_precision_enhancement.md`
  - Hook 精度增强子方案
- `auto_reverse_pipeline_enhancement.md`
  - 自动逆向主流程增强子方案
- `legacy_v2_capability_matrix.md`
  - Legacy → V2 能力映射事实面
- `legacy_retirement_strategy.md`
  - Legacy 收缩与删除门槛策略
- `benchmark_and_acceptance_plan.md`
  - V2-only 验收与 benchmark 基线

---

## 当前可用但需结合代码复核

以下文档仍有参考价值，但使用时应先对照当前代码：

- `v2_dynamic_debug_and_verification_surface.md`
- `legacy_v2_migration_master_plan.md`
- `v2_workflow_integration_pr_plan.md`
- `field_oriented_signature_location.md`

它们更适合作为设计背景、迁移脉络和补充说明，而不是单独作为最终事实面。

---

## 历史参考

以下文档已不应直接作为当前事实面的主依据：

- `project_analysis.md`
- `mcp_deep_analysis.md`

原因：

- 其中部分结论已被后续代码与复核文档修正；
- 若继续引用，必须同时参考当前有效文档。

---

## 使用建议

1. 先看 `optimization_repair_master_plan.md`
2. 再按主题跳转：
   - Hook 精度：`auto_hook_precision_enhancement.md`
   - 自动逆向：`auto_reverse_pipeline_enhancement.md`
   - Legacy 收缩：`legacy_retirement_strategy.md`
   - 能力映射：`legacy_v2_capability_matrix.md`
   - 验收基线：`benchmark_and_acceptance_plan.md`
3. 遇到结论冲突时，以当前代码和配置为准

---

## 一句话说明

> 当前 `docs/plans/` 已形成“母计划 + 子方案 + 事实修订 + 验收基线”的结构，后续新文档应优先接到这套结构里，而不是再新增互相竞争的“终稿分析”。
