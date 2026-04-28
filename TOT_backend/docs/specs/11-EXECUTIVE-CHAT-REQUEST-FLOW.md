# Executive Chat 请求处理流程（实现对照）

**版本:** 4.0.2 | **更新日期:** 2026-04-28 | **状态:** Current

**本文定位：** 以当前后端代码为准，描述「用户发送一条消息 -> 助手回复落库」的完整调用链。  
**字段级 HTTP 契约：** 见 [04-API-SPEC.md](./04-API-SPEC.md) §6。  
**意图与工具：** 见 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md)。

---

## 1. 当前生效链路（代码事实）

当前线上请求主链路仍为：

`routes/chat.js` -> `chatService.js` -> `chatAgentRunner.js` -> `chatToolsService.js` -> `chat_tools/*.js`

对应实现文件：

| 层级 | 路径 |
|---|---|
| 路由 | `TOT_backend/server/routes/chat.js` |
| 会话/落库/SSE | `TOT_backend/server/services/chatService.js` |
| Agent 编排（当前生效） | `TOT_backend/server/services/chatAgentRunner.js` |
| 意图分类 | `TOT_backend/server/services/chatIntentService.js` |
| 工具注册与执行 | `TOT_backend/server/services/chatToolsService.js` |
| LLM 与流式 | `TOT_backend/server/utils/ai.js` |

### 1.1 LangGraph 目录现状（尚未接入主链）

仓库中存在 `TOT_backend/server/agent/graph/` 与 `TOT_backend/server/agent/queue/` 原型实现（含 `state.js`、`nodes.js`、`graph.js`、`bullMqProducer.js`），但 `chatService.js` 当前并未调用 `buildGraph()` 或 `app.invoke()`。  
因此，本文件「Current」口径以 `chatAgentRunner.js` 实际行为为准。

---

## 2. 入口与会话处理（`chatService.js`）

1. 校验会话存在且归属用户。
2. `handleIncomingMessage()`：
   - 支持 `client_message_id` 幂等检查；
   - 若包含 `clarificationResponse.toolCallId`，会先写一条 `tool` 角色消息，再写本轮 `user` 消息（用于澄清恢复）。
3. 从 `chat_sessions` 构造 `regionScope`（`national` / `regional` / `rtm`）。
4. 加载历史 `loadFormattedHistory()`（当前限制 `LIMIT 10`）。
5. 调用 `chatAgentRunner.run(...)`。
6. 写入 assistant 消息并更新 `chat_sessions.last_active`。
7. 返回非流式 JSON，或在流式模式下发送 SSE `delta` / `done` / `error`。

---

## 3. 编排模式与分支（`chatAgentRunner.js`）

### 3.1 执行模式

- 默认 `CHAT_AGENT_MODE=function_calling`（未设置时即此值）。
- 其它值走 `intent_routing` 兜底路径。

### 3.2 前置判断

1. `classifyExecutionMode()`：`chat_only` 或 `tool_action`。
2. `checkIntentSafety()`：语义监工，命中危险操作返回 `deny`。
3. 若 `chat_only` 或 `deny`，直接返回不调工具。

### 3.3 Function Calling 主路径

`runFunctionCalling()` 流程：

1. 组装 `system + history + user` 消息；
2. 调 `chatWithToolsStream()`（`utils/ai.js`）拿流式 `content/tool_calls`；
3. 若有工具调用：
   - `chatToolsService.executeByName()` 执行；
   - 发送 `tool_start/tool_end`（映射到 SSE `delta.phase`）；
   - 追加 `assistant(tool_calls)` 与 `tool(tool_call_id)` 进消息，进入下一轮；
4. 迭代上限 `MAX_ITERATIONS=5`；
5. 结束后回传 `markdownContent`、`_intentType`、`_toolMeta`。

### 3.4 Intent Routing 兜底路径

`runIntentRouting()` 流程：

1. `chatIntentService.classify()` 产出 `intentType + entities`；
2. `toolMap` 做 intent -> tool 映射；
3. 单工具执行后由 `chatAnswerService.format()` 生成结构化回答；
4. 返回 `overview/keyNumbers/attentionPoints/followUpSuggestions`（必要时兼容 `markdownContent`）。

---

## 4. 工具层护栏（`chatToolsService.js`）

`executeByName()` 包含三层约束：

1. 工具白名单与动态注册校验；
2. 参数 schema 基础校验（required/type）；
3. 权限校验（`requiredRole` / `scopePolicy`）。

统一错误包装为：

- `TOOL_NOT_FOUND`
- `INVALID_PARAMETERS`
- `PERMISSION_DENIED`
- `TIMEOUT_ERROR`
- `EXECUTION_ERROR`

---

## 5. SSE 行为（`sendMessageStream` / `regenerateLastAssistantStream`）

- 事件类型：`delta`、`done`、`error`。
- `delta` 载荷核心字段：`text`、`phase`、`reasoningLevel`。
  - `phase` 常见：`reasoning` / `content` / `tool_start` / `tool_end` / `clarify`。

### 5.1 Abort 现状

`chatService.js` 在客户端断开时会触发 `AbortController.abort()` 并把 `signal` 传给 `chatAgentRunner.run`。  
但 `utils/ai.js` 当前 `fetch` 尚未接入该 `signal`，因此上游请求不一定及时中断，属已知实现差距。

---

## 6. 澄清恢复（Clarify/Resume）

当工具返回 `needDisambiguation` 时：

1. `chatAgentRunner` 会通过 `phase: clarify` 下发候选信息；
2. 前端回传 `clarificationResponse`；
3. `chatService.handleIncomingMessage()` 写入 `tool` 行 + `user` 行，后续按普通请求继续跑。

当前恢复机制仍基于消息序列拼接，并非 LangGraph Checkpointer 恢复。

---

## 7. 记忆机制（当前）

- 当前主链仍使用 `chatMemoryService.getMemories()/extract()`；
- 在 `sendMessage/sendMessageStream` 末尾以 `setImmediate` 触发 `chatMemoryService.extract(sessionId)`；
- `agent/queue/bullMqProducer.js` 为队列原型，尚未接入主请求流程。

---

## 8. 遥测（`tracer.js`）

当前链路已有 trace/span/generation 打点（如 `FC_Loop`、`DeepSeek_FC_Step`、`Tool_<name>`、`SSE_Stream`）。  
Langfuse 指标与评测框架以实际打点字段为准，详见计划文档附录 D。

---

## 9. 维护规则

- 编排流程、模式开关、SSE phase 语义有变更时，同步更新本文。
- 意图或工具映射变化，优先更新 [10-EXECUTIVE-CHAT-INTENTS-TOOLS.md](./10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) 并在本文补流程影响。
- 若后续切到 LangGraph 主链，本文需整体改写为 Graph 节点级流程，并同步 `09/12`。
