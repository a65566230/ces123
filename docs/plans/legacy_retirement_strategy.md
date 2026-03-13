# Legacy 淘汰策略（基于 V2 迁移完成度与自动逆向能力门槛）

> 本文不是讨论“Legacy 是否过时”，而是给出一套可执行的 Legacy 淘汰策略：在什么条件下，哪些能力可以直接删，哪些必须先迁移再删，哪些需要保留兼容层一段时间，哪些必须重设计后再进入 V2。本文的核心目标是避免在追求工具面收敛时，反而损失当前项目最关键的专家级动态验证与自动逆向能力。

---

## 1. 文档目标

本文回答以下问题：

1. 为什么当前还不能直接删除 Legacy；
2. 删除 Legacy 应使用什么判断标准；
3. 哪些 Legacy 能力可以直接进入淘汰序列；
4. 哪些 Legacy 能力必须先迁移到 V2；
5. 哪些能力应保留兼容层一段时间；
6. 哪些能力不适合原样迁移，而应重设计后再迁；
7. 最终什么条件下，项目才算真正具备“彻底删除 Legacy”的资格。

---

## 2. 证据边界

### 2.1 已由代码证实

- 当前默认入口为 `V2MCPServer`；
- `.env.example` 默认 `ENABLE_LEGACY_TOOLS=false`；
- Legacy 通过 `LegacyToolBridge.ts` 接入，已是兼容层；
- V2 默认工具面已覆盖主架构、主工作流、大部分基础主路径；
- Legacy 仍保留：
  - `xhr_breakpoint_*`
  - `event_breakpoint_*`
  - `blackbox_*`
  - `console_inject_*`
  - `captcha_*`
  - `stealth_*`
  - `performance_*`
  - 细粒度 page/dom/storage/capture 工具
- V2 当前可直接确认：
  - `debug.watch` 已存在；
  - `debug.xhr` / `debug.event` / `debug.blackbox` 已存在；
  - `inspect.scripts(action: 'function-tree')` 已存在；
  - `inspect.dom(action: 'all'/'text'/'xpath'/'viewport')` 已存在；
  - `analyze.deobfuscate` 已存在。

### 2.2 合理推断

- 当前 Legacy 最大价值不在基础工具，而在专家级动态验证能力；
- 当前自动逆向短板恰好与这些未完整迁入 V2 的能力高度重合；
- 过早删除 Legacy，最容易伤害 `vkey` 类最终签名点定位与自动 Hook 精度。

### 2.3 信息不足

- V2 当前是否已通过隐藏 action 接入全部高级 breakpoint 语义；
- 某些 page/dom 细粒度工具是否已在 V2 内部以未显式列出的方式存在；
- 旧 debugger session 持久化能力是否仍有实际使用价值。

因此，本文采用保守删除策略：**不因为“看起来像可以替代”就直接删除。**

---

## 3. 为什么当前不能直接删除 Legacy

## 3.1 因为当前真正未迁移的是“关键验证层”

当前 Legacy 中最重要的残留，不是：
- collect/search/understand 这类主路径基础工具

而是：
- XHR breakpoint
- Event breakpoint
- Blackbox
- function tracer
- XHR/fetch interceptor
- coverage / heap
- stealth / captcha
- 细粒度 page/dom 辅助交互

这些能力不只是“专家附加工具”，而是：
> 当前自动逆向与自动 Hook 精度提升最直接需要的验证层和辅助层。

---

## 3.2 因为 V2 已经替代了主路径，但还没有替代全部专家路径

### 已经替代的
- 架构主路径
- 工作流主路径
- 大部分基础分析与调试主路径

### 还没有完整替代的
- request-aware 动态验证
- runtime tracer/interceptor
- 高噪音站点降噪路径
- 最终结果字段的反向验证路径

### 结论
如果现在直接删 Legacy，伤害的不是“老式 collect/search”，而是：
- 精确定位关键签名点的能力
- 对 `vkey` 类问题的最后验证手段
- 专家级手工确认路径

---

## 4. 删除判断标准

建议用以下五个维度判断一个 Legacy 能力该怎么处理：

### 4.1 V2 是否已有更优实现
- 是否有明确一等工具入口
- 是否已接入 session/artifact/evidence
- 是否已进入 workflow 可消费链

### 4.2 当前差异是否仅为交互层差异
- 如果只是命名不同、交互更 grouped，但底层能力与效果已充分替代，则更适合直接进入淘汰序列

### 4.3 是否仍承载专家级调试路径
- 若当前仍依赖该能力进行精细调试/运行时验证，则不宜直接删

### 4.4 是否影响自动逆向/Hook 精度
- 若删除后会削弱 request→function→hook→verification 闭环，则必须保守处理

### 4.5 是否适合原样迁移
- 如果能力本身有价值，但 Legacy 命名/交互方式不适合 V2，就应重设计后再迁，而不是照抄

---

## 5. 四类处理策略

## 5.1 可直接删除

### 定义
V2 已有更优实现，且删除不会损失关键专家路径。

### 当前建议归入此类的能力
- `collect_code`
- `search_in_scripts`
- `understand_code`
- `detect_crypto`
- `watch_*`
- `ai_hook_generate/inject/get_data` 的主流程使用面
- 一部分基础浏览器 lifecycle 工具

### 原因
- V2 已有明确一等入口；
- V2 工具已具 session / artifact / response 优势；
- 不再需要保留旧式平铺入口作为长期主路径。

### 实施策略
- 不立即物理删除
- 先标记 deprecated
- 文档中隐藏主说明
- 回归通过后再正式移除

---

## 5.2 先迁移再删除

### 定义
V2 有近似能力或高价值承接方向，但删除会伤害专家调试路径或自动逆向精度。

### 当前建议归入此类的能力
- `xhr_breakpoint_*`
- `event_breakpoint_*`
- `blackbox_*`
- `page_click/type/hover/scroll/...`
- `page_screenshot`
- `page_get/set_cookies`
- `page_get/set_local_storage`
- 旧 debugger session 相关能力（若仍有价值）

### 原因
- V2 已有 `debug.xhr` / `debug.event` / `debug.blackbox` expert 入口，但 `flow.*` / evidence 集成仍不完整；
- 自动逆向与自动 Hook 可能依赖它们；
- 删除过早会造成工具面断层。

### 实施策略
- 先完成现有 V2 工具与 workflow 的统一接入
- 再做回归验证
- 验收后标记 deprecated
- 最后删除 Legacy 对应项

---

## 5.3 保留兼容层一段时间

### 定义
能力仍有使用价值，但不应继续长期作为主路径建设。

### 当前建议归入此类的能力
- Legacy 的整套专家级老式调用路径
- 一些仍服务老用户的 page/dom 细粒度路径
- 一些暂未完全迁移但低频使用的专家工具

### 原因
- 仍有现实价值；
- 但不应继续作为未来设计中心；
- 可通过 bridge 继续保留，减少迁移期风险。

### 实施策略
- 明确标记 compatibility-only
- 禁止新增同类 Legacy 能力
- 所有新能力一律只进 V2

---

## 5.4 需要重新设计后再迁移

### 定义
能力本身很有价值，但不适合原样复制为 V2 工具。

### 当前建议归入此类的能力
- `stealth_*`
- `captcha_*`
- `performance coverage / heap`
- `page_emulate_device/set_viewport`

### 原因
这些能力如果原样迁移：
- 会把 Legacy 的平铺交互方式带进 V2；
- 不利于 session/artifact/evidence 集成；
- 不利于 workflow 消费；
- 不利于后续自动逆向增强。

### 重设计方向
- `browser.stealth`
- `browser.captcha`
- `analyze.coverage`
- `analyze.heap`
- `browser.emulation`

---

## 6. 与自动逆向能力的关系

## 6.1 为什么淘汰策略必须服从自动逆向目标

当前项目的迁移不是纯架构清理，而是：
- 一边收敛旧工具面
- 一边强化自动逆向和自动 Hook 闭环

因此，Legacy 淘汰策略必须以“是否会伤害自动逆向能力”为上位判断标准。

---

## 6.2 `songmid` 与 `vkey` 的差异意味着什么

### `songmid`
- 更像显式业务字段
- 当前 V2 静态能力较容易命中
- 对 Legacy 动态验证能力依赖相对较弱

### `vkey`
- 更像派生字段/最终结果字段
- 更依赖 tracer / interceptor / xhr breakpoint / blackbox 等能力
- 如果先删 Legacy 而 V2 又未承接这些能力，将直接导致 `vkey` 类问题难以提升

### 结论
**`vkey` 类问题是当前判断 Legacy 是否能删除的关键试金石。**

---

## 7. Legacy 删除前必须满足的能力门槛

以下门槛若未满足，不应进入“彻底删除 Legacy”阶段：

### 门槛 1：V2 动态验证工具面齐全
至少具备：
- `debug.xhr`
- `debug.event`
- `debug.blackbox`
- `inspect.function-trace`
- `inspect.interceptor`

### 门槛 2：V2 工作流已消费这些能力
至少：
- `flow.find-signature-path` 能给出基于这些能力的验证计划
- `flow.trace-request` 能给出 request→function 候选链
- `flow.generate-hook` 能消费这些结果

### 门槛 3：Hook 闭环已打通
至少：
- 多候选 Hook 输出
- 注入时机策略
- 命中质量判定
- 自动回退
- evidence 回灌

### 门槛 4：业务样例通过
至少验证：
- 一个 `songmid` 样例
- 一个 `vkey` 样例
- 一个高噪音/高混淆站点样例

### 门槛 5：兼容路径可回滚
即使进入移除，也应保留可短期回退的 fallback 方案。

---

## 8. 可立即执行的淘汰策略

## 阶段一：建立删除白名单与红线清单

### 白名单（可进入淘汰序列）
- `collect_code`
- `search_in_scripts`
- `understand_code`
- `detect_crypto`
- `watch_*`
- 基础 debugger lifecycle 主路径

### 红线清单（当前绝不能删）
- `xhr_breakpoint_*`
- `event_breakpoint_*`
- `blackbox_*`
- `console_inject_function_tracer`
- `console_inject_xhr_interceptor`
- `console_inject_fetch_interceptor`
- `stealth_*`
- `captcha_*`
- `performance_*`

---

## 阶段二：桥接期策略

### 动作
- 在 README / docs 中明确：
  - V2 是默认主路径；
  - Legacy 为 compatibility-only；
  - 哪些能力正在迁移；
  - 哪些能力暂时必须通过 Legacy 使用。

### 禁止事项
- 不再向 Legacy 添加新能力
- 不再为 Legacy 设计新工作流
- 不再把 Legacy 作为主文档默认推荐路径

---

## 阶段三：按批次移除

### 批次 A：主路径基础能力
在 V2 回归确认后，可先对以下能力进入正式移除：
- collect/search/understand/crypto/watch 类旧入口

### 批次 B：动态验证能力
待 V2 动态验证工具面和 flow 闭环增强完成后，再移除：
- Legacy 的 `xhr_breakpoint_*` / `event_breakpoint_*` / `blackbox_*` 别名
- tracer/interceptor

### 批次 C：辅助能力
`browser.stealth` / `browser.captcha` / `analyze.coverage` 等 V2 版本现已完成，可进入删除评估：
- stealth/captcha/performance

---

## 9. 当前阶段的推荐结论

### 是否应彻底删除 Legacy？
**当前不推荐。**

### 是否值得最终全部迁移到 V2？
**值得，但迁移的是能力，不是旧工具形态。**

### 当前最关键的收尾任务是什么？
1. 跑完 V2-only acceptance 场景
2. 评估删除 Legacy tracer/interceptor/stealth/captcha/performance 别名
3. 清理仍把已落地能力写成“未迁移”的历史文档

### 当前最值得优先删除的 Legacy 能力是什么？
1. `collect_code`
2. `search_in_scripts`
3. `understand_code`
4. `detect_crypto`
5. `watch_*`

---

## 10. 最终结论

1. **Legacy 淘汰的前提不是“V2 工具数量更多”，而是“V2 已完整接住主路径 + 专家动态验证路径”。**
2. **当前 V2 已足以替代 Legacy 的主架构、主工作流与大部分基础能力，但还不足以替代 Legacy 的全部专家级动态验证能力。**
3. **如果现在直接删 Legacy，最可能退化的不是 collect/search 这类基础工具，而是自动逆向精度、自动 Hook 精度以及 `vkey` 类最终签名点定位能力。**
4. **因此当前最合理的策略是：**
   - 先淘汰已明确被 V2 替代的基础能力；
   - 再迁移动态验证关键能力；
   - 最后再整体收缩和删除 Legacy。
5. **最终 Legacy 可以消失，但前提是 V2 必须先具备完整的动态验证闭环。**
