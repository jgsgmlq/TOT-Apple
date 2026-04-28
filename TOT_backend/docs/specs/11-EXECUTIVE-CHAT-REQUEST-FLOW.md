# Executive Chat 请求处理流程（实现对照）

**版本:** 4.0.1 | **更新日期:** 2026-04-23 | **状态:** Current

**本文定位：** 以当前后端代码为准，描述「用户发送一条消息 → 助手回复落库」的**完整调用链、分支条件与数据流**。  
**不重复：** HTTP 字段级契约见 [04-API-SPEC.md](./04-API-SPEC.md) §6；产品能力与分层架构摘要见 [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md)；意图与工具清单见 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)。

**实现锚点（主要文件）：**

| 层级 | 路径 |
|------|------|
| 路由 | `TOT_backend/server/routes/chat.js` |
| 会话与持久化 | `TOT_backend/server/services/chatService.js` |
| Agent 编排 (Legacy) | `TOT_backend/server/services/chatAgentRunner.js` (即将废弃) |
| Agent 编排 (LangGraph) | `TOT_backend/server/agent/graph/` (包含 state.js, nodes.js, graph.js) |
| 工具注册与执行 | `TOT_backend/server/services/chatToolsService.js`、`TOT_backend/server/chat_tools/*.js` |
| 异步记忆队列 (Queue) | `TOT_backend/server/agent/queue/bullMqProducer.js` |
| Code Interpreter | `TOT_backend/server/chat_tools/tool_executeCode.js` (沙盒分析) |
| 模型与流式 FC | `TOT_backend/server/utils/ai.js`（`chatWithToolsStream`、`simpleChat`） |
| 会话图持久化 | `Postgres Checkpointer` (在 LangGraph compile 时注入) |
| 观测与打点 | `TOT_backend/server/utils/tracer.js` 及 LangfuseCallbackHandler |

---

## 1. 环境开关与动态路由 (LangGraph)

在 4.0 之前的版本中，系统依赖环境变量（如 `CHAT_AGENT_MODE`）来进程级切换路由。
在 4.0 的 LangGraph 重构后，请求将被动态路由 `RoutingPolicy` 接管。

| 策略/参数 | 默认门限 / 说明 | 影响 |
|------|----------------|------|
| `RoutingPolicy` | 在 `t0-freeze-spec.md` 冻结 | 根据 Router 输出的 `complexity_score` 动态将请求分流至 `L2_intent_fastpath`、`L3_fc_guarded` 或 `L4_heavy_fc`，以分配不同的模型预算与尝试次数。 |
| `Checkpointer` 持久化 | Postgres Checkpointer | 负责管理整个 Executive Chat 会话的图状态（包含工具调用的堆栈、拦截历史等），通过 `thread_id` 自动管理生命周期。 |
| 异步记忆 (Queue) | Fire & Forget (BullMQ) | 不再在主请求链路阻塞式提取记忆。在响应结束后抛出 `MemoryIngestRequested`，后台定时 Worker 负责落库。 |
| `CHAT_SESSION_STATE_TTL_MS` / `CHAT_SESSION_STATE_CAPACITY` | 可选 | 控制 `chatSessionStateService` 内存条目的 TTL 与条数上限（默认见 `chatSessionStateService.js`）。 |



---

## 2. 总览时序 (LangGraph v4.0)

```mermaid
flowchart TD
  A[HTTP POST 聊天接口] --> B[chatService.js]
  B --> C[构造 `ExecChatGraphState` 初始化状态]
  C --> D[LangGraph `app.invoke()` + SSE Emitter]
  D --> E[LoadContext 节点 (异步注入短期记忆)]
  E --> F[ContextAnalyzerRouter 节点]
  F --> G{Router 意图判断}
  G -->|chat_only| H[FinalResponseStep: 闲聊回复]
  G -->|deny| I[FinalResponseStep: 拒绝危险操作]
  G -->|tool_action| J[fc_CheckSteps (FC主循环)]
  
  J --> K[fc_LlmToolCallStep (流出 Reasoning/正在思考)]
  K --> L{是否存在 Tool Call?}
  L -->|No| H
  L -->|Yes| M[fc_ValidateParams (JSON+业务规则)]
  
  M --> N{参数校验结果}
  N -->|Fail & < 2次| O[fc_ParamRepair 修参闭环] --> M
  N -->|Fail & >= 2次| P[Fail Fast: 中止并通知用户补充] --> H
  N -->|Pass| Q[fc_ExecuteTool (硬性权限+白名单)]
  
  Q -->|SSE tool_start| R[执行底层工具函数 / Code Interpreter]
  R -->|SSE tool_end| S[fc_MergeToolResults]
  S --> J
  
  H --> T[PersistAndEmit 节点]
  T --> U[图外异步: MemoryQueueProducer 发送记忆队列]
  T --> V[结束流转, Emitter 结束]
```

---

## 3. 入口层：`chatService`

### 3.1 会话校验与 Graph Invocation

1. 校验 `chat_sessions` 存在且 `user_id` 与当前用户一致。
2. **`handleIncomingMessage`**（`chatService.js`）  
   - 可选 **`messageId` 幂等**：针对前端传来的 `client_message_id` 做去重校验。
   - **LangGraph Checkpointer Resume (状态恢复)**：利用 `Postgres Checkpointer` 及图状态的 `hitl_status` 标识，当带有 `clarificationResponse` 时，直接 `app.invoke()` 并传入 `resume_token`。不再像 Legacy 系统那样向数据库强插“伪造的 Tool 角色消息”。
3. 从会话行构造 **`regionScope`**：`type`（`national` / `regional` / `rtm`）、`regions` JSON、`rtm` 字符串。后续所有工具必须在此范围内查询。

### 3.2 SSE 构建与注入

- 创建 `sseEmitter` 实例并包裹 `res.write` 逻辑。
- 将其注入图 `configurable` 配置中，图网络中的节点如 `fc_LlmToolCallStep` 和 `fc_ExecuteTool` 可通过 `config.configurable.sseEmitter.handleLLMNewToken()` 等接口产生实时副作用。

- **`loadFormattedHistory`**：由图 `messages` 状态自动管理（LangGraph Checkpointer 会原样恢复 `BaseMessage` 实例，包含 `tool_calls` 和 `tool_call_id`，天然避免 OpenAI API 400 错误）。

---

## 4. 编排层：`AgentGraph` 流转与执行

核心逻辑位于 `TOT_backend/server/agent/graph/nodes.js` 及 `graph.js`。

### 4.1 `ContextAnalyzerRouter` (智能路由与门控)
- **输入**: 用户文本与 `LoadContext` 注入的近期记忆。
- **职责**:
  1. **安全拦截**：如果是危险操作（发邮件/改库），直接返回 `safety: "deny"`，图分流至 `FinalResponseStep` 退出。
  2. **意图分类**：区分为 `chat_only` 或 `tool_action`。
  3. **实体提取**：预提取 `region`, `store`, `metric` 等槽位，输出结构化数据。

### 4.2 `fc_CheckSteps` & `fc_LlmToolCallStep` (FC 循环引擎)
- 替代了旧版的 `runFunctionCalling`。
- `fc_LlmToolCallStep` 发起大模型请求，通过传入的 `sseEmitter` 直接吐出 reasoning token（"正在思考..." 等）。
- 产出 `tool_calls` 列表进入校验环节。

### 4.3 护栏与执行 (`fc_ValidateParams`, `fc_ParamRepair`, `fc_ExecuteTool`)
- `fc_ValidateParams`: 校验提取参数，如果不满足必须业务规则，且 `fc_repair_attempts < 2`，则触发 `fc_ParamRepair` 节点要求 LLM 自我纠错。
- **Fail Fast**: 若修参次数超限，强行终止（降级为 `chat_only` 意图）并向前端返回报错要求补充信息。
- **执行** (`fc_ExecuteTool`):
  - **白名单校验**: 确保调用的 `toolName` 属于 `executive_chat` 命名空间。
  - **越权拦截**: `regionScope` 是 `store` 的用户不允许调用 `national` 的工具。
  - 执行 `chatToolsService.js` 的原生代码，抛出 `tool_start` 和 `tool_end` SSE 事件。

### 4.4 结束与异步落库 (`PersistAndEmit`)
- 当模型完成多轮工具调用，不再产生新 `tool_calls`，图流转进入 `FinalResponseStep` 格式化后，通过 `PersistAndEmit` 向 `MemoryQueueProducer` 发布异步记忆事件。
- 不阻塞 SSE 的 `[DONE]` 终止符。


### 5.1 消息构造

1. **`fallbackIntent`**：`inferIntentFromMessage` 基于正则得到兜底 `_intentType`（工具执行后可能被 **`deriveIntentType`** 按实际工具名覆盖）。  
2. **记忆**：`chatMemoryService.getMemories(userId)` 非空时拼入 system 中的「个人偏好与记忆」段。  
3. **`messages`**：`system`（角色、工具指引、Markdown/echarts/suggestions 规则）+ `history` 映射的 `{role, content}` + 当前 `user`。

### 5.2 循环（最多 `MAX_ITERATIONS = 5`）

每轮：

1. 若启用会话状态：`chatSessionStateService.hydrateIfNeeded(sessionId, regionScope)`（无 Redis 或内存已有记录时实质为 no-op，见 §1）。  
2. **`chatWithToolsStream`**（`utils/ai.js`）：  
   - 请求 DeepSeek `chat/completions`，`stream: true`，附带 **`chatToolsService.TOOL_SCHEMAS`** 与 `tool_choice: 'auto'`。  
   - 流式解析 `delta`：获取 `reasoning_content`。在透出前，必须经过 **`sanitizeReasoningSummary`** 脱敏过滤（剔除 System Prompt 规则和工具 Schema 泄露），然后通过 `onDelta` 附带 `reasoningLevel: 'summary'` 下发。
   - `content` 增量直接透出；流结束时组装完整 `content` 与 `tool_calls` 数组。  
3. **若无 `tool_calls`**：将 `content` 作为 **`finalContent`**，跳出循环。  
4. **若有 `tool_calls`**：对每个调用：  
   - 解析 `function.arguments` JSON。  
   - 计算 **`buildToolCacheSignature(toolName, args, regionScope)`**。  
   - 若会话缓存命中：直接使用缓存的 `result`。  
   - 否则 **`chatToolsService.executeByName(name, args, regionScope)`**：schema 校验 → 角色/scope 策略 → handler 执行（超时见工具 meta）。  
   - 成功且非仅缓存： **`chatSessionStateService.addRecord`**（带 `expectedVersion` 做并发版本校验，具体见该服务实现）。  
   - 流式：`onDelta('', { phase: 'tool_start'|'tool_end', text: toolName })`。  
   - 记录 **`calledToolNames`**。  
5. **歧义短路**：若任一结果为 **`needDisambiguation`**：  
   - 流式：通过 `onDelta(..., { phase: 'clarify' })` 下发结构化澄清 payload（含 `toolCallId`、`candidates` 等）。  
   - 返回 **`buildDisambiguationReply`** 风格的结构化回复（并带 `_toolMeta`），**不再**追加 tool 消息进入下一轮，流程挂起等待前端带着 `clarificationResponse` 唤醒（Resume）。  
6. 否则：向 **`messages`** 追加 `assistant`（含 `tool_calls`）及多条 `tool`（`tool_call_id` + `JSON.stringify(result)`），进入下一轮，直到模型不再请求工具或达到迭代上限。

### 5.3 结束与返回值

- 若循环结束仍无正文且曾调过工具：降级提示「步骤过多」类文案。  
- 若从未得到正文：通用失败提示。  
- 返回对象核心字段：  
  - **`markdownContent`**：主答案（FC 基线）。  
  - **`_intentType`**：`deriveIntentType(calledToolNames, fallbackIntent)`。  
  - **`_intentResolvedBy`**：调过工具为 `tools`，否则 `regex_fallback`。  
  - **`_toolMeta`**：工具名摘要（含 `multi`）、迭代次数等。

---

## 6. 降级路径：`runIntentRouting`

适用于 **`CHAT_AGENT_MODE` ≠ `function_calling`**（任意其他字符串，如 `intent_routing`）。

1. **`chatIntentService.classify`**：`generateTextDeepSeek` 输出 JSON → `intentType` + `entities`。  
2. 按意图做参数校验（如 `analytics_query` 缺 `analysisType`、`drill_down` 缺区域/门店等）可能直接返回提示，**不调工具**。  
3. 特殊分支：`[绘图]` + `analytics_query` 时可从会话状态恢复上一轮分析结果，避免重复执行工具。  
4. 意图映射到固定工具名（见 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)），`matrix_query` 下对 `entities` 做参数归一化；再经 **`chatSessionStateService`** 按签名命中缓存或调用 **`executeByName`**（常见为单轮一次工具）。  
5. **`buildDisambiguationReply`** 处理门店歧义。  
6. **`chatAnswerService.format`**：基于工具结果与历史生成 **严格 JSON** 结构（overview、keyNumbers、visualizations 等）；传入 `streamFormatCallbacks.onDelta` 时走 `generateTextDeepSeekStream`，否则 `generateTextDeepSeek`。  
7. 返回 legacy 结构化回复，并 **`attachToolMeta(..., 'intent_llm')`**。

---

## 7. 工具执行层：`chatToolsService.executeByName`

1. 工具必须在启动时由 **`server/chat_tools/*.js`** 注册（`schema.function.name` + `handler`）；`meta.enabled === false` 跳过。  
2. **`validateToolArgs`**：按 JSON Schema 的 `required` / `properties` 做基础校验。  
3. **`authorizeToolCall`**：Executive Chat 默认 `userRoles: ['executive']`；`scopePolicy === 'national_only'` 时要求 `regionScope.type === 'national'`。  
4. **`executeWithTimeout`**：默认超时见各工具 `meta.timeoutMs`。**注意：`executeCode` 工具会建立到 `@e2b/code-interpreter` 云端沙盒的连接执行大模型生成的 Python 代码，其超时限制一般设置在 15s (`15000ms`)，并在安全的 MicroVM 中进行隔离执行。**  
5. 错误统一包装为 `{ error: { code, message, recommendation } }`，避免栈信息泄漏给模型。

---

## 8. 流式 SSE 与 `chatService.sendMessageStream`

- 响应头由 **`writeSseHeaders`** 设置；事件由 **`createSseSender`** 发送。  
- `chatAgentRunner` 的 `onDelta` 映射为 **`delta`** 事件：`text`、`phase`（`content` / `reasoning` / `tool_start` / `tool_end` / `clarify`）、`reasoningLevel`。这里的 `reasoning` 即为上述经过脱敏安全过滤后的摘要。  
- 客户端断开：`sendMessageStream` 在 `req.on('close')` 中对 `AbortController` 调用 **`abort()`**，并把 **`signal`** 传入 `chatAgentRunner.run` → `chatWithToolsStream(options)`。但当前 **`utils/ai.js` 的 `chatWithToolsStream` 未将 `signal` 传给 `fetch`，也未在读取流时响应中止**，因此**通常不会**因断开而中断 DeepSeek 请求；`sendMessageStream` 中的 `AbortError` 分支在当前 FC 路径上**很少触发**。若产品要求「停止生成」真正打断上游，需在 `ai.js` 中接入 `AbortSignal`。  
- 成功结束：发送 **`done`**，payload 含 `messageId`、`markdownContent` 或 `replyContent`、耗时等（与 [04-API-SPEC.md](./04-API-SPEC.md) 对齐）。

---

## 9. 与「找答案」相关的数据事实

- **答案依据**：默认路径下，事实来自 **工具 handler 查询 SQLite（及工具内逻辑）** 返回的 JSON，再由 **主模型** 组织为 Markdown；**不是**全文检索外部知识库。  
- **长期记忆**：影响 **system prompt 措辞与偏好**，不替代工具数据。  
- **歧义恢复**：用户选择澄清项后，前端再次发消息并带 **`clarificationResponse`**，`handleIncomingMessage` 写入 **`tool` 行**，使 FC 消息序列连续；细节见 `chatService.js` 与前端契约。

---

## 11. 遥测与追踪 (Telemetry & Tracing)

本系统接入了 **Langfuse** 用于全链路遥测。详细埋点定义见 [`2026-04-23-agent-execution-telemetry.md`](../plans/2026-04-23-agent-execution-telemetry.md)。

### 11.1 节点映射对照表

> 入口 trace 的 `entryKind` 取值：`sendMessage` / `sendMessageStream` / `regenerate` / `regenerateStream`；Agent 分支映射通过 `chatAgentRunner.AGENT_MODE` 一同上报。完整埋点口径请参考 [`2026-04-23-agent-execution-telemetry.md`](../plans/2026-04-23-agent-execution-telemetry.md) §4 - §5。

| 环节 (本文件 §) | 位置 | 类型 | 节点名称 | 关键采集字段 |
|---|---|---|---|---|
| HTTP 入口 (§3) | `chatService` | **Trace** | `Executive_Chat_Request` | `sessionId`, `tags:[entryKind, agentMode]` |
| 写入 user (§3.1) | `chatService` | Span | `Persist_User_Message` | `wroteRows`, `kind:user\|clarification`, `durationMs` |
| 历史加载 (§3.2) | `chatService` | Span | `Load_History` | `rowCount`, `hasAssistant`, `durationMs` |
| 模式判定 (§4.1) | `chatAgentRunner` | Span | `Classify_Execution_Mode` | `mode`, `chitChatMatched` |
| 语义监工 (§4.2) | `chatAgentRunner` | **Generation** | `Semantic_Supervisor` | `usage`, `model`, `decision:allow\|deny`, `promptVersion`, `promptHash` |
| FC 循环 (§5) | `chatAgentRunner` | Span | `FC_Loop` | `iterations`, `reachedMax`, `calledTools`, `status` |
| FC LLM 步进 (§5.2) | `chatAgentRunner` → `utils/ai.js` | **Generation** | `DeepSeek_FC_Step` | `usage`, `firstTokenLatencyMs`, `reasoningChunks`, `contentChunks`, `promptVersion`, `promptHash` |
| 工具执行 (§7) | `chatAgentRunner`（包装 `chatToolsService.executeByName`） | Span | `Tool_<name>` | `argsHash`, `keyedFields`, `cacheHit`, `durationMs`, `errorCode`, `callSite:function_calling\|intent_routing` |
| 意图分类 (§6) | `chatIntentService`| **Generation** | `Intent_Classify` | `usage`, `intentType`, `promptVersion`, `promptHash` |
| 格式化 LLM (§6) | `chatAnswerService`| **Generation** | `Answer_Format` | `usage`, `streamed`, `hasVisualizations`, `promptVersion`, `promptHash` |
| 写入 assistant (§3.5) | `chatService` | Span | `Persist_Assistant_Message` | `contentBytes`, `hasToolCalls`, `replaced`, `durationMs` |
| SSE 流 (§8) | `chatService` | Span | `SSE_Stream` | `deltaCount`, `deltaBytes`, `reasoningCount`, `toolStartCount`, `clientAborted`, `durationMs` |
| 异步记忆 (§3.4) | `chatMemoryService`| **Trace** | `Memory_Extract` | 独立 Trace，`tags:['memory_extract']`，嵌套 `Memory_LLM` generation，字段 `written`, `conflicts`, `usage` |

### 11.2 典型执行瀑布流 (Waterfall)

用户的一条消息在 Langfuse UI 上通常呈现为以下层级结构：

```text
Executive_Chat_Request (Trace, entryKind=sendMessageStream)
├─ Persist_User_Message (Span)
├─ Load_History (Span)
├─ Classify_Execution_Mode (Span)
├─ Semantic_Supervisor (Generation)
├─ FC_Loop (Span)
│  ├─ DeepSeek_FC_Step #1 (Generation)
│  ├─ Tool_queryExecutiveMetrics (Span, callSite=function_calling)
│  └─ DeepSeek_FC_Step #2 (Generation)
├─ Persist_Assistant_Message (Span)
└─ SSE_Stream (Span)

Memory_Extract (Trace, tags=['memory_extract'])   // setImmediate 后独立生成
└─ Memory_LLM (Generation)
```

### 11.3 隐私与脱敏

1. **PII 脱敏**：所有上报至 `input` / `output` 的文本均经过 `tracer.maskPII()` 过滤手机号与邮箱。
2. **工具参数**：`Tool_<name>` 节点仅记录 `argsHash` (SHA1 前 12 位) 与 `keyedFields` (参数名列表)，**严禁**上报原始参数明文。
3. **推理内容**：`DeepSeek_FC_Step` 的输出仅包含经过 `sanitizeReasoningSummary` 脱敏后的摘要。
4. **Prompt 版本**：`Generation` 节点通过 `promptVersion` 与 `promptHash` 追踪 System Prompt 变更，而不重复上报完整的 System 内容。

---

## 12. 文档维护

- 代码变更涉及编排顺序、新分支、新环境变量或 SSE 语义时：**同步更新本文**。  
- 若仅新增工具或意图映射：优先更新 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)，并在本文 §1 表格或 §7 中必要时补一行「锚点」说明。
