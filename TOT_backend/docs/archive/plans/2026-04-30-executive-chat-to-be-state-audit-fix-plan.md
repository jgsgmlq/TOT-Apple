# Executive Chat To-Be 状态图逐状态检查与修复计划

**状态：** Draft  
**创建日期：** 2026-04-30  
**适用范围：** Executive Chat 后端编排层、工具层、SSE 协议、HITL/Resume、记忆链路与必要前端对接  
**核心基线：** [`appendix-a-as-is-vs-to-be.md`](./appendix-a-as-is-vs-to-be.md) 的 To-Be 单层 `StateGraph` 状态图  
**给执行 AI 的目标：** 按 To-Be 状态图从入口到出口逐状态检查现有代码，修复每个状态的实现缺口，并在每个任务中同步验证 API、数据库、权限、SSE 和前端兼容性。

---

## 1. 执行总原则

1. **按状态顺序推进。** 不要先改工具层或前端细节，必须先确认入口、会话、状态字段和图边界，否则后面的节点修复会反复返工。
2. **每个状态先审计再修改。** 每个任务开始时先记录 As-Is：当前代码入口、实际行为、与 To-Be 的差距、需要保留的兼容行为。
3. **对外 API 默认不破坏。** 除非任务明确要求修改契约，否则保持 `POST /chat/executive/sessions/*`、SSE `delta/done/error`、历史接口、feedback、regenerate 兼容。
4. **单图拍平。** 不引入 LangGraph Subgraph；状态字段集中在 `ExecChatGraphState` 第一层。
5. **只有一个工具执行引擎。** PoC/V1 以 `fc_*` 链路为唯一执行引擎；不要新增 Plan-Execute 第二路径。
6. **工具权限必须确定性校验。** Router/LLM 输出不能替代 `regionScope`、角色、`scopePolicy`、参数 schema 的硬校验。
7. **HITL 必须安全恢复。** Resume 时按 `slot_fill` / `intent_shift` 判断恢复入口；意图漂移必须重新过 `ContextAnalyzerRouter`。
8. **主请求线程不做长期记忆 LLM 萃取。** 记忆提取只允许通过 `MemoryIngestRequested` 事件交给进程外 Worker。
9. **每次代码行为变化必须同步文档。** API、DB、状态字段、SSE phase、错误码变化要同步规格文档。

---

## 2. 必读参考文档

### 2.1 架构与状态图

| 文档 | 用途 |
|---|---|
| [`appendix-a-as-is-vs-to-be.md`](./appendix-a-as-is-vs-to-be.md) | To-Be 状态图、状态字段、节点职责、HITL 恢复规则、RoutingPolicy |
| [`2026-04-27-executive-chat-langgraph-migration-review.md`](./2026-04-27-executive-chat-langgraph-migration-review.md) | LangGraph 迁移背景、目标架构、范围与非目标 |
| [`2026-04-27-executive-chat-langgraph-implementation-task-list.md`](./2026-04-27-executive-chat-langgraph-implementation-task-list.md) | 已有任务清单和历史进度记录；执行前需用代码复核，不可直接相信完成度 |
| [`../internal/EXECUTIVE-CHAT-CODE-MAP.md`](../internal/EXECUTIVE-CHAT-CODE-MAP.md) | 当前文档/代码入口与 To-Be 节点映射 |
| [`../specs/12-AGENT-ARCHITECTURE.md`](../specs/12-AGENT-ARCHITECTURE.md) | Agent 架构与 LangGraph 目标态说明 |

### 2.2 API、SSE 与前端契约

| 文档 | 用途 |
|---|---|
| [`../specs/04-API-SPEC.md`](../specs/04-API-SPEC.md) §6 | Executive Chat HTTP/SSE 正本 |
| [`../specs/09-EXECUTIVE-CHAT.md`](../specs/09-EXECUTIVE-CHAT.md) | 产品能力、权限边界、流式协议、渲染框架 |
| [`../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) | intent/tool 映射、工具能力、扩展流程 |
| [`../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md`](../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md) | 当前/旧请求链路说明；执行时需与代码事实核对 |
| [`../frontend/05-EXECUTIVE-CHAT.md`](../frontend/05-EXECUTIVE-CHAT.md) | 前端对接说明；若与代码冲突，以代码 + 04 API 为准并同步修订 |

### 2.3 数据库、权限与测试

| 文档 | 用途 |
|---|---|
| [`../specs/01-DATA-MODEL.md`](../specs/01-DATA-MODEL.md) §10 | `chat_sessions` / `chat_messages` / `user_memories` / feedback 表结构正本 |
| [`../backend/03-DATABASE.md`](../backend/03-DATABASE.md) §10-12 | 数据库实现、迁移函数、硬删除、反馈表说明 |
| [`../specs/08-PERMISSION-MODEL.md`](../specs/08-PERMISSION-MODEL.md) | 角色与权限边界 |
| [`../specs/07-RTM-FILTER.md`](../specs/07-RTM-FILTER.md) | RTM / 区域过滤口径 |
| [`../tests/EXECUTIVE-CHAT-TEST-QUERIES.md`](../tests/EXECUTIVE-CHAT-TEST-QUERIES.md) | 端到端业务问题回归清单 |
| [`../tests/EXECUTIVE-CHAT-TESTING.md`](../tests/EXECUTIVE-CHAT-TESTING.md) | LangGraph 本地调试与 Langfuse 观测指南 |

---

## 3. 当前重点代码入口

### 3.1 后端

| 模块 | 文件 | 重点函数 |
|---|---|---|
| 路由入口 | `server/routes/chat.js` | `handleCreateSession`、`handlePostMessage`、`handleResume`、`handleRegenerate`、`mountChatRoutes` |
| 会话/SSE/落库 | `server/services/chatService.js` | `createSession`、`resolveRegionScope`、`handleIncomingMessage`、`sendMessage`、`sendMessageStream`、`sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph`、`regenerateLastAssistantStreamLangGraph`、`getHistory`、`deleteSessionById` |
| 旧编排器 | `server/services/chatAgentRunner.js` | `run`、`runFunctionCalling`、`runIntentRouting`、`checkIntentSafety`、`buildDisambiguationReply` |
| LangGraph 图 | `server/agent/graph/graph.js` | `buildGraph`、各 `routeAfter*` 条件边 |
| LangGraph 状态 | `server/agent/graph/state.js` | `ExecChatGraphState` |
| LangGraph 节点 | `server/agent/graph/nodes.js` | `loadContext`、`contextAnalyzerRouter`、`toolRetrieve`、`fc_*`、`humanInTheLoopGate`、`persistAndEmit` |
| RoutingPolicy | `server/agent/graph/routingPolicy.js` | `thresholds`、`tiers` |
| 工具注册/护栏 | `server/services/chatToolsService.js` | `loadTools`、`validateToolArgs`、`authorizeToolCall`、`executeByName` |
| 工具实现 | `server/chat_tools/*.js` | 各 `schema`、`meta`、`handler` |
| 矩阵查询 | `server/services/executiveMetricsQueryService.js` | `query`、`resolveTaskId`、`buildRegionFilter` |
| 记忆 | `server/services/chatMemoryService.js`、`server/agent/queue/*.js` | `getMemories`、`extract`、`publishMemoryIngestion`、`startMemoryWorker` |

### 3.2 前端

| 模块 | 文件 | 重点函数 / 组件 |
|---|---|---|
| 路由 | `TOT_frontend/src/router/index.ts` | `ExecutiveHomeRoute`、`ExecutiveLoginRoute` |
| 路由守卫 | `TOT_frontend/src/router/guards.ts` | `/executive/login`、`/executive/*` 分支 |
| API | `TOT_frontend/src/api/chat/index.ts` | `streamExecutiveChatMessage`、`streamRegenerateChatMessage`、`getChatHistory`、`deleteChatSession`、`submitChatFeedback` |
| 页面 | `TOT_frontend/src/views/executive/index.vue` | `onMounted`、`handleSend`、`handleStop`、`handleRegenerate`、`selectChat`、`removeChatFromSidebar` |
| 流式解析 | `TOT_frontend/src/utils/execStreamReply.ts` | `normalizeStreamDelta`、`feedExecStreamDelta`、`runExecStyleSseChat` |
| Markdown 渲染 | `TOT_frontend/src/views/executive/components/MarkdownRenderer.vue` | `processedData`、`sanitizedHtml` |

---

## 4. 推荐执行顺序总览

| 顺序 | 状态/模块 | 目标 |
|---:|---|---|
| 0 | Preflight 现状冻结 | 建立代码事实、测试基线、文档差异清单 |
| 1 | `Route /chat/*` | 明确 Executive 默认流式、legacy、非流式、resume、regenerate 路由策略 |
| 2 | `chatService` | 收口会话校验、SSE、checkpoint、落库、done payload、Abort |
| 3 | `ExecChatGraphState` | 补齐单层状态字段、reducer 与兼容字段 |
| 4 | `LoadContext` | 只做 Store 读，注入 Top-K 记忆，不阻塞主链路 |
| 5 | `ContextAnalyzerRouter` | 单次小模型输出安全、意图、实体、复杂度、恢复类型 |
| 6 | `QuickReply` / `DenyReply` | 替换占位回复，保证模板与 API 返回一致 |
| 7 | `HumanInTheLoopGate` / Checkpointer | 完整实现 clarify/interrupt/resume 安全恢复 |
| 8 | `ToolRetrieve` | 实现 Executive Local Registry Top-K 工具候选 |
| 9 | `fc_CheckSteps` / `RoutingPolicy` | 固化 L2/L3/L4 预算、循环上限和 fallback 计数 |
| 10 | `fc_LlmToolCallStep` | 工具调用 LLM、流式 token、safe history、Abort、无工具 finalize |
| 11 | `fc_CheckDuplicate` | 跳过重复工具调用并合并已知结果 |
| 12 | `fc_ValidateParams` | 动态 schema + 业务校验，失败进入 repair 或 HITL |
| 13 | `fc_ParamRepair` | 修参闭环、次数上限、失败后澄清/降级 |
| 14 | `fc_ExecuteTool` | 统一工具执行、scope/role 硬校验、超时、错误语义 |
| 15 | `fc_MergeToolResults` | 标准 ToolMessage、缓存、可恢复 super-step |
| 16 | `fc_FinalizeOrFallback` | 超步数、无工具、失败降级时生成最终 Markdown |
| 17 | `PersistAndEmit` | 图唯一出口：落库、SSE done、事件发布、trace metadata |
| 18 | `MemoryIngestRequested` / Worker | 进程外记忆萃取、幂等、TTL、失败重试 |
| 19 | 前端 `clarify/resume` | 接住 `InterruptPayload`，完成候选卡片与 resume API |
| 20 | 回归与文档同步 | 跑测试矩阵，同步 API/DB/specs |

---

## 5. 逐状态任务清单

### Task 0. Preflight 现状冻结

**目标：** 在修改前冻结当前行为，避免 AI 依据过期文档误判。

**检查文件 / 函数：**

| 文件 | 函数 / 内容 |
|---|---|
| `server/routes/chat.js` | `handlePostMessage` 对 `stream` 的分支 |
| `server/services/chatService.js` | `sendMessage`、`sendMessageStream`、`sendMessageStreamLangGraph` |
| `server/agent/graph/graph.js` | 当前节点与边 |
| `server/agent/graph/nodes.js` | 当前 stub / 占位函数 |
| `TOT_frontend/src/api/chat/index.ts` | `streamExecutiveChatMessage` body 是否默认 `stream: true` |
| `TOT_frontend/src/views/executive/index.vue` | `handleSend` 默认发送路径 |

**执行步骤：**

- [ ] 记录当前默认链路：前端是否默认 `stream: true`，后端是否进入 `sendMessageStreamLangGraph`。
- [ ] 记录 legacy 链路：`stream === 'legacy_stream'` 是否仍可用。
- [ ] 记录非流式链路：不带 `stream` 时是否仍走 `chatAgentRunner.run`。
- [ ] 记录文档差异：`09/10/11/12` 与代码事实是否一致。
- [ ] 建立最小测试基线：会话创建、基础问题、工具问题、regenerate、history。

**验收：**

- [ ] 产出一段 As-Is 说明，写入本计划执行记录或相关进度文档。
- [ ] 任何后续修改都能说明是修复 To-Be 差距，而不是误删现有能力。

---

### Task 1. `Route /chat/*` 状态

**To-Be 位置：** `A[Route /chat/*] -> B[chatService]`

**目标：** 路由层只负责鉴权、ownership、模式选择和转发；不要在路由层塞业务状态。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/routes/chat.js` | `sameChatUser`、`requireSessionOwnership`、`handlePostMessage`、`handleResume`、`handleRegenerate`、`mountChatRoutes` |
| `server/middleware/auth.js` | `authenticate`、`requireRole` |
| `../specs/04-API-SPEC.md` | §6 Executive Chat Agent API |

**检查与修改顺序：**

- [ ] 核对 `/chat/executive/sessions`、`/messages`、`/resume`、`/feedback`、`/regenerate`、`/history`、`DELETE` 路由是否全部做 `authenticate`、`requireRole(['executive'])`、session ownership。
- [ ] 明确 `stream` 分支策略：`true | 'langgraph'` 进入 LangGraph，`'legacy_stream'` 进入旧链路，不带 `stream` 进入非流式。
- [ ] 如果 API 文档没有 `/resume` 或 SSE phase 约定，列为文档同步任务。
- [ ] 保证 dashboard chat 的路径前缀仍按 `central/admin` 角色隔离，不被 Executive 修复误伤。

**验收：**

- [ ] 非 owner 访问 session 返回 `CHAT_004`。
- [ ] session 不存在返回 `CHAT_003`。
- [ ] 非 executive 访问 `/chat/executive/*` 被拒绝。
- [ ] 路由层没有直接调用工具或读写消息内容。

---

### Task 2. `chatService` 状态

**To-Be 位置：** `B[chatService] -> LoadContext / Checkpointer / PersistAndEmit`

**目标：** `chatService` 负责 HTTP/SSE 边界、会话快照、checkpoint 编译、用户消息落库、最终结果兼容；Graph 内负责状态流转。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/services/chatService.js` | `resolveRegionScope`、`createSession`、`handleIncomingMessage`、`loadFormattedHistory`、`sendMessage`、`sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph`、`regenerateLastAssistantStreamLangGraph`、`storageContentFromAgentResult`、`buildExecutiveMessageApiData` |
| `server/utils/sseResponse.js` | `writeSseHeaders`、`createSseSender` |
| `server/db/index.js` | chat table migration / graph checkpoint DB 相关实现 |
| `../specs/01-DATA-MODEL.md` | §10 chat tables |
| `../backend/03-DATABASE.md` | §10-12 chat tables |

**检查与修改顺序：**

- [ ] 修复非流式 `sendMessage` 中读取 `req?.user?.roles` 的不一致：函数签名与调用参数必须统一。
- [ ] 统一 LangGraph `done` 事件 payload：必须能被前端 `onDone` 当作 `SendMessageResult` 消费，不能只发字符串 `[DONE]`。
- [ ] 检查 `req.on('close')` 与 `AbortController.signal` 是否完整传到 `app.invoke` 和 LLM invoke。
- [ ] 确认 `SqliteSaver` 的 DB 路径、连接生命周期和主业务 DB 不冲突。
- [ ] 明确用户消息与 assistant 消息落库边界：若 To-Be 要求 `PersistAndEmit` 负责落库，逐步从 `chatService` 外层迁出；迁移前保持兼容。
- [ ] 确认 `regenerateLastAssistantStreamLangGraph` 不会重复插入 user 消息或破坏历史顺序。
- [ ] 确认 `resumeMessageStreamLangGraph` 使用 `Command({ resume })` 时不伪造历史消息绕过安全检查。

**验收：**

- [ ] `stream: true` 能返回完整 `delta` 与结构化 `done`。
- [ ] abort 后不继续长时间消耗 LLM 请求。
- [ ] `/history` 能读到 user 和 assistant 两类消息。
- [ ] regenerate 后旧 assistant 的反馈/消息关系符合 API 文档。

---

### Task 3. `ExecChatGraphState` 状态模型

**To-Be 位置：** `ExecChatGraphState` 单层拍平

**目标：** 状态字段覆盖 To-Be 图需要的所有信息，reducer 行为可预测，不靠函数闭包或外层变量偷传状态。

**涉及文件 / 函数：**

| 文件 | 内容 |
|---|---|
| `server/agent/graph/state.js` | `ExecChatGraphState` |
| `server/agent/graph/graph.js` | 条件边使用到的 state 字段 |
| `server/agent/graph/nodes.js` | 所有节点读写 state 字段 |
| `appendix-a-as-is-vs-to-be.md` | A3 Graph State 建议 |

**检查与修改顺序：**

- [ ] 对照 A3，补齐必要字段：`mode`、`global_safety_decision` 或统一命名，`entities_raw`、`entities_confidence`、`memory_snippets`、`calledTools`、`reply_markdown`、`reply_structured`、`meta_trace_id`、`meta_fallback_count`。
- [ ] 统一命名：当前代码的 `safety` / `intent` / `hitl_status` 与文档中的 `global_safety_decision` / `human_in_the_loop_status` 要么映射清楚，要么统一。
- [ ] 检查 `messages` reducer 是否会在 resume 或重复 invoke 时重复追加旧消息。
- [ ] 检查 `toolResults` reducer 是否支持多工具结果，而不是只支持单个 tool call。
- [ ] 为 HITL payload 定义稳定结构：`type`、`prompt`、`options`、`agent_id`、`resume_token`、`resume_entry_node`、`safety_recheck_required`。

**验收：**

- [ ] 任一节点只读写 `ExecChatGraphState` 明确字段。
- [ ] `graph.js` 条件边不依赖可能为空或命名混乱的字段。
- [ ] resume 后 state 可序列化、可恢复、可审计。

---

### Task 4. `LoadContext`

**To-Be 位置：** `B -> LC[LoadContext Store检索 非LLM] -> CAR`

**目标：** 非 LLM、低延迟读取记忆/会话摘要，只注入可解释的 Top-K 上下文，不触发长期记忆写入。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `loadContext` |
| `server/services/chatMemoryService.js` | `getMemories` |
| `server/services/chatSessionStateService.js` | session 级工具结果缓存 |
| `server/utils/chatHistoryCompress.js` | 历史压缩 |
| `../specs/01-DATA-MODEL.md` | `user_memories` |

**检查与修改顺序：**

- [ ] 确认 `loadContext` 不调用 LLM。
- [ ] 将纯字符串 `memoryContext` 改为可追踪结构或同时保留 `memory_snippets`，包括 `text`、`score`、`source`。
- [ ] 限制注入长度，避免污染 Router prompt。
- [ ] 明确记忆命名空间：Executive Chat 只读取当前 `userId` 可见记忆。
- [ ] 如果读取失败，降级为空上下文，不中断主请求。

**验收：**

- [ ] 无记忆、空记忆、DB 异常三种场景均可继续进入 Router。
- [ ] 注入内容不会越权暴露其它用户偏好。
- [ ] TTFT 不因记忆读取明显恶化。

---

### Task 5. `ContextAnalyzerRouter`

**To-Be 位置：** `LC -> CAR[ContextAnalyzerRouter 单次小模型] -> router 输出`

**目标：** 一次轻量模型调用输出安全、意图、实体、复杂度、恢复类型；失败时可规则降级。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `contextAnalyzerRouter`、`getRouterModel` |
| `server/agent/graph/routingPolicy.js` | `thresholds` |
| `server/services/chatIntentService.js` | 旧 intent schema 参考 |
| `server/services/chatAgentRunner.js` | `classifyExecutionMode`、`checkIntentSafety`、`inferIntentFromMessage` 参考迁移 |
| `../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | intent 合法集合 |

**检查与修改顺序：**

- [ ] 定义 Router 输出 JSON schema，至少含：`mode`、`safety`、`intent`、`entities`、`entities_confidence`、`complexity_score`、`risk_flags`。
- [ ] 将危险写操作、发邮件/催办/改库等安全规则从旧 `checkIntentSafety` 合并进 Router prompt 和输出 schema。
- [ ] 加入结构化解析兜底：JSON parse 失败时使用规则降级，并记录 `meta_fallback_count`。
- [ ] 确认 `chat_only` 只覆盖寒暄/帮助，不误吞“记住偏好”等需要记忆事件的请求。
- [ ] 输出 `selected_tier` 时严格使用 `routingPolicy.thresholds`。
- [ ] 对 resume 请求增加 `resume_type` 判断：`slot_fill` 可回 FC，`intent_shift` 必须重跑 Router。

**验收：**

- [ ] Level 1/2/3 测试问题能输出合理 intent 和实体。
- [ ] 危险写操作进入 deny。
- [ ] 模糊门店、低置信实体进入 HITL，而不是猜测执行。
- [ ] Router 失败不导致 500。

---

### Task 6. `QuickReply` / `DenyReply`

**To-Be 位置：** `CAR -> chat_only -> QuickReply`；`CAR -> deny -> DenyReply`

**目标：** 替换占位字符串，输出可落库、可 SSE、可前端展示的 Markdown。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `finalResponseStep` |
| `server/services/chatService.js` | `buildExecutiveMessageApiData`、`storageContentFromAgentResult` |
| `../specs/09-EXECUTIVE-CHAT.md` | 只读边界和拒绝策略 |

**检查与修改顺序：**

- [ ] 将 `CHAT_MESSAGE` 替换为真实帮助文案，说明可查询范围。
- [ ] 将 `DENY_MESSAGE` 替换为只读拒绝文案，提供安全替代问法。
- [ ] 标记 `_intentType` 或 state `intent`，保证落库可分析。
- [ ] 确保 Quick/Deny 也经过 `PersistAndEmit`，返回统一 `SendMessageResult`。

**验收：**

- [ ] “你好/你能做什么”返回帮助文案。
- [ ] “帮我发催办/改数据库”返回拒绝文案。
- [ ] 前端显示 Markdown 正常，history 正常。

---

### Task 7. `HumanInTheLoopGate` / Checkpointer / Resume

**To-Be 位置：** `需澄清 -> HumanInTheLoopGate -> Checkpointer InterruptPayload -.-> resume 请求 -> chatService`

**目标：** 用 LangGraph interrupt/checkpointer 完整替换伪造历史消息恢复，且前端可消费。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `humanInTheLoopGate`、`fc_ValidateParams` 中触发 HITL 的逻辑 |
| `server/services/chatService.js` | `resumeMessageStreamLangGraph` |
| `server/routes/chat.js` | `handleResume` |
| `TOT_frontend/src/api/chat/index.ts` | 需要新增 `resumeExecutiveChatMessage` 或等价函数 |
| `TOT_frontend/src/views/executive/index.vue` | clarify card / resume 提交 |
| `../specs/04-API-SPEC.md` | 需要补 `/resume` 契约时同步 |

**检查与修改顺序：**

- [ ] 定义 `InterruptPayload` 的稳定 wire shape。
- [ ] 后端 `phase: 'clarify'` 与 LangGraph `interrupt()` payload 对齐；不要同时混用旧 `clarify_request` JSON 和新 payload 造成前端分叉。
- [ ] `resumeMessageStreamLangGraph` 必须校验 session ownership 和 resume token。
- [ ] 实现 `resume_type` 判断：补槽恢复从 `fc_CheckSteps` 或指定节点继续；意图变更恢复重跑 `ContextAnalyzerRouter`。
- [ ] 前端新增 resume API 封装。
- [ ] 前端新增 Clarification UI：候选列表、禁用重复点击、失败重试、已选择状态。
- [ ] 历史落库要能区分用户原始问题、clarify 选择、assistant 最终回答。

**验收：**

- [ ] “南京店”类重名门店触发候选卡片。
- [ ] 点击候选后不刷新页面，继续输出该门店明细。
- [ ] resume 不能越权访问其它 session。
- [ ] 用户在澄清时改问“帮我发邮件”必须重新过安全 Router。

---

### Task 8. `ToolRetrieve`

**To-Be 位置：** `tool_action 且槽位可接受 -> ToolRetrieve Top-K LocalRegistry`

**目标：** 只向 LLM 暴露 Executive Chat 相关 Top-K 工具，减少误选工具。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `toolRetrieve`、`getLlmWithTools` |
| `server/services/chatToolsService.js` | `TOOL_SCHEMAS`、`loadTools` |
| `server/chat_tools/*.js` | `schema.function.description`、`meta` |
| `server/agent/graph/routingPolicy.js` | `tool_top_k`、`topk_min_score` |
| `../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | 工具清单 |

**检查与修改顺序：**

- [ ] 实现 Executive Local Registry，不要把非 Executive 工具暴露给图。
- [ ] 按 intent/entities/complexity 选 Top-K 工具，并写入 state。
- [ ] `fc_LlmToolCallStep` 只 bind `ToolRetrieve` 产出的候选工具。
- [ ] 候选工具记录 `name`、`score`、`reason`，写入 trace metadata。
- [ ] Top-K 弱命中时按 RoutingPolicy 扩容一次，仍失败则澄清或降级。

**验收：**

- [ ] `project_status` 只暴露任务列表相关工具或少量候选。
- [ ] `matrix_query` 优先暴露 `queryExecutiveMetrics`。
- [ ] 工具候选不会包含 dashboard 专用工具。

---

### Task 9. `fc_CheckSteps` / `RoutingPolicy`

**To-Be 位置：** `ToolRetrieve -> fc_CheckSteps -> under cap / over cap`

**目标：** 统一控制 FC 循环预算、修参次数、fallback 次数和复杂度档位。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/graph.js` | `routeAfterFcCheckSteps` |
| `server/agent/graph/nodes.js` | `fc_CheckSteps` |
| `server/agent/graph/routingPolicy.js` | `thresholds`、`tiers` |
| `appendix-a-as-is-vs-to-be.md` | A8 RoutingPolicy |

**检查与修改顺序：**

- [ ] 确认 `fc_super_step_count` 与 `fc_current_step` 的语义，不要混用。
- [ ] over cap 时进入 `fc_FinalizeOrFallback`，不要直接 `PersistAndEmit` 丢失最终总结。
- [ ] 将 `max_fallback_count_per_request` 加入 state 和 policy。
- [ ] 记录 `selected_tier`、`tier_latency_ms`、`tier_cost_tokens`、`fallback_to_next`。
- [ ] 当前请求升级后不要在同轮降档。

**验收：**

- [ ] L2/L3/L4 的最大步数符合 policy。
- [ ] 超步数时用户收到可解释的降级回复。
- [ ] Trace 中能看到 tier 和步数。

---

### Task 10. `fc_LlmToolCallStep`

**To-Be 位置：** `fc_CheckSteps -> fc_LlmToolCallStep -> no tools / has tools`

**目标：** 可靠地向 LLM 提供安全历史和候选工具，流式输出 reasoning/content，并支持 abort。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_LlmToolCallStep`、`getFcModel`、`getLlmWithTools` |
| `server/utils/ai.js` | 旧 `chatWithToolsStream` 参考 |
| `server/utils/fcStreamDeltaSplit.js` | 旧流式拆分参考 |
| `TOT_frontend/src/utils/execStreamReply.ts` | 前端 phase 消费 |

**检查与修改顺序：**

- [ ] 统一 `messagesToSend` 组装规则，避免 OpenAI/LangChain tool message 顺序错误。
- [ ] 引入 `ToolRetrieve` 候选工具，而不是每轮 bind 全量工具。
- [ ] 保证 `handleLLMNewToken` 中 reasoning/content phase 与前端兼容。
- [ ] `signal` 必须传入 `llm.invoke`。
- [ ] 当前 step 达上限时禁止继续 bind tools，让模型 finalize。
- [ ] 无 tool_calls 时将最终正文写入 `reply_markdown` 或 `finalResponse`。

**验收：**

- [ ] 有工具调用时进入 `fc_CheckDuplicate`。
- [ ] 无工具调用时进入 finalize。
- [ ] 前端可看到流式正文和思考面板。
- [ ] Stop 后请求尽快停止。

---

### Task 11. `fc_CheckDuplicate`

**To-Be 位置：** `has tools -> fc_CheckDuplicate -> dup skip / validate`

**目标：** 避免同一轮重复调用相同工具和相同参数，复用已有结果。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_CheckDuplicate` |
| `server/services/chatSessionStateService.js` | `buildScopeFingerprint`、session cache |
| `server/services/chatAgentRunner.js` | `buildToolCacheSignature` 参考 |

**检查与修改顺序：**

- [ ] 定义 tool call signature：`toolName + normalizedArgs + scopeFingerprint`。
- [ ] 查 state `toolResults` 和 session cache，命中则标记 dup skip。
- [ ] dup skip 仍要进入 `fc_MergeToolResults`，给模型一个标准 `ToolMessage`。
- [ ] 记录 `cache_hit` / `duplicate_skip` trace metadata。

**验收：**

- [ ] 同一参数不会重复打 DB。
- [ ] scope 不同的查询不会误复用缓存。
- [ ] dup skip 后模型仍能生成最终回答。

---

### Task 12. `fc_ValidateParams`

**To-Be 位置：** `fc_CheckDuplicate -> fc_ValidateParams -> ok / fail / HITL`

**目标：** 在工具执行前完成 JSON Schema 与业务规则校验。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_ValidateParams`、`ToolValidationSchemas` |
| `server/services/chatToolsService.js` | `validateToolArgs`、`authorizeToolCall` |
| `server/chat_tools/*.js` | `schema.function.parameters`、`meta.requiredRole`、`meta.scopePolicy` |
| `server/utils/chatUtils.js` | `buildRegionFilter` |

**检查与修改顺序：**

- [ ] 用工具自身 JSON Schema 动态校验，避免只为少数工具手写 Zod。
- [ ] 校验 required、type、enum、数组元素、跨字段约束，如 `taskName/productName` 至少一个。
- [ ] 业务校验包括：区域/RTM scope、工具 role、`national_only`、门店是否在授权范围。
- [ ] 参数缺失但可澄清时进入 HITL；参数格式可修时进入 `fc_ParamRepair`。
- [ ] 错误结构统一为 `violations[]`，包含 `field`、`code`、`message`、`repairable`。

**验收：**

- [ ] 缺 metrics 的矩阵查询不会直接打 DB。
- [ ] 越权 region/store 被拦截。
- [ ] 可修参数进入 repair，需用户选择的进入 HITL。

---

### Task 13. `fc_ParamRepair`

**To-Be 位置：** `fc_ValidateParams -> fail -> fc_ParamRepair -> fc_ValidateParams`

**目标：** 让模型基于明确 violations 修复参数，限制次数，失败后可解释降级。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_ParamRepair`、`fc_ValidateParams` |
| `server/agent/graph/routingPolicy.js` | `max_repair_attempts` |

**检查与修改顺序：**

- [ ] `fc_ParamRepair` 输入必须包含结构化 violations，不只是一段模糊错误文本。
- [ ] 修参 ToolMessage 必须绑定正确 `tool_call_id`。
- [ ] 超过 `max_repair_attempts` 后进入 HITL 或 `fc_FinalizeOrFallback`。
- [ ] 修参失败时向用户说明缺少哪些关键信息。

**验收：**

- [ ] 一次参数缺失可自动修复。
- [ ] 连续失败不会无限循环。
- [ ] 前端收到的是自然语言说明，不是 `SYSTEM_ERROR`。

---

### Task 14. `fc_ExecuteTool`

**To-Be 位置：** `fc_ValidateParams -> ok -> fc_ExecuteTool`

**目标：** 统一工具执行、超时、错误包装、权限硬校验和 SSE 工具边界事件。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_ExecuteTool` |
| `server/services/chatToolsService.js` | `executeByName`、`authorizeToolCall`、`executeWithTimeout` |
| `server/chat_tools/*.js` | 所有 handler |
| `server/services/executiveMetricsQueryService.js` | `query` |

**检查与修改顺序：**

- [ ] `fc_ExecuteTool` 不重复实现权限规则，优先复用 `chatToolsService.executeByName`。
- [ ] 命名空间剥离逻辑必须安全：只允许 `executive_chat` registry 中的工具。
- [ ] 发送 `tool_start` / `tool_end` SSE 时包含稳定 `toolName`、`status`、可选 `durationMs`。
- [ ] 工具错误保持统一 code：`TOOL_NOT_FOUND`、`PERMISSION_DENIED`、`INVALID_PARAMETERS`、`TIMEOUT_ERROR`、`EXECUTION_ERROR`。
- [ ] 工具 handler 不得返回泄露 SQL 或 stack trace 给模型/用户。

**验收：**

- [ ] 每个工具至少有一条成功执行测试。
- [ ] 权限、参数、超时错误均可被最终回答解释。
- [ ] 前端工具状态指示器可展示具体工具名。

---

### Task 15. `fc_MergeToolResults`

**To-Be 位置：** `fc_ExecuteTool -> fc_MergeToolResults -> fc_CheckSteps`

**目标：** 将工具结果标准化合并回 state 和消息历史，形成可 checkpoint 的 super-step。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `fc_MergeToolResults` |
| `server/agent/graph/state.js` | `messages`、`toolResults` reducer |
| `server/services/chatSessionStateService.js` | `addRecord`、`getLatestBySignature` |

**检查与修改顺序：**

- [ ] 支持单轮多个 tool_calls，而不是只取第一个。
- [ ] 每个工具结果生成对应 `ToolMessage`，`tool_call_id` 必须匹配。
- [ ] 将标准化摘要写入 session cache，便于绘图/追问复用。
- [ ] `fc_super_step_count` 只在工具结果成功合并后递增。
- [ ] 大结果要摘要化，避免下一轮 prompt 爆长。

**验收：**

- [ ] 多工具调用能全部合并。
- [ ] checkpoint 恢复后不会丢失已完成工具结果。
- [ ] 追问能复用上一轮工具结果。

---

### Task 16. `fc_FinalizeOrFallback`

**To-Be 位置：** `fc_CheckSteps over cap` 或 `LLM no tools -> FIN`

**目标：** 明确最终回答生成节点，避免超步数直接落空。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/graph.js` | `routeAfterFcCheckSteps`、`routeAfterFcLlm` |
| `server/agent/graph/nodes.js` | 需要新增或完善 `fc_FinalizeOrFallback` / `finalResponseStep` |
| `server/services/chatAnswerService.js` | 旧格式化参考 |

**检查与修改顺序：**

- [ ] 增加明确的 `fc_FinalizeOrFallback` 节点，替代 over cap 直接进 `PersistAndEmit`。
- [ ] 如果已有 `finalResponse`，直接规范化输出。
- [ ] 如果只有 tool results，调用 LLM 或规则模板生成 Markdown 总结。
- [ ] 如果工具失败或超步数，输出可行动的缩小范围建议。
- [ ] 写入 `reply_markdown` / `reply_structured`，供 `PersistAndEmit` 使用。

**验收：**

- [ ] 超步数时不会出现空回答。
- [ ] 工具结果存在时最终回答包含关键数据。
- [ ] Markdown 不输出裸 JSON。

---

### Task 17. `PersistAndEmit`

**To-Be 位置：** `FIN / QuickReply / DenyReply -> PersistAndEmit -> __end__`

**目标：** 成为图唯一出口，负责最终结果规范化、落库、SSE done 和记忆事件发布。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/graph/nodes.js` | `persistAndEmit` |
| `server/services/chatService.js` | 当前 assistant 落库与 SSE done 逻辑 |
| `server/utils/sseResponse.js` | SSE 发送格式 |
| `server/db/index.js`、`server/db/schema.sql` | chat tables |
| `../specs/04-API-SPEC.md` | SSE done payload |
| `../specs/01-DATA-MODEL.md` | chat message 字段 |

**检查与修改顺序：**

- [ ] 设计迁移策略：先保持 `chatService` 落库，还是将 assistant 落库移动到 `PersistAndEmit`。一次只采用一种，避免双写。
- [ ] `PersistAndEmit` 输出标准 `SendMessageResult`：`messageId`、`replyContent`、`markdownContent`、`responseTime`、`contextId`、`timestamp`。
- [ ] SSE `done` 必须发送上述 result，而不是字符串。
- [ ] 落库内容优先 Markdown；结构化 replyContent 保持兼容。
- [ ] 记录 trace metadata：`selected_tier`、`fc_steps_used`、`repair_attempts`、`intent`、`toolNames`、`error_code`。
- [ ] 成功落库后发布 `MemoryIngestRequested`，失败不应影响已返回的主响应。

**验收：**

- [ ] 所有路径最终都只经过一个出口。
- [ ] 前端 `onComplete` 可以收到完整 `SendMessageResult`。
- [ ] `/history` 能展示最终 assistant 回复。
- [ ] 记忆事件不会阻塞主请求。

---

### Task 18. `MemoryIngestRequested` / `MemoryWorker`

**To-Be 位置：** `END -.-> EVT[MemoryIngestRequested] -> WK[MemoryWorker]`

**目标：** 进程外异步记忆链路可重试、可幂等、可观测。

**涉及文件 / 函数：**

| 文件 | 函数 |
|---|---|
| `server/agent/queue/bullMqProducer.js` | `publishMemoryIngestion` |
| `server/agent/queue/bullMqWorker.js` | `startMemoryWorker` |
| `server/services/chatMemoryService.js` | `extract`、`getMemories`、写入策略参考 |
| `server/db/schema.sql`、`server/db/index.js` | `user_memories` |
| `../specs/01-DATA-MODEL.md` | `user_memories` 字段与索引 |

**检查与修改顺序：**

- [ ] 确认 Producer 无 Redis 时失败可降级，不影响主请求。
- [ ] Worker 写入 `user_memories` 时补齐幂等：`memory_hash` 或等价去重。
- [ ] 实现 TTL 或过期清理策略；SQLite 中需记录可清理字段或定时任务。
- [ ] Worker LLM 失败要按 BullMQ retry，不吞错误。
- [ ] Langfuse / 日志记录 memory extraction 成本和结果。

**验收：**

- [ ] “记住偏好”类请求可异步进入 `user_memories`。
- [ ] 重复事件不会重复写同一记忆。
- [ ] Redis 不可用时主聊天仍成功。

---

### Task 19. 前端 `clarify/resume`

**目标：** 前端接住 To-Be HITL，不让后端 interrupt 成为孤岛。

**涉及文件 / 函数：**

| 文件 | 函数 / 组件 |
|---|---|
| `TOT_frontend/src/api/chat/index.ts` | 新增 `resumeExecutiveChatMessage` / SSE resume wrapper |
| `TOT_frontend/src/views/executive/index.vue` | `handleSend`、新增 clarify state、候选选择 handler |
| `TOT_frontend/src/utils/execStreamReply.ts` | `normalizeStreamDelta`、`feedExecStreamDelta` 支持 `phase: clarify` |
| `TOT_frontend/src/views/executive/components/` | 新增 `ClarificationCard.vue` 或合适组件 |
| `TOT_frontend/src/types/chat.d.ts` | 如需新增 `InterruptPayload` 类型 |

**检查与修改顺序：**

- [ ] 扩展 SSE delta 类型，识别 `phase: 'clarify'`。
- [ ] 渲染候选卡片：select/input/confirm 三种 payload 类型至少支持 select。
- [ ] 点击候选后调用 `/chat/executive/sessions/:sessionId/resume`，传 `resumePayload` 和 `stream: 'langgraph'`。
- [ ] 防重复点击：提交后禁用候选项。
- [ ] resume 后继续写入同一 AI 气泡或按产品要求新增用户选择气泡。
- [ ] 加载历史时能展示消歧后的最终回答，不依赖中间 interrupt payload。

**验收：**

- [ ] Level 3.1/3.2 用例通过。
- [ ] 移动端候选卡片可用。
- [ ] 网络失败时可重试或恢复输入，不丢会话。

---

### Task 20. 回归、评测与文档同步

**目标：** 确认逐状态修复没有破坏 API、DB、权限、SSE、前端交互。

**涉及文件 / 脚本：**

| 文件 | 用途 |
|---|---|
| `server/scripts/evaluate_langgraph.js` | LangGraph 自动评测 |
| `server/scripts/fixtures/intent-golden.json` | intent golden set |
| `server/scripts/test-fc-stream-splitter.js` | 流式 phase 拆分回归 |
| `server/test-echat-feedback.sh` | feedback / regenerate / history 参考 |
| `docs/tests/EXECUTIVE-CHAT-TEST-QUERIES.md` | UAT 提问清单 |
| `docs/tests/EXECUTIVE-CHAT-TESTING.md` | Langfuse 调试流程 |

**必须覆盖的测试场景：**

- [ ] 会话创建、删除、历史分页、feedback、regenerate。
- [ ] 基础完成率查询、任务列表、预警门店、区域下钻、门店下钻。
- [ ] `queryExecutiveMetrics` 多维/多指标/排序。
- [ ] 权限：national / regional / rtm。
- [ ] HITL：重名门店 clarify + resume。
- [ ] 安全：发邮件/催办/修改数据被拒绝。
- [ ] Abort：停止生成后服务端尽快收敛。
- [ ] 记忆：偏好写入、下一轮读取、Redis 不可用降级。
- [ ] 前端：Markdown、echarts、suggestions、reasoning、tool status。

**文档同步要求：**

- [ ] API/SSE/错误码变化：同步 `docs/specs/04-API-SPEC.md`。
- [ ] DB/表字段/索引/TTL 变化：同步 `docs/specs/01-DATA-MODEL.md` 和 `docs/backend/03-DATABASE.md`。
- [ ] intent/tool/参数变化：同步 `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`。
- [ ] 请求链路变化：同步 `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md`。
- [ ] Agent 架构变化：同步 `docs/specs/12-AGENT-ARCHITECTURE.md`。
- [ ] 前端交互变化：同步 `docs/frontend/05-EXECUTIVE-CHAT.md`。
- [ ] 计划状态变化：在本计划或实施记录中追加完成情况。

---

## 6. 每个任务的标准交付格式

执行 AI 在每个 Task 结束时，应输出或记录：

| 项 | 内容 |
|---|---|
| As-Is | 当前代码真实行为 |
| Gap | 与 To-Be 状态图的差距 |
| Changed Files | 修改过的文件 |
| Key Functions | 修改过的函数 |
| Tests | 运行的测试与结果 |
| Docs | 同步或确认无需同步的文档 |
| Risks | 仍未关闭的风险 |

推荐提交粒度：

- Task 0-3 可作为基础重构 PR。
- Task 4-8 可作为 Router/HITL/ToolRetrieve PR。
- Task 9-16 可作为 FC 循环与工具执行 PR。
- Task 17-18 可作为 Persist/Memory PR。
- Task 19 可作为前端 HITL PR。
- Task 20 是发布前总回归。

---

## 7. 不建议的执行方式

- 不要只根据 `2026-04-27-executive-chat-langgraph-implementation-task-list.md` 的完成度打勾判断是否已实现；必须以代码和测试为准。
- 不要在 `nodes.js` 里继续堆大量临时字符串占位，例如 `CHAT_MESSAGE`、`DENY_MESSAGE`、`SYSTEM_ERROR`。
- 不要让 `PersistAndEmit` 和 `chatService` 同时写 assistant 消息，避免双写。
- 不要在前端只显示普通错误来代替 clarify 卡片，否则 HITL 状态机会失去产品价值。
- 不要把 Router 的安全判断当作唯一权限校验，工具执行层必须再次硬校验。
- 不要把长期记忆萃取放回主请求线程。

---

## 8. 最终 Definition of Done

- [ ] To-Be 图中的每个状态都有明确代码实现、测试和文档说明。
- [ ] 默认 Executive Chat 流式链路稳定走单层 LangGraph。
- [ ] 非流式 / legacy_stream 策略明确：保留则可用，废弃则 API 文档说明。
- [ ] HITL clarify/resume 端到端可用。
- [ ] 工具选择、参数校验、权限、错误语义可观测。
- [ ] `PersistAndEmit` 出口职责清晰，不存在双写或空 `done`。
- [ ] MemoryWorker 进程外异步链路可用，Redis 故障不影响主聊天。
- [ ] `EXECUTIVE-CHAT-TEST-QUERIES.md` 核心 Level 1-3 全通过；Level 4 按当前能力标记通过/待上线。
- [ ] API、DB、前端、Agent 架构文档均与代码一致。

