# Executive Chat (v4.0) Execution Telemetry 接入计划 (Langfuse)

**状态:** M1–M4 已交付 | **目标版本:** v4.x | **日期:** 2026-04-23 | **修订:**
- 2026-04-23（初版）M1 落地：`server/utils/tracer.js`、`chatService` 入口 Trace、`runFunctionCalling` 的 `FC_Loop` + 每轮 `DeepSeek_FC_Step`；M2/M3/M4/M5 待办。
- 2026-04-23（第 2 次修订）按 Langfuse 官方 Skill 审计 M1 缺口，合并 M2/M3/M4 为单次 PR。
- 2026-04-23（第 3 次修订）收紧实现坑（流式 usage、返回体对象化、SHA1 前 12 位 argsHash、PROMPT_VERSION 常量）。
- 2026-04-23（最终交付）M2–M4 完整落地：补齐了 `regenerate` 入口 Trace、所有 LLM 节点的 `usage` 采集、全路径 `Tool_<name>` span、`app.js` 优雅退出、以及 `11-EXECUTIVE-CHAT-REQUEST-FLOW.md` 遥测对照表的同步。
- 2026-04-23（第 4 次修订）实施期发现盲点：`generateTextDeepSeek` / `generateTextDeepSeekStream` 除 Executive Chat 的 3 个调用点外，还被 **5 处非 Executive Chat 调用点**（`agent/skills/generateNudge.js`、`parseTask.js`、`generateTaskDesc.js`、`services/taskSmartPublishService.js`、`services/dashboardInsightService.js`）按「纯字符串消费」使用。若按第 3 次修订「一次性改对象返回」，这 5 处将被动卷入非必要改动。故把 §3.6.3 改为 **`options.returnUsage: true` 显式 opt-in**：默认保持 `string` 返回；Executive Chat 侧 3 处显式传 `returnUsage: true` 拿到 `{ content, usage, model }`。其余 5 处非 Executive Chat 调用点零改动。

## 1. 背景与目标 (Background & Objective)
当前 Executive Chat 在 `function_calling` 循环中的诸多中间步骤（如模型生成的中间推理、`tool_calls` 以及 `tool` 执行结果）仅在内存数组中流转，并未持久化到 `chat_messages` 表中。这虽然保持了最终用户对话界面的整洁，但导致我们在调试、压测以及优化 Agent 框架时，犹如「黑盒」操作，极难排查为何模型选错了工具、为何产生了不可控的意图、为何某一轮 LLM/工具异常慢。

**本方案目标：**
引入一套成熟的、专门针对 LLM 的链路追踪（Observability & Tracing）系统 —— **Langfuse**，以最小的侵入性代码修改，实时采集并可视化 [`11-EXECUTIVE-CHAT-REQUEST-FLOW.md`](../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md) §2「总览时序」中的各个环节（入口、历史加载、执行模式分类、语义监工、FC 循环、routing 降级、工具执行、SSE 生命周期、异步记忆抽取等），并支撑后续的 Bad Case 回溯、成本监控与模型评估。

## 2. 为什么选择 Langfuse
- **可视化瀑布流**：把 §2 中抽象的时序变成真实的 UI，直观展现一条消息在多个 Span/Generation 中的流转与耗时。
- **LLM 原生计量**：`generation` 节点可记录 `model`、`usage`（prompt/completion tokens）、`firstTokenLatency`、`cost` 等关键字段。
- **无痛接入**：提供 Node.js SDK，无需改动现有 SQLite Schema（但推荐 **可选** 回链见 §5.5）。
- **开源可私有化**：支持云端或通过 Docker 在公司内网部署（用于 PII / 业务数据隔离，见 §6）。

---

## 3. 落地实施步骤 (Implementation Steps)

### 3.1 依赖（M1 已完成，本 PR 不改）
- 当前 `TOT_backend/server/package.json` 已锁 `"langfuse": "^3.38.20"`（JS/TS SDK **v3**）。
- **本 PR 不升级到 v4/v5**，理由与范围控制见 §8.1；v3 的 `trace/span/generation` API 仍可用于本计划的全部埋点。
- 新增依赖：无（`crypto` 为 Node 内置，见 §5.3 `argsHash` 实现）。

### 3.2 环境变量配置（`server/.env`，M1 已完成 + 本 PR 约束）
M1 已配好以下键（当前仓库 `.env` 实际值在 `TOT_backend/.env`，未进 Git）：

```env
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_SECRET_KEY="sk-lf-..."
LANGFUSE_BASEURL="https://us.cloud.langfuse.com"            # 【当前】开发期使用 Langfuse US 公有云
LANGFUSE_ENABLED="true"                                     # 运行期总开关，降级 no-op 用
LANGFUSE_SAMPLE_RATE="1.0"                                  # 生产建议 0.1~0.3；按 sessionId 哈希采样
LANGFUSE_MASK_PII="true"                                    # 上报前做脱敏（§6）
```

**几条必须注意的对齐**（团队成员容易踩）：

1. **变量名是 `LANGFUSE_BASEURL`**（无下划线，本仓库自定义读取名），**不是** Langfuse 官网文档示例里的 `LANGFUSE_HOST`（那是 v4/v5 SDK 的约定）。`tracer.js` 显式从 `process.env.LANGFUSE_BASEURL` 取值；随手按官网 `LANGFUSE_HOST=` 配的不会生效。
2. **当前走 US 公有云**。生产上线前必须按 §6 切自建或至少保持 `LANGFUSE_MASK_PII=true` + 高阶采样（≤0.3）。本 PR 不涉及部署变更，仅留在文档层面提醒。
3. 本 PR **不新增**任何环境变量键。

### 3.3 封装追踪器（`server/utils/tracer.js`，M1 骨架已落地，本 PR 做增量）

M1 已完成：
- `isEnabled()` / `isSampled()` / `maskPII()` / `preview()` / `createAgentTrace()` / `NOOP_TRACE`。
- NoopTrace 合约：`trace.id === null`，`.span() / .generation()` 返回 NOOP_SPAN；NOOP_SPAN 有 `.end() / .update() / .event() / .span() / .generation()` 均为 no-op。整条链路对业务代码零感知。
- 采样：`hashString(sessionId) % 1000 < Math.floor(sampleRate * 1000)`，保证同一 session 要么全采要么全跳。

本 PR 需要**增量**：

1. **导出 `getClient()`**：暴露已初始化的 Langfuse 单例给 `app.js` 的 SIGTERM 钩子做 `flushAsync`（§5.8）。NoopTrace 时 `getClient()` 返回 `null`，`app.js` 侧据此跳过 flush。
2. **新增 `createMemoryTrace(ctx)`**：给 `chatMemoryService.extract` 用，`tags:['memory_extract']`，签名与 `createAgentTrace` 对齐，供 §5.6 / §8(e) 使用。
3. **新增小工具**：`endGeneration(gen, { output, usage, metadata, level })` 与 `endSpan(span, { output, metadata, level })`，统一做 `output = maskPII(preview(...))`、try/catch 吞异常 + `logger.warn`、`level` 注入；风格为「手工 `.span()` → 业务执行 → `endSpan()`」的 begin/end 对，**不采用** `withSpan(fn)` 回调风格（M1 的 `FC_Loop` / `DeepSeek_FC_Step` 就是 begin/end，沿用避免引入两套范式混乱）。
4. `createAgentTrace` 签名保持 M1 形态 `createAgentTrace({ sessionId, userId, userMessage, scopeType, agentMode, entryKind, tags })`（**单对象参数**，和 v1 伪代码不同，以 M1 代码为准）。本 PR 内新增一个 `entryKind` 枚举值 `regenerate` / `regenerateStream`（§5.9）。

### 3.4 核心注入点（与 §2 时序一一对应）
见 §4「Span / Generation 清单」。所有 LLM 调用 **必须用 `generation`**（不是 `span`），以便获得 token/cost 统计。

### 3.5 完成与 flush
- Web 进程长驻：无需每次 `flushAsync`，依赖 SDK 后台批量上传。
- SSE `done` / `error` 后不要强制 `flush`，避免阻塞响应；在进程退出钩子（`process.on('SIGTERM')`）中 `flushAsync`，具体做法见 §5.8。
- 对 `chatMemoryService.extract` 这种 `setImmediate` 的异步任务，**另起一个独立 trace**（`tags:['memory_extract']`），完成后自行结束；因为它的完成时间常晚于主请求，依赖 §5.8 的 SIGTERM flush 钩子兜底防丢。

### 3.6 【必须】token usage + 首 Token 延迟采集（M1 补漏）
Langfuse 的 Baseline Requirement：`generation` 节点必须携带 `model` + `usage: { input, output, total }`，否则成本/Token 分析看板完全失效。当前 `server/utils/ai.js` 里四个 LLM 函数（`chatWithTools`、`chatWithToolsStream`、`generateTextDeepSeek`、`generateTextDeepSeekStream`）把 DeepSeek 返回的 `data.usage` 丢弃了，必须改造。

#### 3.6.1 非流式：`chatWithTools` / `generateTextDeepSeek`
非流式直接取 `data.usage`（OpenAI 兼容 API 默认返回），返回体追加 `usage`、`model`（取 `data.model || body.model`）。

#### 3.6.2 流式：【关键坑】必须显式开启 `include_usage`
OpenAI 兼容的 SSE 流式接口**默认不返回 usage**；必须在请求 body 里显式加：

```js
body.stream = true;
body.stream_options = { include_usage: true };
```

才会在 `[DONE]` 之前的最后一个 chunk（**`choices` 为空数组，`usage` 非空**）里看到 `usage`。DeepSeek 的 OpenAI 兼容实现与 OpenAI 行为一致，`chatWithToolsStream` 与 `generateTextDeepSeekStream` 都必须加这一行。

**解析循环要改一处**：当前 `chatWithToolsStream` 解析循环是：

```js
const d = json.choices?.[0]?.delta;
if (!d) continue;        // ← 这里会把「只有 usage 的流尾 chunk」吃掉
```

改造后必须在 `if (!d) continue` **之前**先抢 `json.usage`：

```js
if (json.usage && (json.usage.prompt_tokens || json.usage.total_tokens)) {
  usageRecord = json.usage;
  modelRecord = json.model || modelRecord;
}
const d = json.choices?.[0]?.delta;
if (!d) continue;
```

`generateTextDeepSeekStream` 的解析循环同理。

**实施先验证一次**（30 秒，避免返工）：在动手改之前，先用 curl 对 `https://api.deepseek.com/chat/completions` 发一个带 `"stream": true, "stream_options": {"include_usage": true}` 的请求，grep `usage` 看流尾是否真的会回。若 DeepSeek 某个老模型不支持（概率很低），当前代码降级到 NoopTrace，不影响主流程；同时在 `chatWithToolsStream` 里记 `logger.warn('langfuse_stream_usage_missing', { model })` 一次，方便观测。

同时在 `chatWithToolsStream` 内部：
- 记录 `streamStartAt = performance.now()`，第一次收到有效 `content` / `reasoning_content` delta 时计算 `firstTokenLatencyMs` 并保留到返回值（只记一次，避免每个 chunk 覆写）。
- 单独累计 `reasoningChunks` / `contentChunks` 计数（不是内容），回到 generation metadata 里。

#### 3.6.3 返回体契约（第 4 次修订：改为 opt-in，保持老调用点零改动）

> 初版曾拍板「string → 对象」一次性重构。实施前 grep 后发现 `generateTextDeepSeek` / `generateTextDeepSeekStream` 还被 **5 处非 Executive Chat 的调用点**使用（`agent/skills/generateNudge.js`、`parseTask.js`、`generateTaskDesc.js`、`services/taskSmartPublishService.js`、`services/dashboardInsightService.js`），它们都是 `const text = await generateTextDeepSeek(...)` 直接当字符串用。把返回值一次性改为对象会把这 5 处与 Langfuse 无关的代码拖下水，引入非必要回归风险。故调整为显式 opt-in。

- `chatWithTools(Stream)` 原本就返回对象，**无破坏性追加字段**：
  ```ts
  { content: string|null, tool_calls: any[]|null, usage: { prompt_tokens, completion_tokens, total_tokens }|null, model: string|null, firstTokenLatencyMs?: number, reasoningChunks?: number, contentChunks?: number }
  ```
- `generateTextDeepSeek` / `generateTextDeepSeekStream` / `simpleChat` 采用 **`options.returnUsage` opt-in** 模式：
  - 默认（`returnUsage !== true`）**保持原签名**，仍返回 `string`。
  - 传 `returnUsage: true` 时返回 `{ content: string, usage: {…}|null, model: string|null }`。
  - 内部用一个共享 impl，双路径零重复代码。
  - Executive Chat 侧 3 处调用点（`chatIntentService.classify`、`chatAnswerService.format`、`chatAgentRunner.checkIntentSafety` + `chatMemoryService.extract` 共 4 处，但后两者同走 `simpleChat`）显式传 `returnUsage: true`，并拿到 `usage`/`model` 透给 generation。
  - 其余 5 处非 Executive Chat 调用点（`agent/skills/*`、`taskSmartPublishService`、`dashboardInsightService`）**零改动**。
- 理由：这 5 处与 Langfuse 埋点无关，纯字符串消费；`returnUsage` opt-in 让核心能力同源、老调用点零风险；相比「并行变体函数」，ai.js 不会膨胀出相似度极高的重复实现。

#### 3.6.4 验收
所有 5 个 LLM generation 入口（Semantic_Supervisor / DeepSeek_FC_Step / Intent_Classify / Answer_Format / Memory_LLM）在 `generation.end(...)` 时 `usage.total_tokens` 必须非零；在 Langfuse UI 的「Generations」视图里能看到 model、prompt/completion tokens、cost 列有值。

---

## 4. Span / Generation 清单（与 §2 时序环节映射）

> 类型：T = `trace`，S = `span`，G = `generation`。必备字段仅列出 Langfuse 节点的 `metadata`/`input`/`output` 关键项。

| 时序环节（11 文档 §2） | 位置 | 类型 | 名称 | 必备字段 |
|---|---|---|---|---|
| HTTP 入口 | `chatService.sendMessage/Stream` | T | `Executive_Chat_Request` | `sessionId`、`userId`、`tags:[mode, scope:<type>]`、`input: userMessage` |
| 写入 user / clarification tool | `chatService.handleIncomingMessage` | S | `Persist_User_Message` | `isClarification`、`clientMessageId`、`toolCallId?` |
| 历史加载 | `chatService.loadFormattedHistory` | S | `Load_History` | `count`、`compressedChars` |
| 执行模式判定 | `chatAgentRunner.classifyExecutionMode` | S | `Classify_Execution_Mode` | `mode`（chat_only/tool_action）、`chitChatMatched:bool` |
| 语义监工（**LLM**） | `chatAgentRunner.checkIntentSafety` | G | `Semantic_Supervisor` | `model`、`usage`、`decision`（allow/deny）；失败时 `level=ERROR` |
| 模式分流 | `chatAgentRunner.run` | — | tag 到 trace | `tags:[agentMode:function_calling|intent_routing]` |
| FC 主循环（外层） | `chatAgentRunner.runFunctionCalling` | S | `FC_Loop` | `iterations`、`reachedMax:bool`、`disambiguation:bool`、`finalPath`（no_tool / with_tools / max_iter） |
| FC 每轮 LLM（**LLM**） | `utils/ai.chatWithToolsStream` | G | `DeepSeek_FC_Step` | `iteration`、`model`、`usage`、`firstTokenLatencyMs`、`reasoningChunks`、`contentChunks`、`hasToolCalls:bool` |
| 单次工具执行 | `chatToolsService.executeByName` | S | `Tool_${toolName}` | `cacheHit:bool`、`argsHash`、`scopeType`、`timeoutMs`、`durationMs`、`errorCode?`、`needDisambiguation:bool` |
| Code Interpreter（特例） | `chat_tools/tool_executeCode.js` | S | `Tool_executeCode` | 同上 + `sandboxBootMs`、`codeBytes`、`pythonError:bool`、`stdoutBytes` |
| Routing：意图分类（**LLM**） | `chatIntentService.classify` | G | `Intent_Classify` | `model`、`usage`、`intentType`、`entitiesSummary` |
| Routing：工具调用 | `chatToolsService.executeByName` | S | 同上 `Tool_${toolName}` | 加 `callSite:'intent_routing'` |
| Routing：回答格式化（**LLM**） | `chatAnswerService.format` | G | `Answer_Format` | `model`、`usage`、`hasVisualizations:bool`、`streamed:bool` |
| 助手消息持久化 | `chatService` 结尾 | S | `Persist_Assistant_Message` | `messageId`、`intentType`、`hasMarkdown:bool`、`toolMeta` 摘要 |
| SSE 生命周期 | `chatService.sendMessageStream` | S | `SSE_Stream` | `firstDeltaMs`、`doneMs`、`clientClosed:bool`、`abortError:bool` |
| 异步记忆抽取（**独立 Trace + LLM**） | `chatMemoryService.extract` | T + G | `Memory_Extract` / `Memory_LLM` | `sessionId`、`written:int`、`conflicts:int`、`usage` |

**关键：**
- 所有 LLM 调用的 `generation.input` 应为脱敏后的 `messages`；`output` 若含 `reasoning_content`，必须复用 **`sanitizeReasoningSummary`** 后再上报（与 SSE 脱敏路径一致）。
- 工具错误码与 `chatToolsService` 的枚举对齐：`TOOL_NOT_FOUND` / `INVALID_PARAMETERS` / `PERMISSION_DENIED` / `TIMEOUT_ERROR` / `EXECUTION_ERROR`。

---

## 5. 关键实现要点

### 5.1 LLM 必须用 `generation`（不用 `span`）
`checkIntentSafety`、`chatIntentService.classify`、`chatAnswerService.format`、`chatMemoryService.extract` 内部的 `simpleChat`、以及 FC 每轮 `chatWithToolsStream`，共 **5 个** LLM 入口，全部用 `generation`，否则无法统计 token/cost。

### 5.2 FC 每轮要带 `iteration` 与首 Token 延迟
- 在 `utils/ai.chatWithToolsStream` 内部用 `performance.now()` 记录首个 `onDelta` 到达时间。
- `generation.metadata` 写入 `{ iteration, firstTokenLatencyMs, reasoningChunks, contentChunks }`。
- FC 外层 `FC_Loop` span 汇总 `iterations` 与 `reachedMax`。

### 5.3 工具 Span 的必备 metadata
`cacheHit`、`argsHash`（不落明文参数）、`scopeType`、`errorCode`、`needDisambiguation`、`durationMs`，这是后续优化 Agent 最核心的统计来源。

**`argsHash` 实现口径**（防止门店名/任务名明文泄漏）：
```js
const crypto = require('crypto');
const argsHash = crypto.createHash('sha1')
  .update(JSON.stringify(args || {}))
  .digest('hex').slice(0, 12);
```
12 位 hex 足以去重聚合，无还原风险。Langfuse span `input` **不要**放 `args` 原文，只放 `{ argsHash, keyedFields }`（`keyedFields` 只含非敏感字段名列表，如 `['taskId','region']`，便于在 UI 里知道这次调用带了哪些类别的参数）。

### 5.4 歧义恢复（Stateful Resume）聚合
- 用户点击澄清项后产生的**第二条请求**是 **新 Trace**；通过相同 `sessionId` 聚合，`tags:['clarify_resume']`，并在 `input.metadata` 写入 `clarificationResponse.toolCallId` 便于串联。

### 5.5 Langfuse Trace 回链 DB（推荐）
- 在 `chat_messages` 增加一列 `trace_id TEXT NULL`（可选迁移），或在 logger 的 `chat_turn` 事件里打印 `traceId`，便于从 DB 行 / 日志反向定位 Langfuse Trace。
- 如加字段，需同步更新 [`01-DATA-MODEL.md`](../specs/01-DATA-MODEL.md) 与 [`backend/03-DATABASE.md`](../backend/03-DATABASE.md)。

### 5.6 异步任务（`chatMemoryService.extract`）
- `setImmediate` 后原请求 Trace 已经结束；**另起一个独立 Trace**（同 `sessionId`，`tags:['memory_extract']`），避免落入黑盒。
- 该 Trace 内应有一个 `generation` 记录其自身的 `simpleChat` 调用。

### 5.7 SSE 生命周期
- 在 `writeSseHeaders` 后与 `done`/`error`/`close` 三个出口处埋点；`clientClosed:bool` 用于观测真实「停止生成」比例。
- 目前 `utils/ai.chatWithToolsStream` 未接 `AbortSignal`（见 11 文档 §8），停止生成实际上不会立刻中断上游；trace 数据可作为补齐该能力的依据。

### 5.8 进程退出 graceful flush（app.js）
- `app.js` 当前只有 `server.listen`，没有 SIGTERM/SIGINT 钩子。Langfuse SDK 采用后台批量上报，**直接进程退出会丢最后一批 trace**。
- 做法：在 `server.listen` 之后注册：
  ```js
  const { getClient } = require('./utils/tracer');
  async function gracefulShutdown(signal) {
    logger.info('graceful_shutdown_start', { signal });
    try {
      const lf = getClient();
      if (lf && typeof lf.flushAsync === 'function') {
        await Promise.race([
          lf.flushAsync(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('langfuse_flush_timeout')), 5000)),
        ]);
      }
    } catch (e) {
      logger.warn('graceful_shutdown_langfuse_flush_failed', { message: e.message });
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  ```
- 5s flush 超时兜底，8s 强制退出兜底；都不影响主业务。

### 5.9 regenerate 入口也要建 Trace
- `chatService.regenerateLastAssistant` / `regenerateLastAssistantStream` 当前完全未建 Trace；属于典型「用户点了『重新生成』后在 Langfuse 里找不到这一条」的黑盒场景。
- 做法：与 `sendMessage(Stream)` 对齐，调用 `createAgentTrace({ entryKind: 'regenerate' | 'regenerateStream', … })`，tag 增加 `['regenerate']`，`input` 用被重算的那条 user 原文。

### 5.10 各 service 的 `PROMPT_VERSION` 常量（配合 §6 PII 条款）
为避免把同一个 System Prompt 原文在每条 trace 里重复上报（数据量 + 泄漏风险），本 PR 在以下四个文件顶部各加一个常量：

| 文件 | 常量 | 初值建议 |
|---|---|---|
| `server/services/chatAgentRunner.js` | `FC_PROMPT_VERSION` | `'executive-chat-fc/v4.0'` |
| `server/services/chatAgentRunner.js` | `SUPERVISOR_PROMPT_VERSION` | `'semantic-supervisor/v3.0'` |
| `server/services/chatIntentService.js` | `INTENT_PROMPT_VERSION` | `'intent-classify/v3.0'` |
| `server/services/chatAnswerService.js` | `ANSWER_PROMPT_VERSION` | `'answer-format/v3.0'` |
| `server/services/chatMemoryService.js` | `MEMORY_PROMPT_VERSION` | `'memory-extract/v4.0'` |

各 generation 在 `metadata.promptVersion` 上报该常量；system prompt 原文改用 `hash(SYSTEM_PROMPT).slice(0,8)` 作为 `metadata.promptHash`（SHA1 前 8 位）双重锁定。今后任何 prompt 改动同时升版这个常量 —— 为 M5 做 prompt 级 Bad Case 聚合打基础。

---

## 6. 安全与合规

1. **PII / 业务数据外传**：`input: userMessage`、`output: finalContent`、`input: tool args`、`messages`、推理摘要均可能包含苹果零售的经营数据与个人偏好。**强制要求：**
   - 生产环境使用 **自建 Langfuse**（`LANGFUSE_BASEURL` 指向内网）；
   - `LANGFUSE_MASK_PII=true` 时走 `maskPII`：手机号 / 邮箱 / 员工姓名 / 具体金额等按白名单脱敏；
   - `reasoning_content` 上报前必须过 **`sanitizeReasoningSummary`**（`chatWithToolsStream` 内部已实现，generation `output` 只含 `content` 不含 `reasoning_content`）；
   - **System Prompt 原文不重复上报**：在每个定义 SYSTEM_PROMPT 的文件顶部加 `const PROMPT_VERSION = 'executive-chat-fc/v4.0'`（各 service 独立命名）；generation `input` 仅放 `{ userMessage, historyLen, promptVersion }`，不把完整 `messages` 数组（含 system）再塞一遍。详见 §5.10。
   - **工具参数不上明文**：遵守 §5.3 的 `argsHash` + `keyedFields` 口径。
2. **Secrets**：`LANGFUSE_SECRET_KEY` 仅出现在后端进程环境变量，不进入前端/日志；PR 模板加 secret scan。
3. **采样**：生产 `LANGFUSE_SAMPLE_RATE` 建议 `0.1~0.3`，按 `sessionId` 哈希分桶，保证同一会话要么全采要么全不采，便于排障。
4. **失败容忍**：Langfuse SDK 出现任何异常必须 **不影响主流程**；tracer 内部 try/catch 吞异常并 `logger.warn`。

---

## 7. 与 `11-EXECUTIVE-CHAT-REQUEST-FLOW.md` §2 的映射验收表

上线完成后，应能在 Langfuse UI 上对任意一条问答看到以下瀑布流（取决于命中的分支）：

```
Executive_Chat_Request (T)
├─ Persist_User_Message (S)
├─ Load_History (S)
├─ Classify_Execution_Mode (S)
├─ Semantic_Supervisor (G)            # tool_action 才有
├─ FC_Loop (S)                         # function_calling 分支
│  ├─ DeepSeek_FC_Step #1 (G)
│  │  └─ Tool_<name> (S) * N           # 可 0..N
│  ├─ DeepSeek_FC_Step #2 (G)
│  └─ ...
├─ Intent_Classify (G)                 # intent_routing 分支
├─ Tool_<name> (S)                     # intent_routing 分支
├─ Answer_Format (G)                   # intent_routing 分支
├─ Persist_Assistant_Message (S)
└─ SSE_Stream (S)                      # 仅流式
```

> 验收：随机抽 20 个真实 trace，**每条**都能在 UI 上对应到 §2 时序的某一路径，且字段均非空（除明显不适用项）。

---

## 8. 里程碑与交付

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1（已交付） ✅ | 依赖/环境/`tracer.js` + 入口 Trace + `FC_Loop` + 每轮 `generation`（**无 usage**） | 可看到 FC 主路径瀑布（`Executive_Chat_Request` → `FC_Loop` → `DeepSeek_FC_Step[i]`） |
| **M2–M4 合并 PR（本次落地）** 🚧 | （a）`utils/ai.js` 四个 LLM 函数追加 `usage`/`model` 回报 + 流式两处加 `stream_options.include_usage` + `chatWithToolsStream` 内测首 Token 延迟 + `generateTextDeepSeek(Stream)` / `simpleChat` 通过 `options.returnUsage: true` **opt-in** 返回 `{ content, usage, model }`，默认保持 `string`（§3.6.3）；（b）5 个 LLM generation 全部带 `usage` + `promptVersion`（§5.10）；（c）FC + intent_routing 两条路径的 `Tool_<toolName>` span（含 `cacheHit/argsHash/keyedFields/scopeType/errorCode/needDisambiguation/durationMs`，§5.3）；（d）`Semantic_Supervisor`/`Classify_Execution_Mode`/`Intent_Classify`/`Answer_Format` 埋点；（e）`chatMemoryService.extract` 独立 `Memory_Extract` Trace + `Memory_LLM` generation（§5.6）；（f）`Persist_User_Message`/`Load_History`/`Persist_Assistant_Message`/`SSE_Stream` span；（g）两个 `regenerate*` 入口建 Trace（§5.9）；（h）`app.js` SIGTERM/SIGINT → `flushAsync` 5s 超时（§5.8）；（i）五个 service 顶部加 `*_PROMPT_VERSION` 常量（§5.10）；（j）文档同步 `11-EXECUTIVE-CHAT-REQUEST-FLOW.md`「Telemetry 对照表」 | Langfuse UI 上 §7 的完整瀑布图可见，token/成本看板可用 |
| M5（持续） | 基于 trace 的 Bad Case 评估、成本/延迟看板、Score 收集 | 优化迭代（在 Langfuse UI 侧配置，无代码变更） |

### 8.1 本 PR 显式不做的事
为控制范围与风险，以下事项不在本 PR，留作后续独立 PR 评估：

- **Langfuse JS SDK v3 → v4 升级**（当前 `langfuse@^3.38.20`，v3 的 `trace/span/generation` API 仍然可用；升级涉及 `propagateAttributes`、`shouldExportSpan` 等新范式，需要整体回归，拆单独 PR 做）。
- **`chat_messages.trace_id` 回链列**（§5.5 标为推荐但可选）：Langfuse 的 `sessionId` 已经能把同一会话的 trace 聚合起来；等真有「从 DB 行反查 Langfuse」的排障需求再加，届时要同步改 `server/db/schema.sql`、`01-DATA-MODEL.md`、`backend/03-DATABASE.md`。
- **M5 的 Score/Bad Case 看板**（属于 Langfuse 控制台配置，不涉及仓库代码）。

---

## 9. 后续收益与预期
- 可以通过 Langfuse 面板清晰看到某次**多门店名称冲突**为何导致 FC 反复迭代到 `MAX_ITERATIONS`。
- 精准计量 `executeCode` 等沙盒型工具的**总耗时 = LLM 写代码 + Python 执行**的各自占比。
- 基于 Trace 的人工/自动评分（Langfuse Score）收集 **矩阵查询 / 下钻 / 分析** 的 Bad Case，用于下一步 Prompt/模型微调。
- 结合 `LANGFUSE_SAMPLE_RATE` 与告警（首 Token 延迟、工具错误率）实现 **可运营的 Agent 质量指标**。

---

## 10. 文档同步

本 PR 必须同步：
- [`11-EXECUTIVE-CHAT-REQUEST-FLOW.md`](../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md)：增补「Telemetry 对照表」一节（引用本 plan §4 / §7）。
- 本文件（`2026-04-23-agent-execution-telemetry.md`）：把 M2–M4 状态从「待办」改为「已交付」。

本 PR 不改（见 §8.1）：
- [`01-DATA-MODEL.md`](../specs/01-DATA-MODEL.md) / [`backend/03-DATABASE.md`](../backend/03-DATABASE.md)：仅当采用 §5.5 的 `chat_messages.trace_id` 列时才需要同步，本 PR 未采用。
- [`04-API-SPEC.md`](../specs/04-API-SPEC.md)：本 PR 不改 HTTP/WS 对外契约，无需同步。

## 11. 本 PR 文件改动清单（预估）

| 文件 | 改动性质 | 关键点 |
|---|---|---|
| `server/utils/ai.js` | **追加字段，opt-in 兼容** | 四个 LLM 函数：非流式取 `data.usage`；两个流式函数请求 body 加 `stream_options: { include_usage: true }` 后解析流尾 chunk 的 `usage`；`chatWithToolsStream` 内测首 Token 延迟；`chatWithTools(Stream)` 返回对象无破坏性追加 `usage`/`model`/`firstTokenLatencyMs`/`reasoningChunks`/`contentChunks`；`generateTextDeepSeek(Stream)` + `simpleChat` 增加 `options.returnUsage: true` opt-in（默认保 `string`，opt-in 时返回 `{ content, usage, model }`），`agent/skills/*`、`taskSmartPublishService`、`dashboardInsightService` 等 5 处**零改动** |
| `server/utils/tracer.js` | 扩展 | 导出 `getClient()`（供 `app.js` flush）、新增 `createMemoryTrace()`、补一组 `endSpan`/`endGeneration` 小工具统一 try/finally；NoopTrace 保持不变 |
| `server/services/chatAgentRunner.js` | 增埋点 | 顶部加 `FC_PROMPT_VERSION` / `SUPERVISOR_PROMPT_VERSION`；`Semantic_Supervisor` generation、`Classify_Execution_Mode` span、`Tool_<name>` span（FC + intent_routing 两路径，含 `argsHash`/`keyedFields`）、`DeepSeek_FC_Step` 补 `usage`/`firstTokenLatencyMs`/`reasoningChunks`/`contentChunks` |
| `server/services/chatIntentService.js` | 接 trace + 埋点 | 顶部加 `INTENT_PROMPT_VERSION`；`classify()` 接受 `options.trace`，包一层 `Intent_Classify` generation（带 usage），调用方从 `sendMessage(Stream)` / `runIntentRouting` 透 trace 下来 |
| `server/services/chatAnswerService.js` | 接 trace + 埋点 | 顶部加 `ANSWER_PROMPT_VERSION`；`format()` 接受 `options.trace`，包一层 `Answer_Format` generation（含 `streamed`/`hasVisualizations`/usage） |
| `server/services/chatMemoryService.js` | 独立 Trace | 顶部加 `MEMORY_PROMPT_VERSION`；`extract()` 自建 `Memory_Extract` Trace + `Memory_LLM` generation，`tags:['memory_extract']`；`simpleChat` 返回值改造后同步改取 `.content` |
| `server/services/chatService.js` | 增埋点 | `Persist_User_Message` / `Load_History` / `Persist_Assistant_Message` / `SSE_Stream` span；`regenerateLastAssistant(Stream)` 建 Trace；把 `trace` 透传给 intent/answer 服务 |
| `server/app.js` | 生命周期 | SIGTERM/SIGINT → `tracer.getClient().flushAsync()`（5s 超时 + 8s 强杀兜底） |
| `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` | 文档 | 追加「Telemetry 对照表」 |
| 本文件 | 文档 | 状态更新为「M2–M4 已交付」 |

## 12. 验证方式

- 静态：`node --check` 扫上述 JS 文件。
- 单元级：`npm --prefix TOT_backend/server run test:region-drilldown`、`test:fc-e2e`（若仍适用）。
- 手工 E2E（对照 §7 瀑布）：在本地开发环境（`LANGFUSE_ENABLED=true`、密钥已在 `.env`）分别触发：
  1. 一条 FC 正常问答（如「华东区完成率」）→ 应看到 `Executive_Chat_Request → Classify_Execution_Mode → Semantic_Supervisor(G, 带 usage) → FC_Loop → DeepSeek_FC_Step[1..n](G, 带 usage) → Tool_<name>(S) → Persist_Assistant_Message → SSE_Stream`。
  2. 一条 intent_routing 路径（临时把 `CHAT_AGENT_MODE=intent_routing`）→ 应看到 `Intent_Classify(G) → Tool_<name>(S) → Answer_Format(G)`，三者均带 `usage`。
  3. 一条歧义澄清 → 应看到 `Tool_<name>` span 上 `needDisambiguation:true`，trace `status=clarify`。
  4. 点击「重新生成」→ 应看到 `entryKind:regenerate` 的独立 Trace。
  5. 看到异步 `Memory_Extract` trace（tag `memory_extract`），带 `Memory_LLM` generation + `usage`。
- 硬性 sanity check（不依赖肉眼看 UI）：
  - Langfuse 首页「Generations」视图里 5 种 name（Semantic_Supervisor / DeepSeek_FC_Step / Intent_Classify / Answer_Format / Memory_LLM）的 `Total tokens` 列都不为 0、`Cost` 列都有值（非 `—`）。
  - 随手打开一条 `Tool_<name>` span：`input` 只含 `argsHash` + `keyedFields`，**不含**原始 `args`；`metadata.durationMs` > 0。
  - 任一 `*_FC_Step` generation：`metadata.promptVersion` 形如 `executive-chat-fc/v4.0`，`metadata.promptHash` 是 8 位十六进制。
- `kill -TERM <pid>`：进程 5s 内退出，Langfuse UI 里最后一条 trace 不丢。
