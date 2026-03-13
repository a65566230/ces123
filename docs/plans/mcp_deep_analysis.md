# MCP 稳定性、性能与自动逆向能力分析

## 一、MCP 服务稳定性

### 🔴 浏览器崩溃无自动恢复

[BrowserPool.ts](file:///e:/work/jshook-reverse-tool-main/src/services/BrowserPool.ts) 管理浏览器实例池，但存在以下问题：

| 问题 | 详情 |
|---|---|
| **无心跳检查** | 没有定时检测浏览器进程是否存活的机制。当 Chromium 进程崩溃或被 OOM Killer 杀掉后，`this.browser` 引用变成了僵尸对象 |
| **无自动重连** | `browser.on('disconnected')` 事件未被监听，浏览器断连后所有后续工具调用都会失败 |
| **LRU 驱逐无保护** | 当达到 `maxContexts` (默认 8) 时，直接按 `lastUsedAt` 驱逐最老的会话，不考虑该会话是否有活跃断点或正在进行的调查 |
| **页面崩溃静默忽略** | [closeSession](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/SessionLifecycleManager.ts#308-319) 中 `page.close().catch(() => undefined)` 吞掉所有错误，崩溃信息对调用者不可见 |

**影响**: 在对复杂网站进行长时间逆向分析时，浏览器崩溃是高概率事件。当前系统无法自动恢复，需要 AI 代理或用户手动重建整个会话。

---

### 🔴 工具执行无超时控制

[ToolExecutor.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts) 核心执行逻辑只有 30 行：

```javascript
async execute(name, args) {
    const descriptor = this.registry.get(name);
    if (!descriptor) {
        return errorResponse(`Unknown tool: ${name}`, new Error('Tool is not registered'));
    }
    try {
        if (this.runtime.ready) {
            await this.runtime.ready;
        }
        return await descriptor.execute(args, { runtime: this.runtime, descriptor });
    } catch (error) {
        return errorResponse(`Tool ${name} failed`, error);
    }
}
```

**缺失**:
- ❌ **无执行超时** — 一个工具（如 `flow.collect-site` 在慢速网站上）可以无限期阻塞
- ❌ **无取消机制** — 没有 `AbortController` 或 `CancellationToken`
- ❌ **无并发控制** — 多个工具可以同时操作同一个浏览器页面，产生竞态条件
- ❌ **无速率限制执行** — [ToolRateLimiter](file:///e:/work/jshook-reverse-tool-main/src/services/ToolRateLimiter.ts#6-49) 存在但 [ToolExecutor](file:///e:/work/jshook-reverse-tool-main/src/server/v2/ToolExecutor.ts#5-32) 从未调用 [check()](file:///e:/work/jshook-reverse-tool-main/src/services/ToolRateLimiter.ts#16-40)

---

### 🟠 会话恢复是手动的

[SessionLifecycleManager.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/SessionLifecycleManager.ts) 有 [recoverSession()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/SessionLifecycleManager.ts#206-252) 方法，设计考虑了快照恢复、引擎切换、监控状态还原等——这是架构上的亮点。但是：

- 恢复 **只能由调用方手动触发**，不会在异常时自动触发
- [buildSession()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/SessionLifecycleManager.ts#94-175) 中每次创建 **新的 LLMService 实例**（第 96 行），意味着每个会话都独立初始化 API 客户端，无法共享连接池
- 会话健康状态（`ready` / `degraded` / `recovering` / `closed`）有定义但 **未被 flow 工具自动检查**

---

### 🟠 CDP 会话断连无自动恢复

[DebuggerManager.ts](file:///e:/work/jshook-reverse-tool-main/src/modules/debugger/DebuggerManager.ts) 通过 CDP 与浏览器交互，但：

- 未监听 [CDPSession](file:///e:/work/jshook-reverse-tool-main/src/modules/debugger/DebuggerManager.ts#34-40) 的 `disconnected` 事件
- 如果页面导航或崩溃导致 CDP 断连，所有后续 `cdpSession.send()` 调用抛出异常，无自动重连
- [waitForPaused()](file:///e:/work/jshook-reverse-tool-main/src/modules/debugger/DebuggerManager.ts#467-485) 只有单一超时（默认 30s），在大型混淆代码中可能不够

---

### 🟡 进程信号处理

[index.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 注册了 `SIGINT`/`SIGTERM`/`uncaughtException`/`unhandledRejection` 但：
- `uncaughtException` 和 `unhandledRejection` 都直接 `process.exit(1)`，无法实现优雅降级
- 没有超时保护的关闭序列（`server.close()` 可能永远挂起）

---

## 二、性能问题

### 🔴 速率限制器存在但未生效

```typescript
// ToolRateLimiter.ts — 有实现
public check(key: string): { allowed: boolean; ... }

// ToolExecutor.ts — 但从未调用 check()
async execute(name, args) {
    // 直接执行，无速率检查
    return await descriptor.execute(args, { ... });
}
```

这意味着如果 AI 代理在短时间内发出大量工具调用，系统无法限流，可能导致浏览器或 LLM API 过载。

### 🟠 脚本解析性能瓶颈

`FunctionRanker.rank()` 对每个脚本进行 **完整的 Babel AST 解析**：
```javascript
const ast = parser.parse(String(code || ''), {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
});
```

在 `flow.trace-request` 中，这对 **最多 40 个脚本** 逐一执行（第 675 行），对于大型网站（如抖音有 数十个 100KB+ 的脚本），这会产生显著的延迟。**无缓存机制**，相同脚本重复解析。

### 🟠 响应序列化无流式传输

[response.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/response.ts) 的 [toToolResponse()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/response.ts#24-35) 始终将整个 envelope 序列化为 JSON 字符串。对于大型响应（接近 24KB 的内联限制），这是一次性内存消耗。虽然有 [maybeExternalize()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/response.ts#93-115) 在超过阈值时将数据转为 artifact 引用，但 MCP 协议本身不支持流式工具响应，这限制了大数据场景。

### 🟡 数据库维护间隔过长

[ToolRuntimeContext](file:///e:/work/jshook-reverse-tool-main/src/server/v2/runtime/ToolRuntimeContext.ts#15-77) 中 SQLite 维护定时器每 **12 小时** 执行一次，而 [StorageService](file:///e:/work/jshook-reverse-tool-main/src/services/StorageService.ts#158-1360) 中的 VACUUM/ANALYZE 只在 **首次运行 7 天后** 才执行。在高频逆向分析场景中，数据库碎片可能更早出现。

---

## 三、自动逆向能力

### 🔴 函数排名完全基于关键词匹配

[FunctionRanker.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts) 的核心排名逻辑：

```javascript
for (const [pattern, reason, weight] of [
    [/sign|signature|token|nonce|timestamp/i, 'request-signing-keywords', 5],
    [/crypto|encrypt|decrypt|hmac|sha|md5/i,  'crypto-keywords',          5],
    [/fetch|xmlhttprequest|authorization/i,    'network-keywords',         4],
    [/eval|Function\(/i,                       'dynamic-execution',        2],
]) {
    if (pattern.test(preview)) { score += weight; }
}
```

**问题**:
- 仅匹配函数体的 **前 240 字符**，大型函数的关键逻辑可能在末尾
- **纯静态分析** — 不利用运行时信息（如函数是否实际被调用、调用频率）
- **无模糊匹配** — 混淆后的代码中变量名通常是 `a`, `b`, `c`，完全匹配不到任何关键词
- **无加权组合** — 同时命中 `sign` 和 `crypto` 的函数应该得到超线性加分，但当前是简单累加
- **无 AST 结构分析** — 不检查参数数量、返回值类型、控制流复杂度等结构特征

### 🔴 Property Hook 和 Event Hook 未实现

```typescript
// AIHookGenerator.ts
generatePropertyHook(request, _hookId) {
    const code = `// Property Hook not yet implemented for: ${request.description}`;
    // ...
}
generateEventHook(request, _hookId) {
    const code = `// Event Hook not yet implemented for: ${request.description}`;
    // ...
}
```

对于逆向分析来说，Property Hook（如 `Object.defineProperty` 拦截）是 **观测值计算路径的核心能力**，缺失它意味着无法自动追踪 `vkey` 等派生字段的赋值过程。

### 🟠 签名候选发现依赖静态关键词扫描

`flow.find-signature-path` 和 `flow.trace-request` 中的候选函数发现逻辑：

1. 收集脚本清单（最多 40 个）
2. 对每个脚本用关键词列表搜索（`sign`, `signature`, `token`, `nonce`, `timestamp` + 用户提供的 URL 模式和目标字段名）
3. 用 [FunctionRanker](file:///e:/work/jshook-reverse-tool-main/src/server/v2/analysis/FunctionRanker.ts#11-81) 对匹配脚本中的函数打分
4. 基于分数排序返回候选

**缺陷**:
- 对混淆代码（变量名已被压缩）效果极差
- 不利用 **运行时覆盖率数据**（虽然 [getCoverageBoostMaps()](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#48-62) 存在，但调用路径不明确）
- `flow.trace-request` 中 [buildTraceCorrelation](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#667-778) 的候选发现 **不与请求拦截器结果交叉验证** — 即不确认候选函数是否真的参与了目标请求的构建
- 关键词硬编码，无法适应非加密签名类场景（如 `vkey` 这种加密播放密钥）

### 🟠 Hook 验证闭环不完整

`flow.generate-hook` 有验证能力（[validateInjectedHookCandidate](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts#626-666)），但：
- 验证只检查 `window.__aiHooks` 中是否有记录，**不自动重试其他候选**
- 当返回 `no-hit` 时，需要 AI 代理手动决定下一步，系统不会自动回退到下一个候选
- 没有 **自动化的候选遍历 + 验证循环**（hook → 触发 → 验证 → 如不命中则尝试下一候选）

### 🟠 LLM 辅助生成 Hook 的可靠性

`AIHookGenerator.planHookRequest()` 中 LLM 调用：
```javascript
const response = await this.llm.chat(messages, { temperature: 0.1, maxTokens: 600 });
const match = response.content.match(/\{[\s\S]*\}/);
if (match) {
    const parsed = JSON.parse(match[0]);
}
```

- 使用正则从 LLM 输出中提取 JSON — **脆弱**，如果 LLM 输出包含代码块或多个 JSON 对象会失败
- `catch (_error)` 吞掉所有 LLM 错误并静默回退到 `fetch` 捕获 — 用户无法知道 LLM 计划失败了
- `maxTokens: 600` 可能对复杂场景不够

### 🟡 评分体系过于精密但缺乏验证

[flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) 中的评分系统非常细致（如 `1.02 + evidenceBoost + finalWriteBoost + 0.18`），但：
- 这些数字看起来是 **手动调优** 的，没有通过基准测试验证
- 不同类型证据的加权（`request-trace: 0.42`, `signature-path: 0.34`）缺乏理论依据
- 分数累加可能导致 **排名反转** — 一个弱证据的合并信号可以超过一个强独立证据

---

## 📊 总结评分

| 维度 | 评级 | 简评 |
|---|---|---|
| **MCP 协议稳定性** | ⭐⭐⭐ | 基本的请求/响应流程稳定，但缺少超时、取消、速率限制 |
| **浏览器运行时稳定性** | ⭐⭐ | 无崩溃恢复、无心跳、CDP 断连不自动重连 |
| **会话管理** | ⭐⭐⭐⭐ | 快照恢复、健康状态建模完善，但仅手动触发 |
| **工具执行安全** | ⭐⭐ | 无超时、无并发控制、速率限制器未生效 |
| **自动签名发现** | ⭐⭐⭐ | 对未混淆代码有效，对混淆代码性能差 |
| **Hook 生成** | ⭐⭐⭐ | function/object-method/fetch/xhr 4 种可用，property/event 缺失 |
| **验证闭环** | ⭐⭐ | 有验证框架但无自动重试循环 |
| **性能** | ⭐⭐⭐ | 有缓存和紧凑化机制，但 AST 解析无缓存，速率限制未生效 |

---

## 🎯 优先修复建议

| 优先级 | 改进项 | 预期收益 |
|---|---|---|
| P0 | 在 ToolExecutor 中添加执行超时 (`AbortController` + `Promise.race`) | 防止工具无限挂起 |
| P0 | 监听 `browser.on('disconnected')` 实现自动重连 | 长时间分析的可靠性 |
| P1 | 在 ToolExecutor 中调用 `ToolRateLimiter.check()` | 防止过载 |
| P1 | 实现 Property Hook（`Object.defineProperty` 拦截） | 关键的派生值追踪能力 |
| P1 | FunctionRanker 增加运行时覆盖率加权 | 显著提升混淆代码的候选发现 |
| P2 | AST 解析结果缓存 | 重复分析性能提升 |
| P2 | 自动化 Hook 候选遍历验证循环 | 减少 AI 代理手动决策负担 |
| P2 | CDP 断连自动重连 + 断点恢复 | 调试场景稳定性 |
| P3 | 会话健康状态自动检查 | 在 flow 工具执行前自动恢复降级会话 |
| P3 | LLM Hook 计划的 JSON 提取改用结构化输出 | 提升 LLM 辅助的可靠性 |
