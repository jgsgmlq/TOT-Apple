# Executive Chat 请求流转与代码路径说明 (Request Flow)

**最后更新：** 2026-04-30  
**适用范围：** `TOT_backend/server/services/chatService.js`, `server/agent/graph/*`, `server/services/chatAgentRunner.js` (Legacy)  
**文档目的：** 为后端开发者提供一幅高清的“请求处理地图”，从 Express 路由接收到 HTTP 请求开始，一步步追踪消息如何流经各种安全校验、持久化逻辑、大模型调度引擎（LangGraph），并最终通过 SSE 返回给前端。

---

## 1. 宏观请求入口：`chatService` 的分发策略

所有的前端 Chat 请求首先进入 `server/routes/chat.js`，然后分发给 `chatService.js`。系统根据 `stream` 参数的值，决定请求流入哪个编排引擎：

| 前端 `stream` 参数 | 后端进入方法 | 实际使用的编排引擎 | 说明 |
|---|---|---|---|
| `true` 或 `'langgraph'` | `sendMessageStreamLangGraph` | **LangGraph** (`graph.js`) | **当前默认主链路**，支持 HITL 打断恢复和全功能调用。 |
| `'legacy_stream'` | `sendMessageStream` | `chatAgentRunner.run()` | 旧版流式链路（回退/遗留）。 |
| `false` 或 未传 | `sendMessage` | `chatAgentRunner.run()` | 非流式同步 JSON 返回。 |
| `/resume` 路由 | `resumeMessageStreamLangGraph` | **LangGraph** (Command resume) | 专用于处理澄清（HITL）后的恢复请求。 |

---

## 2. 默认主链路：LangGraph (StateGraph) 执行流

当请求进入 `sendMessageStreamLangGraph` 时，系统的工作流如下：

### 2.1 准备期 (Prep & Init)
1. **鉴权与权限构建**：读取 `chat_sessions` 确认归属，基于 `session.regions` 构建 `regionScope`（数据越权护栏）。
2. **幂等校验与历史拼装**：调用 `handleIncomingMessage` 拦截重复 `messageId`，调用 `loadFormattedHistory` 从 SQLite 提取最近十条聊天记忆。
3. **SSE 通道初始化**：写入 `text/event-stream` 头部，并挂载 `sseEmitter` 监听器，用于将 LangGraph 的生命周期事件映射为 SSE 的 `delta` 数据块。

### 2.2 LangGraph 图执行 (Graph Invocation)
图（Graph）由 `buildGraph()` 编译，状态模型为 `ExecChatGraphState`。图的节点（Nodes）依次如下：

1. **LoadContext (记忆注入)**：查询 BullMQ 产生的 `user_memories`，将长期偏好写入上下文。
2. **ContextAnalyzerRouter (意图路由)**：调用 LLM 对 `userMessage` 判定 `intent`（如 `query_metrics`）、安全状态（`risk_flags`）和实体置信度。若意图为纯聊天 (`chat_only`)，则直接结束。
3. **ToolRetrieve (工具召回)**：根据 `intent` 去查 `INTENT_TOOL_MAP`，得到当前候选工具。
4. **fc_LlmToolCallStep (模型决策)**：把工具 Schema 发给 DeepSeek。若模型输出 `tool_calls`，则继续向下；若输出纯文本，则转最终输出。
5. **fc_ValidateParams (参数校验 & HITL 触发)**：
   - 校验 `tool_calls` 的必填参数和枚举。
   - 评估实体置信度（如重名门店 `low_confidence_entity`）。
   - **若需打断**：挂起图状态，发送 `phase: clarify` 的 SSE 给前端，并停止响应。
6. **fc_ParamRepair (参数修复)**：若校验不通过，尝试让模型自行修参，受最大修复次数保护。
7. **fc_ExecuteTool (工具执行)**：通过 `chatToolsService.executeByName` 运行真实代码（如查库），携带 `regionScope` 护栏。
8. **fc_MergeToolResults (合并递回)**：将结果组装为 `ToolMessage` 压入历史，路由回 `fc_LlmToolCallStep` 进行下一轮 FC (循环)。
9. **FinalResponseStep (输出汇总)**：无工具可调，或步数超限时，生成面向用户的 Markdown。
10. **PersistAndEmit (异步发射)**：触发 BullMQ 异步抽取长期记忆。

### 2.3 收尾与落库 (Finalize)
LangGraph 返回最终状态后，`chatService` 将 AI 的 Markdown 存入 `chat_messages`，更新 `last_active`，并以 `[DONE]` 块结束 SSE 流。

---

## 3. Human-in-the-loop (HITL)：Clarify -> Resume 闭环

当请求含糊不清（如：参数缺失、置信度低），LangGraph 会触发真实的代码挂起。

### 3.1 挂起阶段 (Interrupt)
1. 节点 `fc_ValidateParams` 发现异常，返回 `{ fc_next_action: 'hitl', interrupt_payload: {...} }`。
2. 节点 `humanInTheLoopGate` 执行 `interrupt(payload)`。LangGraph **立刻休眠**，状态持久化到 `SqliteSaver` 中。
3. `chatService` 捕捉到打断信号，向前端下发一条 `phase: 'clarify'` 的 SSE，内含选项卡片（如门店列表）。HTTP 请求结束。

### 3.2 恢复阶段 (Resume)
1. 用户在前端卡片点击后，前端请求 `POST /sessions/{id}/resume`，携带 `ResumePayload`（含 `resume_type` 和 `value`）。
2. 后端进入 `resumeMessageStreamLangGraph`，使用相同的 `thread_id` 和一个装载着用户选择的 `Command({ resume: resumePayload })` 去唤醒沉睡的 LangGraph。
3. 图在 `humanInTheLoopGate` 醒来：
   - 若 `resume_type === 'slot_fill'`（补参）：将用户值打入 `pending_tool_calls`，跳回 `fc_ValidateParams` 重新校验。
   - 若 `resume_type === 'intent_shift'`（用户改口）：清空当前待执行工具，将用户新话语推入队列，**伪造 ToolMessage 闭合上一轮**，然后跳回 `ContextAnalyzerRouter` 重新理解。
   - 若 `resume_type === 'cancel'`：直接结束并提示用户已取消。

---

## 4. 旧版链路：AgentRunner (Legacy Stream)

**注意：此链路已降级为遗留代码，仅在 `stream: 'legacy_stream'` 或非流式请求时触发。**

在引入 LangGraph 之前，AgentRunner 依赖自己写的 `while` 循环来管理多轮 FC 调用：
1. `chatAgentRunner.run()` 是入口。
2. 内部根据 `CHAT_AGENT_MODE` 决定使用 `runIntentRouting`（规则映射）或 `runFunctionCalling`（动态调用）。
3. 循环校验工具执行结果，通过 `streamFormatCallbacks.onDelta` 手动发射 `tool_start` 和 `reasoning`。
4. HITL 和多步防死循环在这套旧架构下较为脆弱，因此已被 LangGraph 替代。