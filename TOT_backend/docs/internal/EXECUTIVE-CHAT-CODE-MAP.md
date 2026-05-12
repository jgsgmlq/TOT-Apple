# Executive Chat 代码与状态图对照

**最后更新：** 2026-05-11  
**定位：** 面向开发者的 Executive Chat 导读。**最近变更：** P0 Agent 改进（Router response_format、entity 多维扩展、超时保护、seed region 补齐、工具描述增强），详见 `docs/plans/2026-05-11-agent-refactor-plan.md`。，帮助快速建立“文档正本 -> 当前代码入口 -> To-Be 状态图映射”的认知地图。  
**阅读原则：** 当前实现优先以运行中的代码为准；`docs/plans/` 中的 To-Be 图用于理解目标形态与 LangGraph 设计意图。

---

## 1. 建议先读哪些文档

| 文档 | 作用 | 建议口径 |
|---|---|---|
| `README.md` | 角色、入口、账号、Executive Chat 在项目中的定位 | Current |
| `docs/specs/09-EXECUTIVE-CHAT.md` | Executive Chat 能力边界、分层架构、运行模式 | Current |
| `docs/specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | intent / tool 映射正本 | Current |
| `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` | 旧主链路说明（`chatService -> chatAgentRunner`） | Current，但需结合当前路由代码复核 |
| `docs/plans/appendix-a-as-is-vs-to-be.md` | As-Is vs To-Be 状态图 | Reference |
| `docs/frontend/05-EXECUTIVE-CHAT.md` | 前端契约与交互说明 | Reference，部分内容已落后于代码 |

---

## 2. 当前代码入口总览

### 2.1 前端入口

| 作用 | 文件 / 函数 |
|---|---|
| Executive 路由注册 | `TOT_frontend/src/router/index.ts` -> `ExecutiveLoginRoute` / `ExecutiveHomeRoute` |
| Executive 鉴权 | `TOT_frontend/src/router/guards.ts` -> `/executive/login`、`/executive/*` 分支 |
| Chat API 封装 | `TOT_frontend/src/api/chat/index.ts` |
| 主页面 | `TOT_frontend/src/views/executive/index.vue` |
| 流式增量解析 | `TOT_frontend/src/utils/execStreamReply.ts` |
| Markdown / echarts / suggestions 渲染 | `TOT_frontend/src/views/executive/components/MarkdownRenderer.vue` |

### 2.2 后端入口

| 作用 | 文件 / 函数 |
|---|---|
| Chat 路由挂载 | `TOT_backend/server/routes/chat.js` -> `mountChatRoutes('executive', ['executive'])` |
| 会话创建 / 历史 / 删除 / feedback / regenerate / resume | `TOT_backend/server/routes/chat.js` 各 handler |
| 非流式主服务 | `TOT_backend/server/services/chatService.js` -> `sendMessage` |
| 旧流式服务 | `TOT_backend/server/services/chatService.js` -> `sendMessageStream` |
| LangGraph 流式服务 | `TOT_backend/server/services/chatService.js` -> `sendMessageStreamLangGraph` |
| LangGraph resume | `TOT_backend/server/services/chatService.js` -> `resumeMessageStreamLangGraph` |
| LangGraph regenerate | `TOT_backend/server/services/chatService.js` -> `regenerateLastAssistantStreamLangGraph` |
| 旧编排器 | `TOT_backend/server/services/chatAgentRunner.js` |
| 工具注册与权限护栏 | `TOT_backend/server/services/chatToolsService.js` |
| 统一矩阵查询 | `TOT_backend/server/services/executiveMetricsQueryService.js` |
| LangGraph 图定义 | `TOT_backend/server/agent/graph/graph.js` |
| LangGraph 节点实现 | `TOT_backend/server/agent/graph/nodes.js` |
| LangGraph 状态定义 | `TOT_backend/server/agent/graph/state.js` |
| LangGraph 路由策略 | `TOT_backend/server/agent/graph/routingPolicy.js` |

---

## 3. 当前真实请求链路

### 3.1 前端默认链路：`stream: true` -> LangGraph

当前 Executive 页面发送消息默认调用：

- `TOT_frontend/src/api/chat/index.ts` -> `streamExecutiveChatMessage()`
- 请求体：`POST /chat/executive/sessions/:sessionId/messages`
- body：`{ content, stream: true }`

后端在 `TOT_backend/server/routes/chat.js` 中会命中：

- `handlePostMessage()`
- `if (stream === true || stream === 'langgraph')`
- `chatService.sendMessageStreamLangGraph(...)`

这意味着：

1. **当前前端默认流式链路已经不是旧 `chatAgentRunner`，而是 LangGraph。**
2. `docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` 对“当前主链路”的描述，适合解释非流式 / 旧流式路径，但**不足以完整解释当前前端默认行为**。

### 3.2 非流式链路：仍走旧编排器

- 路由：`POST /chat/executive/sessions/:sessionId/messages`
- 当 body **不带** `stream`
- 调用：`chatService.sendMessage(...)`
- 编排：`chatAgentRunner.run(...)`
- 内部再分为：
  - `runFunctionCalling()`
  - `runIntentRouting()`

### 3.3 旧流式回退链路：`stream === 'legacy_stream'`

- 路由：`handlePostMessage()`
- 调用：`chatService.sendMessageStream(...)`
- 仍使用 `chatAgentRunner.run(...)`
- 通过 `streamFormatCallbacks` 推送 `reasoning/content/tool_start/tool_end/clarify`

### 3.4 regenerate / resume

| 功能 | 当前路径 |
|---|---|
| 重新生成（前端默认流式） | `streamRegenerateChatMessage()` -> `/messages/:messageId/regenerate` -> `regenerateLastAssistantStreamLangGraph()` |
| Resume | `/chat/executive/sessions/:sessionId/resume` -> `resumeMessageStreamLangGraph()` |

注意：前端当前**没有**对应的 `/resume` API 封装，也没有处理 `phase: 'clarify'` 的完整 UI 恢复闭环。

---

## 4. To-Be 状态图 -> 当前代码 / 函数对照

以下表格以 `docs/plans/appendix-a-as-is-vs-to-be.md` 的 **To-Be** 状态图为主线，映射仓库里已经存在的代码。

| To-Be 节点 | 当前代码 / 函数 | 当前状态 | 说明 |
|---|---|---|---|
| `Route /chat/*` | `server/routes/chat.js` -> `handlePostMessage` / `handleResume` / `handleRegenerate` | 已接入 | Executive 与 dashboard 共用挂载逻辑 |
| `chatService` | `server/services/chatService.js` | 已接入 | 会话校验、SSE、落库、历史、LangGraph invoke 都在这里 |
| `LoadContext` | `server/agent/graph/nodes.js` -> `loadContext()` | 已实现 | 从 `chatMemoryService.getMemories()` 读取记忆，写入 `memoryContext` |
| `ContextAnalyzerRouter` | `server/agent/graph/nodes.js` -> `contextAnalyzerRouter()` | 已实现 | 单次 LLM 路由（`response_format: json_object`），输出 5 维 entities（metric/region/store/task/rtm）+ intent + tier；含 15s 超时保护 |
| `QuickReply` | `server/agent/graph/graph.js` -> `routeAfterRouter()` + `nodes.js` -> `finalResponseStep()` | 部分实现 | 通过 `intent === 'chat_only'` 进入，但当前仅返回占位字符串 `CHAT_MESSAGE` |
| `DenyReply` | `graph.js` -> `routeAfterRouter()` + `nodes.js` -> `finalResponseStep()` | 部分实现 | 通过 `safety === 'deny'` 进入，但当前仅返回占位字符串 `DENY_MESSAGE` |
| `HumanInTheLoopGate` | `nodes.js` -> `humanInTheLoopGate()` | 已实现（后端） | 使用 `interrupt()` 真挂起，等待 `Command({ resume })` |
| `Checkpointer InterruptPayload` | `chatService.sendMessageStreamLangGraph()` / `resumeMessageStreamLangGraph()` + `buildGraph().compile({ checkpointer })` | 已实现 | 用 `SqliteSaver` 做 checkpoint |
| `ToolRetrieve` | `nodes.js` -> `toolRetrieve()` | 已实现 | Intent Map prior + BM25 混合排序，选出 Top-K 候选工具 |
| `fc_CheckSteps` | `nodes.js` -> `fc_CheckSteps()` + `graph.js` -> `routeAfterFcCheckSteps()` | 已实现 | 按 `routingPolicy.tiers[*].max_super_steps` 控制 FC 步数 |
| `fc_LlmToolCallStep` | `nodes.js` -> `fc_LlmToolCallStep()` | 已实现 | 绑定工具、流式发 token、根据步数决定是否继续允许工具调用 |
| `fc_CheckDuplicate` | `nodes.js` -> `fc_CheckDuplicate()` | 已实现 | 三级去重：同 batch / 同图 / session 缓存 |
| `fc_ValidateParams` | `nodes.js` -> `fc_ValidateParams()` | 部分实现 | 已有 Zod 校验与低置信 HITL，但 schema 只覆盖少数工具 |
| `fc_ParamRepair` | `nodes.js` -> `fc_ParamRepair()` | 已实现 | 把参数错误包装成 `ToolMessage`，回给模型重修 |
| `fc_ExecuteTool` | `nodes.js` -> `fc_ExecuteTool()` -> `chatToolsService.executeByName()` | 已实现 | 真正执行工具，并复用现有工具护栏与错误语义 |
| `fc_MergeToolResults` | `nodes.js` -> `fc_MergeToolResults()` | 已实现 | 把工具结果写回 `ToolMessage`，递回下一轮 FC |
| `PersistAndEmit` | `nodes.js` -> `persistAndEmit()` | 部分实现 | 当前主要负责发异步记忆事件；**聊天消息真正落库仍在 `chatService` 外层完成** |
| `__end__` | `graph.js` -> `workflow.addEdge('PersistAndEmit', END)` | 已实现 | 图在此结束 |
| `MemoryIngestRequested` | `nodes.js` -> `persistAndEmit()` -> `memoryQueueProducer.publishMemoryIngestion()` | 已实现 | 发布异步记忆摄入事件 |
| `MemoryWorker` | `server/agent/queue/bullMqWorker.js` -> `startMemoryWorker()` | 已实现 | BullMQ Worker 消费事件并写入 `user_memories` |

---

## 5. 当前 Graph State 与 To-Be 状态字段对应

To-Be 图里强调的是**单层拍平状态**，这点在当前代码里已经落地到：

- `TOT_backend/server/agent/graph/state.js` -> `ExecChatGraphState`

当前已存在的关键字段：

| To-Be 概念 | 当前字段 |
|---|---|
| 会话与输入 | `sessionId` / `userId` / `userMessage` |
| 记忆上下文 | `memoryContext` |
| 全量消息历史 | `messages` |
| 工具结果 | `toolResults` |
| 权限范围 | `regionScope` |
| 工具命名空间 | `tool_namespace` |
| 路由结果 | `intent` / `safety` / `entities` / `selected_tier` |
| FC 计数器 | `fc_super_step_count` / `fc_current_step` / `fc_repair_attempts` |
| 最终输出 | `finalResponse` |
| HITL | `hitl_status` / `hitl_payload` |

和 To-Be 文档相比，当前状态字段还比较轻量，尚未完全覆盖：

- `calledTools`
- `reply_markdown`
- `reply_structured`
- `meta_trace_id`
- `meta_fallback_count`

这些更多还是散落在 `chatService`、Langfuse trace、SSE 包装层里。

---

## 6. 问题类型 -> 工具 -> 代码文件

| 问题类型 | 工具名 | 入口文件 |
|---|---|---|
| 完成率 / 进度概览 | `getOverviewData` | `server/chat_tools/tool_getProgressMetrics.js` |
| 当前任务列表 / 状态 | `getTaskListData` | `server/chat_tools/tool_getProjectStatus.js` |
| 预警门店 / 风险 | `getWarningsData` | `server/chat_tools/tool_getWarnings.js` |
| 区域下钻 | `getRegionDetailData` | `server/chat_tools/tool_getRegionDetailData.js` |
| 门店下钻 / 员工明细 / 模糊店名消歧 | `getStoreDetailData` | `server/chat_tools/tool_getDrillDownMetrics.js` |
| 多维矩阵查询 / 对比 / 排行 | `queryExecutiveMetrics` | `server/chat_tools/tool_queryExecutiveMetrics.js` + `server/services/executiveMetricsQueryService.js` |
| 统计分析（分位数 / 分布 / 相关性 / 预测） | `runAnalytics` | `server/chat_tools/tool_runAnalytics.js` + `server/services/chatAnalyticsService.js` |

在旧编排器里：

- `chatAgentRunner.runIntentRouting()` 负责 `intentType -> toolName`
- `chatAgentRunner.runFunctionCalling()` 负责让模型自主选择工具

在 LangGraph 里：

- `fc_LlmToolCallStep()` 负责生成 `tool_calls`
- `fc_ExecuteTool()` 负责调用 `chatToolsService.executeByName()`

---

## 7. 前端当前实际支持到哪一层

### 已支持

- Executive 登录与角色守卫
- 会话创建 / 历史加载 / 删除 / feedback / regenerate
- 默认流式发送 `stream: true`
- `reasoning` / `content` 两段式展示
- `echarts` 代码块渲染
- `suggestions` 代码块渲染
- 停止生成（前端 `AbortController`）

### 尚未完整接上

- `phase: 'clarify'` 的专用 UI
- `/chat/executive/sessions/:id/resume` 的 API 封装
- `InterruptPayload` -> 前端候选卡片 -> resume 提交的完整 HITL 闭环

因此，目前后端 LangGraph 的 HITL 能力**存在后端实现**，但**Executive 前端页面尚未真正消费**。

---

## 8. 当前最重要的实现差异 / 风险点

### 8.1 文档与运行时不完全一致

`docs/specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` 仍把当前链路重点放在：

- `chatService -> chatAgentRunner -> chatToolsService`

但当前实际前端默认流式请求已经走：

- `chatService.sendMessageStreamLangGraph()`
- `buildGraph().compile(...).invoke(...)`

所以阅读时要区分：

1. **旧主链路解释文档**
2. **当前前端默认链路**

### 8.2 LangGraph 已接入，但仍是“半收口”

虽然 `graph.js` 和 `nodes.js` 已覆盖 To-Be 图上的大部分节点名，还有以下待收口项：

- `QuickReply` / `DenyReply` 目前还是占位回复
- `PersistAndEmit` 负责记忆发布 + Langfuse trace 更新，但 `chat_messages` 实际落库仍由 `chatService` 外层完成

### 8.3 前端默认走 LangGraph，但没接住 `clarify/resume`

后端已经支持：

- `phase: 'clarify'`
- `interrupt()`
- `/resume`

但前端目前只有：

- `reasoning`
- `content`
- `tool_start`
- `tool_end`

的显示逻辑，没有真正的 resume 恢复入口。

### 8.4 非流式路径存在实现不一致

`TOT_backend/server/services/chatService.js` 中的 `sendMessage()` 当前函数签名为：

- `sendMessage(sessionId, userMessage, userId, reqBody = {})`

但函数内部仍读取 `req?.user?.roles`。这说明：

1. 非流式路径与当前签名之间存在不一致；
2. 由于前端默认使用流式，这个问题短期不一定暴露；
3. 如果后续要恢复依赖非流式接口，需要优先复核这段实现。

---

## 9. Eval 评估体系

已有 Agent 评估工具，位于 `server/agent/eval/`：

| 文件 | 用途 |
|---|---|
| `evalCases.json` | 30 条 Router/ToolRetrieve 单元测试用例 + 10 条端到端用例设计 |
| `runEval.js` | Eval 执行脚本，支持 `--baseline`（录基线）/ `--compare`（对比基线）模式 |
| `baseline.json` | 当前代码的基线数据（2026-05-11 首次录制：intent 准确率 97%） |
| `reports/` | 每次 `--compare` 产出的差异报告 |

运行方式：
```bash
cd TOT_backend
export $(grep -v '^#' .env | xargs)
node server/agent/eval/runEval.js --baseline   # 录基线
node server/agent/eval/runEval.js --compare    # 对比基线
```

---

## 10. 如果要继续往 To-Be 收口，建议先看哪里

建议顺序：

1. `server/routes/chat.js`
2. `server/services/chatService.js`
3. `server/agent/graph/graph.js`
4. `server/agent/graph/state.js`
5. `server/agent/graph/nodes.js`
6. `server/services/chatToolsService.js`
7. `server/chat_tools/*.js`
8. `TOT_frontend/src/api/chat/index.ts`
9. `TOT_frontend/src/views/executive/index.vue`
10. `TOT_frontend/src/utils/execStreamReply.ts`

如果目标是继续把 To-Be 图落满，优先补：

1. 前端 `clarify/resume` 闭环
2. `ToolRetrieve`
3. `fc_CheckDuplicate`
4. `PersistAndEmit` 与外层 `chatService` 的职责再收口

---

## 11. 执行链路事实表 (Execution Link Fact Table)

用于快速定位不同请求模式下的代码执行深度与编排引擎。

| 模式 / 路径 | 触发条件 (Request Body/URL) | 后端 Service 入口 | 编排引擎 | SSE Phases |
|---|---|---|---|---|
| **LangGraph 流式 (默认)** | `stream: true` 或 `stream: 'langgraph'` | `sendMessageStreamLangGraph` | LangGraph (graph.js) | `reasoning`, `content`, `tool_start`, `tool_end`, `clarify` |
| **Legacy 流式** | `stream: 'legacy_stream'` | `sendMessageStream` | AgentRunner (run) | `reasoning`, `content`, `tool_start`, `tool_end`, `clarify` |
| **非流式 (Sync)** | 不带 `stream` 字段 | `sendMessage` | AgentRunner (run) | N/A (JSON Response) |
| **Resume (HITL)** | `POST /sessions/:id/resume` | `resumeMessageStreamLangGraph` | LangGraph (Command resume) | `reasoning`, `content`, `tool_start`, `tool_end` |
| **Regenerate (LG)** | `POST /messages/:id/regenerate` + 历史 LG | `regenerateLastAssistantStreamLangGraph` | LangGraph (Invoke) | 同 LangGraph 流式 |
| **Regenerate (Legacy)** | `POST /messages/:id/regenerate` + 历史 Legacy | `sendMessageStream` (fallback) | AgentRunner | 同 Legacy 流式 |

---

## 12. Langfuse 观测字段对照（工具调用链）

用于快速回答三个问题：

1. 本轮是否真的执行了工具？
2. LLM 决策要调的工具，和实际执行工具是否一致？
3. 失败发生在哪个工具、带了哪些参数字段？

### 10.1 Root Trace（`Executive_Chat_Request`）

| 字段 | 来源 | 含义 |
|---|---|---|
| `metadata.intent` | `finalState.intent` | 本轮最终意图 |
| `metadata.selected_tier` | `finalState.selected_tier` | 路由层级（L2/L3/L4） |
| `metadata.fc_steps_used` | `finalState.fc_super_step_count` | FC 超步数计数 |
| `metadata.repair_attempts` | `finalState.fc_repair_attempts` | 参数修复次数 |
| `metadata.tool_names` | `finalState.calledTools` 去重 | 本轮实际执行过的工具名列表 |
| `metadata.tool_call_count` | `max(calledTools.length, toolResults.length)` | 本轮工具调用规模 |

### 10.2 LLM 决策 Span（`LLM_Decide_Tools`）

| 字段 | 含义 |
|---|---|
| `input.candidateTools` | `ToolRetrieve` 提供给 LLM 的候选工具 |
| `input.selectedTier` | 当前路由 tier |
| `output.toolCallNames` | LLM 实际产出的工具调用名称 |
| `output.toolCallCount` | LLM 本轮决策调用数 |
| `metadata.step` / `metadata.maxSteps` | 当前 FC 步数与上限 |

### 10.3 工具执行 Span（`Tool_Call:<toolName>`）

| 字段 | 含义 |
|---|---|
| `input.toolCallId` | tool call 唯一 ID（用于跨节点关联） |
| `input.toolName` | 执行的内部工具名 |
| `input.argsHash` | 参数哈希（避免明文参数泄漏） |
| `input.argFields` | 参数字段名列表（不上报值） |
| `metadata.namespace` | 工具命名空间（默认 `executive_chat`） |
| `metadata.selectedTier` | 调用时 tier |
| `metadata.status` | `success` / `error` |
| `metadata.errorCode` | 失败时错误码 |
| `output` | 执行结果预览（脱敏 + 截断） |

### 10.4 快速排障操作建议

- 先看 root trace：`tool_names` 和 `tool_call_count`，确认是否发生工具调用。
- 再看 `LLM_Decide_Tools`：确认模型当时想调用哪些工具。
- 最后看 `Tool_Call:*`：确认每个工具的执行状态、错误码、参数字段集合。

