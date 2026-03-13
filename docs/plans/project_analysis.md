# JSHook Reverse Tool — 项目问题与缺点分析

## 统计概览

| 指标 | 值 |
|---|---|
| 总源文件数 | ~80+ [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 文件 |
| `@ts-nocheck` 文件数 | **50+ 文件** (>60%) |
| 含 `sourceMappingURL` 的源文件 | **50+ 文件** |
| 最大单文件行数 | [MCPServer.ts](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts) 1385 行 / [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) 76KB |
| 测试文件数 | ~60 文件 (覆盖面尚可) |
| ESLint 禁用关键规则数 | 5 条 |

---

## 🔴 严重问题 (Critical)

### 1. 源码不是真正的 TypeScript — 编译产物回写 `src/`

> [!CAUTION]
> 超过 50 个 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 文件同时包含 `// @ts-nocheck` 和 `//# sourceMappingURL=*.js.map`，这是 **编译后的 JS 文件被重命名为 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 放入 `src/`** 的明确信号。

**影响:**
- [tsconfig.json](file:///e:/work/jshook-reverse-tool-main/tsconfig.json) 中开启了 `strict: true`、`noUnusedLocals`、`noUnusedParameters` 等严格选项，但被 `@ts-nocheck` 完全绕过，**形同虚设**
- 所有函数参数都没有类型标注（如 [constructor(config)](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts#61-104) 而非 [constructor(config: Config)](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts#61-104)），丧失了 TypeScript 的核心价值
- IDE 无法提供类型推导、自动补全、重构等功能
- `//# sourceMappingURL` 指向 [.js.map](file:///e:/work/jshook-reverse-tool-main/tests/fixtures/sourcemap/bundle.min.js.map) 文件，而 [.ts](file:///e:/work/jshook-reverse-tool-main/src/index.ts) 源文件本身不应该包含这类注释

**受影响的关键文件（部分）:**
- [V2MCPServer.ts](file:///e:/work/jshook-reverse-tool-main/src/server/V2MCPServer.ts)
- [MCPServer.ts](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts)
- [LLMService.ts](file:///e:/work/jshook-reverse-tool-main/src/services/LLMService.ts) (1270 行)
- 整个 `src/server/v2/` 目录
- 整个 `src/modules/` 目录
- 大部分 `src/utils/` 文件

---

### 2. API Key 泄露 — `.env` 文件提交到仓库

> [!CAUTION]
> `.env` 文件中包含硬编码的 API Key：`OPENAI_API_KEY=sk-proj-05uf4eqrormx32668s3tudkfqkqkty60`，并已提交到 Git 仓库。

虽然 `.gitignore` 存在，但 `.env` 已被追踪。即使现在移除，历史记录中仍然包含该密钥。需要：
1. 立即 **轮换此 API Key**
2. 从 Git 历史中清除 `.env`（使用 `git filter-branch` 或 `BFG Repo-Cleaner`）

---

### 3. `types/index.ts` 是编译产物（`.d.ts`）

[types/index.ts](file:///e:/work/jshook-reverse-tool-main/src/types/index.ts) 尾部有 `//# sourceMappingURL=index.d.ts.map`，说明它是 TypeScript 声明文件的编译结果，不是手写的类型源码。其中还存在 **重复声明** 的 `HookCondition` 接口（第 331 行和第 337 行定义了两个不同版本）。

---

## 🟠 架构问题 (Architecture)

### 4. 遗留 `MCPServer.ts` 是 1385 行的巨型文件

[MCPServer.ts](file:///e:/work/jshook-reverse-tool-main/src/server/MCPServer.ts) 包含:
- 20+ 个手动 `import` 和实例化的依赖
- 一个 **400+ 行的 `switch` 语句** 作为工具路由（`executeToolInternal`）
- 内联的工具定义（`getTools()` 方法直接定义了所有工具的 JSON Schema）

虽然 V2 架构（`V2MCPServer` + `ToolRegistry` + `ToolExecutor`）已转向更好的注册模式，但这个遗留服务器仍然留在代码中并作为 `LegacyToolBridge` 的后端，增加了维护负担。

### 5. Blueprint 文件体积过大

| 文件 | 大小 |
|---|---|
| [flowBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/flowBlueprints.ts) | **76 KB** |
| [createV2Tools.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/createV2Tools.ts) | **42 KB** |
| [browserBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/browserBlueprints.ts) | **31 KB** |
| [inspectBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/inspectBlueprints.ts) | **31 KB** |
| [debugBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/debugBlueprints.ts) | **30 KB** |
| [analyzeBlueprints.ts](file:///e:/work/jshook-reverse-tool-main/src/server/v2/tools/analyzeBlueprints.ts) | **32 KB** |

单个文件过大会导致可读性差、代码审查困难、合并冲突概率高。

### 6. 服务层文件同样臃肿

| 文件 | 大小 |
|---|---|
| [LLMService.ts](file:///e:/work/jshook-reverse-tool-main/src/services/LLMService.ts) | **49 KB** / 1270 行 |
| [StorageService.ts](file:///e:/work/jshook-reverse-tool-main/src/services/StorageService.ts) | **42 KB** / 1360 行 |

`LLMService` 混合了: OpenAI Chat Completions API、OpenAI Responses API (SSE 流解析)、Anthropic API、提示词生成、缓存管理、重试逻辑 — 应拆分为多个聚焦的类。

---

## 🟡 代码质量问题 (Code Quality)

### 7. ESLint 配置禁用了关键安全规则

```javascript
// eslint.config.mjs
'@typescript-eslint/ban-ts-comment': 'off',      // 允许 @ts-nocheck
'@typescript-eslint/no-explicit-any': 'off',      // 允许 any 类型
'@typescript-eslint/no-this-alias': 'off',        // 允许 this 别名
'@typescript-eslint/no-unsafe-function-type': 'off', // 允许不安全函数类型
'@typescript-eslint/no-unused-vars': 'off',       // 允许未使用变量
```

结合 `@ts-nocheck`，这意味着 **TypeScript 和 ESLint 的类型安全检查几乎全部被禁用**。`tsconfig.json` 中的严格设置实际上没有起到任何作用。

### 8. `any` 类型泛滥

在 `types/index.ts` 中就存在多处 `any`:
- `variableManifest: Record<string, any>` (第 423 行)
- `aiAnalysis?: any` (第 430 行)
- `breakpointInfo?: any` (第 490 行)
- `callFrames: any[]` (第 497 行)
- `value: any` (第 481 行)
- `[key: string]: any` (第 521 行)

由于 ESLint 禁用了 `no-explicit-any`，这些问题不会被报告。

### 9. 混合语言的日志和错误消息

日志消息混合使用中英文，缺乏一致性：
```typescript
// 中文
logger.info(`📂 读取图片文件: ${imageInput}`);
logger.warn(`⚠️ 当前模型 ${model} 可能不支持图片分析，建议使用...`);

// 英文
logger.info('OpenAI client initialized');
logger.error('Failed to register caches:', error);
```

建议统一为英文，或使用 i18n 方案。

### 10. 重复接口声明

```typescript
// types/index.ts 第 331 行
export interface HookCondition {
    argumentFilter?: (args: unknown[]) => boolean;
    returnFilter?: (result: unknown) => boolean;
    maxCalls?: number;
    minInterval?: number;
}

// types/index.ts 第 337 行 — 同名但不同定义！
export interface HookCondition {
    params?: unknown[];
    returnValue?: unknown;
    callCount?: number;
}
```

TypeScript 允许接口合并（declaration merging），所以这不会报错，但两个版本的字段完全不同，说明是代码管理疏忽，且合并后的接口可能造成使用混淆。

---

## 🔵 工程实践问题 (Engineering Practices)

### 11. 缺少依赖注入 / IoC 容器

`MCPServer` 构造器手动创建了 20 个模块实例并通过参数传递依赖，V2 稍好但 `ToolRuntimeContext` 仍然是手动组装。考虑引入轻量级 DI 容器。

### 12. 硬编码的默认模型名称散落各处

`gpt-5.4` 和 `claude-3-5-sonnet-20241022` 作为默认值至少出现了 **8 次**，分散在 `LLMService.ts` 的不同方法中。应提取为常量。

### 13. 技术债：遗留工具的维护负担

项目同时维护了:
- Legacy 工具系统（扁平命名，如 `browser_launch`）
- V2 工具系统（分组命名，如 `browser.launch`）
- `LegacyToolBridge` 兼容层

三套系统并存增加了测试和维护成本。

### 14. `StorageService.init()` 是异步方法但未在构造器中调用

`StorageService` 需要调用 `init()` 来初始化数据库，但这不是在构造器中自动完成的。如果忘记调用 `init()`，后续操作会抛出 "database not initialized" 错误。考虑使用工厂方法模式。

---

## ⚪ 次要问题 (Minor)

### 15. `.env.example` vs `.env` 不一致

`.env` 中有一些在 `.env.example` 中未提及的配置项，如 `OPENAI_DISABLE_RESPONSE_STORAGE`。

### 16. 过时的模型引用

`analyzeImage` 中出现了 `gpt-4-vision-preview` 和 `claude-2.1` 的判断逻辑，以及 `claude-3-opus-20240229` —— 这些模型可能已经过时。

### 17. `src/` vs `dist/` 边界模糊

由于 `src/` 中的文件内容本质是编译产物，`src/` 和 `dist/` 的边界变得模糊。真正的源码似乎不在此仓库中，或者已经丢失。

---

## 📊 优先级总结

| 优先级 | 问题 | 影响 |
|---|---|---|
| 🔴 P0 | API Key 泄露 | 安全风险，立即处理 |
| 🔴 P0 | 源码是编译产物 | 根本性的可维护性问题 |
| 🟠 P1 | 文件过大 / 巨型单文件 | 严重影响可读性和协作 |
| 🟠 P1 | ESLint 关键规则全部禁用 | 类型安全形同虚设 |
| 🟡 P2 | 重复接口 / `any` 类型泛滥 | 类型系统不可靠 |
| 🟡 P2 | 混合语言日志 | 国际化和可维护性 |
| 🟡 P2 | 遗留系统维护负担 | 长期技术债 |
| 🔵 P3 | 硬编码模型名称 | 配置管理不佳 |
| ⚪ P4 | 过时模型引用 / 小问题 | 低优先级清理 |
