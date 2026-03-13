# Legacy → V2 能力迁移矩阵（基于当前代码证据）

> 本文是 `docs/plans/legacy_v2_migration_master_plan.md` 的配套事实文档。目标不是讨论长期愿景，而是把当前工作区内 **Legacy 能力 → V2 能力** 的实际承接状态逐项拆开，明确：哪些已经替代、哪些只是部分替代、哪些仍主要停留在 Legacy、哪些当前信息不足，以及每类能力应该如何处理。

---

## 1. 文档目标

本矩阵用于支撑以下实际决策：

1. 哪些 Legacy 能力已经可以进入淘汰序列；
2. 哪些能力必须先迁移到 V2，才能避免能力断层；
3. 哪些能力不应原样复制，而应重设计为 V2 风格；
4. 哪些能力如果不先补齐，会直接影响：
   - 自动逆向能力；
   - 自动 Hook 精准度；
   - 最终关键签名点定位（尤其 `vkey` 类派生字段）；
   - 专家级动态验证路径。

---

## 2. 证据边界与标注规则

### 2.1 证据来源

本矩阵主要依据以下当前工作区内容：

- `src/index.ts`
- `src/server/V2MCPServer.ts`
- `src/server/MCPServer.ts`
- `src/server/v2/ToolRegistry.ts`
- `src/server/v2/ToolExecutor.ts`
- `src/server/v2/runtime/ToolRuntimeContext.ts`
- `src/server/v2/runtime/SessionLifecycleManager.ts`
- `src/server/v2/response.ts`
- `src/server/v2/tools/createV2Tools.ts`
- `src/services/BrowserPool.ts`
- `src/modules/hook/AIHookGenerator.ts`
- `src/modules/crypto/CryptoRules.ts`
- `src/modules/stealth/StealthScripts2025.ts`
- `src/modules/captcha/CaptchaDetector.ts`
- `README.md`
- `.env.example`
- `package.json`
- `server.json`
- `optimization_analysis.final.md`
- `optimization_analysis.md`

### 2.2 证据等级

| 标记 | 含义 |
|---|---|
| **代码证实** | 已由当前工作区代码直接确认 |
| **README/文档可见** | README 或分析文档中可见，但未完整核验全部实现细节 |
| **合理推断** | 结合代码结构、命名和现象做出的谨慎推断 |
| **信息不足** | 当前无法确认，不应写死 |

### 2.3 替代状态说明

| 状态 | 含义 |
|---|---|
| **架构已替代** | V2 已成为默认主架构，Legacy 已退居 bridge/兼容层 |
| **工作流已替代** | V2 已有更高层、更适合 Agent 的 workflow 封装 |
| **基础能力已替代** | V2 已具备主路径等价能力，但不一定完全 1:1 等价 |
| **部分替代** | V2 有近似能力，但仍缺细粒度能力、专家路径或验证闭环 |
| **尚未迁移** | 当前主要仍停留在 Legacy |
| **信息不足** | 当前无法确认 V2 是否已完整承接 |

---

## 3. 当前 V2 工具目录快照（代码证实）

以下 V2 工具名来自当前 `createV2Tools.ts` 抓取结果：

### 3.1 browser.*
- `browser.launch`
- `browser.status`
- `browser.recover`
- `browser.close`
- `browser.navigate`

### 3.2 inspect.*
- `inspect.dom`
- `inspect.scripts`
- `inspect.network`
- `inspect.runtime`
- `inspect.artifact`
- `inspect.evidence`

### 3.3 debug.*
- `debug.control`
- `debug.evaluate`
- `debug.breakpoint`
- `debug.watch`
- `debug.xhr`
- `debug.event`
- `debug.blackbox`

### 3.4 analyze.*
- `analyze.understand`
- `analyze.crypto`
- `analyze.bundle-fingerprint`
- `analyze.source-map`
- `analyze.script-diff`
- `analyze.rank-functions`
- `analyze.obfuscation`
- `analyze.deobfuscate`

### 3.5 hook.*
- `hook.generate`
- `hook.inject`
- `hook.data`

### 3.6 flow.*
- `flow.collect-site`
- `flow.find-signature-path`
- `flow.trace-request`
- `flow.generate-hook`
- `flow.reverse-report`
- `flow.resume-session`

> 当前可直接统计的 V2 工具总数为 **35 个**。这是当前能力映射的基础，不应继续沿用旧分析中“27 个 V2 工具”的说法。

---

## 4. 当前 Legacy → V2 能力迁移矩阵

## 4.1 架构 / 运行时 / 响应层

| 能力 | Legacy 侧实现 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| 默认主入口 | `MCPServer` | `V2MCPServer` | **架构已替代** | 代码证实 | Legacy 保留 bridge，继续收缩 | `src/index.ts` 默认启动 V2 |
| 工具注册与执行分层 | 大型 `switch-case` | `ToolRegistry` + `ToolExecutor` | **架构已替代** | 代码证实 | Legacy 不再扩展此类结构 | V2 已明显更优 |
| 会话生命周期 | 单实例 | `SessionLifecycleManager` | **架构已替代** | 代码证实 | Legacy 不应继续作为主会话层 | V2 为 session-first |
| 结构化响应 | 普通 text content | `response.ts` envelope | **架构已替代** | 代码证实 | Legacy 不应继续发展独立响应模型 | `ok/summary/data/evidenceIds/...` |
| artifact / evidence | 无统一模型 | `ArtifactStore` / `EvidenceStore` | **架构已替代** | 代码证实 | 新能力统一走 V2 证据模型 | 对自动逆向闭环关键 |

### 结论
这一层已经没有必要再对 Legacy 做结构性投资。后续新能力一律应进入 V2 运行时骨架。

---

## 4.2 工作流与主流程能力

| 能力 | Legacy 侧 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| 首次站点侦察 | 原子工具手动拼接 | `flow.collect-site` | **工作流已替代** | 代码证实 + README | 可淘汰 Legacy 主路径 | V2 更适合 Agent |
| 定位签名路径 | `collect_code` + `search_in_scripts` + 手工分析 | `flow.find-signature-path` | **工作流已替代** | 代码证实 + README | 保留 Legacy 仅作兼容/专家补位 | 精度仍需增强 |
| 跟踪请求链路 | 手工 network/debug/hook 拼接 | `flow.trace-request` | **工作流已替代** | 代码证实 + README | 应继续增强，不回退 Legacy 设计 | 当前仍偏“观察”，需更强关联链 |
| 生成 Hook 主路径 | `ai_hook_generate/inject/get_data` | `flow.generate-hook` + `hook.*` | **工作流已替代** | 代码证实 | Legacy 主流程面可逐步退场 | 但 Hook 闭环还需增强 |
| 生成逆向报告 | 无高层等价物 | `flow.reverse-report` | **工作流已替代** | README/文档可见 + 工具名代码证实 | 继续增强，不需保留 Legacy 等价路径 | 是 V2 明显新增能力 |
| 会话恢复 | Legacy session/save/load/export | `flow.resume-session` | **部分替代** | 代码证实 | 需对比旧 debugger session 语义后再决定是否删除旧能力 | 不宜写死完全等价 |

### 结论
工作流层已经明确以 V2 为主，Legacy 不应继续承载高层任务入口。但 V2 工作流的“动态验证闭环”仍未做强，不能把“工作流已替代”误写成“专家能力已完全替代”。

---

## 4.3 浏览器生命周期与页面基础能力

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| 启动浏览器 | `browser_launch` | `browser.launch` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 对应主路径 | V2 还支持 recover/status |
| 浏览器状态 | `browser_status` | `browser.status` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| 关闭浏览器 | `browser_close` | `browser.close` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| 浏览器恢复 | 无明显对应 | `browser.recover` | **V2 新增** | 代码证实 | 新能力保留在 V2 | -- |
| 页面导航 | `page_navigate` | `browser.navigate` | **基础能力已替代（主路径）** | 代码证实 | 可进入 Legacy 淘汰列表 | 但 back/forward/reload 等是否 100% 等价需进一步核验 |
| reload/back/forward | `page_reload/back/forward` | `browser.navigate`？ | **信息不足** | 信息不足 | 先保留 Legacy，待补 capability matrix 细项后再决策 | 不要写死已完全替代 |

### 结论
浏览器生命周期主路径已被 V2 承接；页面导航主路径基本被承接，但 back/reload/forward 的细语义不宜在当前阶段写成完全等价。

---

## 4.4 细粒度页面交互 / DOM / 存储 / 截图

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| DOM 查询 / 结构 | `dom_query_selector` / `dom_get_structure` 等 | `inspect.dom` | **基础能力已替代（主路径）** | 代码证实 | 保持 V2 grouped 设计 | 细粒度 action 仍需逐项核验 |
| DOM 多结果查询 | `dom_query_all` | `inspect.dom(action: 'all')` | **基础能力已替代** | 代码证实 | 可纳入 Legacy 收缩范围 | `all` action 已公开 |
| find by text / xpath / viewport | `dom_find_by_text` / `dom_get_xpath` / `dom_is_in_viewport` | `inspect.dom(action: 'text'/'xpath'/'viewport')` | **基础能力已替代（主路径）** | 代码证实 | 统一走 `inspect.dom` grouped 入口 | `clickable/style` 也已存在 |
| page click/type/hover/scroll | `page_click/type/hover/scroll` | `browser.interact` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | grouped action 已承接主路径 |
| press_key / select | `page_press_key` / `page_select` | `browser.interact` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | 通过 grouped action 统一承接 |
| screenshot | `page_screenshot` | `browser.capture` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | screenshot 已迁入 grouped browser 工具 |
| cookies | `page_set/get/clear_cookies` | `browser.storage` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | grouped cookies 已承接 |
| localStorage | `page_get/set_local_storage` | `browser.storage` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | local/session storage 已 grouped 承接 |
| viewport/device emulate | `page_set_viewport` / `page_emulate_device` | 未见 V2 一等工具 | **尚未迁移** | 代码证实（Legacy 有）+ V2 信息不足 | 设计 `browser.profile` / `browser.emulation` | 应重设计后迁移 |

### 结论
这一块现在可以更准确地表述为：**V2 已承接 DOM 查询主路径，并已补齐 page 交互、storage、capture 这类专家级 grouped 工具。**

---

## 4.5 脚本收集 / 搜索 / 函数树 / 运行时检查

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| 收集站点脚本 | `collect_code` | `flow.collect-site` + `inspect.scripts` | **工作流已替代 / 基础能力已替代** | 代码证实 | Legacy 主路径可淘汰 | V2 还有 session/artifact 优势 |
| 搜索脚本 | `search_in_scripts` | `inspect.scripts(action: 'search')` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | V2 支持分页、worker search |
| 列表 / 源码获取 | `get_all_scripts` / `get_script_source` | `inspect.scripts(action: 'list'/'source')` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| function tree | `extract_function_tree` | `inspect.scripts(action: 'function-tree')` | **基础能力已替代** | 代码证实 | 修正旧文档错误，不应只写“部分替代” | 当前代码已明确存在 `function-tree` action |
| runtime eval | `page_evaluate` / `debugger_evaluate_global` | `inspect.runtime` + `debug.evaluate` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 对应主路径 | -- |

### 结论
这条链路是目前替代完成度最高的区域之一，适合优先进入 Legacy 收缩范围。

---

## 4.6 调试基础能力

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| enable/disable debugger | `debugger_enable/disable` | `debug.control(action: enable/disable)` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| pause/resume/stepInto/stepOver/stepOut | `debugger_pause/resume/step_*` | `debug.control` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| 普通断点 | `breakpoint_set/remove/list/clear` | `debug.breakpoint` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| pause on exception | `breakpoint_set_on_exception` | `debug.breakpoint(action: setOnException)` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| evaluate | `debugger_evaluate/evaluate_global` | `debug.evaluate` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| watch | `watch_add/remove/list/evaluate_all/clear_all` | `debug.watch` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | 当前 V2 已明确承接 |

### 结论
基础调试主路径已经明显 V2 化。后续真正需要投入的是“高级断点 / 动态追踪 / 验证闭环”，而不是重复建设基础 debug 控制面。

---

## 4.7 专家级调试与动态验证能力

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| XHR breakpoint | `xhr_breakpoint_*` | `debug.xhr` | **基础能力已替代（专家入口）** | 代码证实 | 重点从“补工具”改为“接入 flow 与证据闭环” | README、catalog、集成测试均可见 |
| Event breakpoint | `event_breakpoint_*` | `debug.event` | **基础能力已替代（专家入口）** | 代码证实 | 继续增强 workflow/evidence 集成后再删 Legacy 别名 | `core` profile 默认隐藏该专家入口 |
| Blackbox | `blackbox_*` | `debug.blackbox` | **基础能力已替代（专家入口）** | 代码证实 | 重点转为候选降噪与 `flow.*` 联动 | 当前已是独立 grouped 工具 |
| function tracer | `console_inject_function_tracer` | `inspect.function-trace` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | 现已进入 V2 主路径 |
| XHR interceptor | `console_inject_xhr_interceptor` | `inspect.interceptor` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | 现已进入 V2 主路径 |
| fetch interceptor | `console_inject_fetch_interceptor` | `inspect.interceptor` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | grouped fetch/xhr 承接 |
| script monitor | `console_inject_script_monitor` | 未见 V2 一等工具 | **尚未迁移** | 代码证实 | 重新设计后迁移 | 可作为动态脚本发现工具 |

### 结论
这组能力现在已经进入 V2 一等工具面。当前剩余工作不再是“补工具”，而是验证何时可以安全收缩 Legacy 别名。

---

## 4.8 Hook / 自动 Hook 相关能力

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| Hook 生成 | `ai_hook_generate` | `hook.generate` + `flow.generate-hook` | **工作流已替代 / 基础能力已替代** | 代码证实 | Legacy 主路径可淘汰 | V2 结合 `AIHookGenerator` 更强 |
| Hook 注入 | `ai_hook_inject` | `hook.inject` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | 但需增强注入时机策略 |
| Hook 数据读取 | `ai_hook_get_data` | `hook.data` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | 但需增强命中判定和反馈 |
| Hook 管理（list/clear/toggle/export） | Legacy 有多项管理命令 | 当前 V2 仅显式看到 `hook.generate/inject/data` | **部分替代 / 信息不足** | 代码证实 + 信息不足 | 先核验 V2 是否已有隐藏 action；否则需扩展 `hook.*` | 不宜轻率删除 Legacy 全部管理命令 |
| anti-debug hook | Legacy/skill 侧存在类似需求 | V2 未见明确入口 | **信息不足** | 信息不足 | 视场景决定是否进入 V2 | 非当前第一优先级 |

### 结论
Hook 主流程已迁入 V2，但“自动 Hook 精准度”所依赖的动态验证闭环还没有完成，因此 Hook 相关 Legacy 不能只按“已有 `hook.generate`”就草率删除。

---

## 4.9 反混淆 / 代码理解 / 加密分析

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| understand code | `understand_code` | `analyze.understand` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| detect crypto | `detect_crypto` | `analyze.crypto` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | 底层 `CryptoRules.ts` 明确存在 |
| detect obfuscation | `detect_obfuscation` | `analyze.obfuscation` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |
| deobfuscate / advanced_deobfuscate | `deobfuscate` / `advanced_deobfuscate` | `analyze.deobfuscate` | **基础能力已替代** | 代码证实 | 修正旧文档中“缺失 V2 入口”的表述 | 当前 V2 已有一等工具名 |
| AST 优化、JSVMP、Packer 专项能力 | Legacy/modules 中可能存在更多专项实现 | V2 是否已有专门能力当前无法完全确认 | **信息不足** | 信息不足 | 需要单独 capability scan | 不应草率下结论 |

### 结论
当前 V2 已经具备分析主路径的一等入口。这里的重点不是“有没有 analyze.*”，而是后续如何把分析结果更好地接到动态验证与 Hook 闭环中。

---

## 4.10 网络 / 运行时检查

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| 网络请求查看 | `network_get_requests` | `inspect.network` | **基础能力已替代（主路径）** | 代码证实 | 可淘汰 Legacy 主路径 | V2 还有 artifact 外置化 |
| response body / stats | `network_get_response_body` / `network_get_stats` | `inspect.network` | **部分替代 / 基本替代** | 代码证实 | 先做回归验证，再删除 Legacy | 当前主路径已被承接 |
| 运行时表达式检查 | `page_evaluate` / `debugger_evaluate_global` | `inspect.runtime` / `debug.evaluate` | **基础能力已替代** | 代码证实 | 可淘汰 Legacy 主路径 | -- |

### 结论
网络与运行时观察主路径已 V2 化，但还没有进入“请求到关键函数链构建器”的阶段，这也是 `flow.trace-request` 后续增强重点。

---

## 4.11 Stealth / Captcha / Performance 等辅助能力

| 能力 | Legacy 工具 | V2 对应 | 当前状态 | 证据等级 | 处理建议 | 备注 |
|---|---|---|---|---|---|---|
| stealth inject / set UA | `stealth_inject` / `stealth_set_user_agent` | `browser.stealth` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | 已形成 grouped browser 工具 |
| captcha detect / wait / config | `captcha_detect/wait/config` | `browser.captcha` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | session 级 grouped config 已承接 |
| coverage | `performance_start/stop_coverage` | `analyze.coverage` | **基础能力已替代（专家入口）** | 代码证实 | 可进入 Legacy 收缩评估 | 已转为逆向导向热路径工具 |
| heap snapshot | `performance_take_heap_snapshot` | 未见 V2 一等工具 | **尚未迁移** | 代码证实 | 重新设计为 `analyze.heap` | 不一定是当前第一优先级 |
| page performance | `page_get_performance` | 未见 V2 一等工具 | **尚未迁移** | 代码证实 | 视实际价值决定是否合并到 `analyze.coverage` 或 `browser.performance` | -- |

### 结论
这一块已经不应继续标注为“未迁移”。当前更合理的状态是：V2 已有 grouped 能力，Legacy 是否删除取决于收缩窗口和兼容策略。

---

## 5. 自动逆向 / 自动 Hook 关联优先级矩阵

| 能力 | 对自动逆向精度影响 | 对自动 Hook 精度影响 | 对 `vkey` 类派生字段影响 | 当前建议优先级 |
|---|---|---|---|---|
| `debug.watch` | 中 | 中 | 中 | 已在 V2，强化联动即可 |
| XHR breakpoint | 高 | 高 | 高 | **P0** |
| Event breakpoint | 中 | 中 | 中 | **P1** |
| Blackbox | 高 | 高 | 高 | **P0** |
| function tracer | 极高 | 极高 | 极高 | **P0** |
| XHR/fetch interceptor | 极高 | 高 | 极高 | **P0** |
| coverage / 热路径分析 | 高 | 中 | 高 | **P1** |
| stealth / captcha | 低（直接）/高（可达性） | 低（直接）/高（前置条件） | 中 | **P2** |
| page/dom 细交互 | 中 | 中 | 中 | **P1** |

### 结论
如果目标是提升“全自动逆向 + 自动 Hook + 最终签名点定位”，最应该优先迁入 V2 的不是截图、cookie 或 UI 交互，而是：

1. **function tracer**
2. **XHR / fetch interceptor**
3. **XHR breakpoint**
4. **Blackbox**

这些能力最可能带来数量级效果提升，但当前**无法直接量化**提升倍数，必须通过后续 benchmark 验证。

---

## 6. 建议的处理优先级（可直接用于排期）

### P0：必须优先落地，否则不能谈删 Legacy
- 将 `debug.xhr` 接入 `flow.trace-request` / `flow.generate-hook`
- 将 `debug.blackbox` 接入 `flow.find-signature-path` 候选降噪
- `inspect.function-trace`
- `inspect.interceptor`
- `flow.find-signature-path` 的字段导向增强
- `flow.trace-request` 的候选链增强
- `flow.generate-hook` 的命中验证与自动回退增强

### P1：应尽快补齐，否则 V2 替代不完整
- 将 `debug.event` 接入 workflow/evidence 联动
- `browser.interact`
- `browser.capture`
- `browser.storage`
- `analyze.coverage`
- 将 evidence/artifact 从“沉淀层”提升为“反馈层”

### P2：可在主闭环稳定后推进
- `browser.stealth`
- `browser.captcha`
- `analyze.heap`
- `browser.profile` / `browser.emulation`

---

## 7. 当前矩阵驱动下的删除门槛

只有当以下条件同时满足时，才建议进入“Legacy 实质删除”阶段：

1. P0 能力已全部进入 V2；
2. `songmid` 场景能稳定走 V2-only 主路径；
3. `vkey` 场景能通过 V2-only 路径完成候选发现 + 动态验证 + Hook 验证；
4. Legacy 中剩余能力仅剩少数边角兼容项；
5. benchmark / 回归验证结果通过。

---

## 8. 最终结论

1. **当前项目已经完成了 Legacy → V2 的主架构、主工作流和大部分基础主路径替代。**
2. **当前还不能说 V2 已完整替代 Legacy。真正缺的不是“基础能力”，而是“专家级动态验证与运行时追踪能力”的 V2 主面承接。**
3. **`debug.watch`、`inspect.scripts(function-tree)`、`analyze.deobfuscate` 等能力已在 V2 中存在，后续文档应避免继续误写为“待迁移缺口”。**
4. **此前最关键的迁移缺口已完成；当前焦点应转向 Legacy 收缩与 V2-only acceptance。**
5. **如果目标是提升自动逆向、自动 Hook 和 `vkey` 类最终签名点定位能力，应把迁移重点从“继续堆静态分析”转向“把动态验证链条完整纳入 V2 工作流”。**
