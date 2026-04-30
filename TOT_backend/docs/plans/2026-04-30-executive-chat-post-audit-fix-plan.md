# Executive Chat Post-Audit 修复计划

**状态：** Draft  
**创建日期：** 2026-04-30  
**适用范围：** Executive Chat LangGraph 主链路、工具候选、HITL/Resume、FC 工具循环、SSE/落库、前端 clarify UI  
**前置计划：** [`2026-04-30-executive-chat-to-be-state-audit-fix-plan.md`](./2026-04-30-executive-chat-to-be-state-audit-fix-plan.md)  
**本计划目标：** 针对执行前置计划后的复查问题，给后续 AI 一份可逐项修改的任务清单。每个任务都明确涉及文件、函数、修改目标、验收方式。

---

## 1. 当前结论

Executive Chat 现在已经完成了 To-Be 的大部分骨架：单层 `StateGraph`、拍平的 `ExecChatGraphState`、LangGraph 流式入口、后端 `/resume` 入口、`PersistAndEmit` assistant 落库等都已经存在。

但当前还不是稳定可交付状态。主要阻塞在以下几类：

| 优先级 | 问题 | 影响 |
|---|---|---|
| P0 | `ToolRetrieve` 和 `getLlmWithTools` 使用了不存在或旧名字的工具 | 任务、预警、门店下钻等问题可能无法调用正确工具 |
| P0 | 前端没有 `clarify/resume` 闭环 | 后端 HITL interrupt 不能被用户界面完成恢复 |
| P1 | FC 循环只完整处理第一个 `tool_call` | 多工具调用会丢结果或合并出 `"No data returned"` |
| P1 | duplicate cache 命中后的路由/merge 语义不正确 | 重复调用跳过后可能没有把缓存结果正确喂回 LLM |
| P1 | HITL payload 是占位实现，`intent_shift` 没有重新路由 | 澄清结果不可用，意图变化不安全 |
| P1 | `PersistAndEmit` 吞掉落库失败 | 前端可能显示成功，但历史里没有 assistant 消息 |
| P2 | 最终兜底回复会输出 JSON code block | 不符合 Executive Chat 面向用户的展示口径 |
| P2 | 参数校验较浅，namespace/类型/枚举/业务规则没有统一收口 | LLM 工具参数错误时修复与错误提示不稳定 |

---

## 2. 必读参考文档

### 2.1 To-Be 与当前代码导读

| 文档 | 用途 |
|---|---|
| [`appendix-a-as-is-vs-to-be.md`](./appendix-a-as-is-vs-to-be.md) | To-Be 状态图、单图拍平、HITL resume 规则、FC 循环目标态 |
| [`2026-04-30-executive-chat-to-be-state-audit-fix-plan.md`](./2026-04-30-executive-chat-to-be-state-audit-fix-plan.md) | 第一轮逐状态修复计划 |
| [`../internal/EXECUTIVE-CHAT-CODE-MAP.md`](../internal/EXECUTIVE-CHAT-CODE-MAP.md) | Executive Chat 文档与代码入口地图 |
| [`2026-04-27-executive-chat-langgraph-implementation-task-list.md`](./2026-04-27-executive-chat-langgraph-implementation-task-list.md) | LangGraph 迁移历史任务，不可盲信完成度，需以代码复核 |

### 2.2 API、SSE、前端契约

| 文档 | 用途 |
|---|---|
| [`../specs/04-API-SPEC.md`](../specs/04-API-SPEC.md) | Executive Chat HTTP API、SSE event、`/resume` 契约 |
| [`../specs/09-EXECUTIVE-CHAT.md`](../specs/09-EXECUTIVE-CHAT.md) | 产品能力边界、流式语义、用户可见输出要求 |
| [`../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`](../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md) | intent 列表、工具列表、intent/tool 映射 |
| [`../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md`](../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md) | 请求主链路说明，执行时需要与代码事实核对 |
| [`../frontend/05-EXECUTIVE-CHAT.md`](../frontend/05-EXECUTIVE-CHAT.md) | 前端 Executive Chat 对接说明 |

### 2.3 数据库、权限、测试

| 文档 | 用途 |
|---|---|
| [`../specs/01-DATA-MODEL.md`](../specs/01-DATA-MODEL.md) | `chat_sessions`、`chat_messages`、feedback、memory 数据模型 |
| [`../backend/03-DATABASE.md`](../backend/03-DATABASE.md) | SQLite 实现、迁移、chat 相关表 |
| [`../specs/08-PERMISSION-MODEL.md`](../specs/08-PERMISSION-MODEL.md) | executive role、scope、权限边界 |
| [`../specs/07-RTM-FILTER.md`](../specs/07-RTM-FILTER.md) | RTM 与区域过滤口径 |
| [`../tests/EXECUTIVE-CHAT-TEST-QUERIES.md`](../tests/EXECUTIVE-CHAT-TEST-QUERIES.md) | 业务问题回归清单 |
| [`../tests/EXECUTIVE-CHAT-TESTING.md`](../tests/EXECUTIVE-CHAT-TESTING.md) | 本地调试、LangGraph、Langfuse 观测 |

---

## 3. 执行总原则

1. **先修 P0，再修 P1/P2。** 当前最大阻塞是工具名不匹配和 HITL 前端未闭环。
2. **不要引入 LangGraph Subgraph。** 继续保持单层 `StateGraph`，状态字段放在 `ExecChatGraphState` 第一层。
3. **工具名以 `server/chat_tools/*.js` 的 `schema.function.name` 为准。** 文件名不等于工具名。
4. **Router 输出不能替代工具层硬校验。** `regionScope`、role、schema、scopePolicy 必须在工具执行前确定性校验。
5. **每个 task 只修一个小问题。** 修改后立刻跑相关最小验证，避免把多个状态的 bug 混在一起。
6. **不要双发 SSE `done`。** 如果调整 `PersistAndEmit` 和 `chatService` 的分工，必须明确唯一发送者。
7. **文档随代码同步。** API、SSE phase、resume payload、工具名、intent 映射变化必须同步 `04/10/11`。

---

## 4. 当前真实工具名清单

执行 AI 修改工具路由前，必须先以代码复核一次。当前复查到的真实工具名如下：

| 文件 | `schema.function.name` |
|---|---|
| `server/chat_tools/tool_queryExecutiveMetrics.js` | `queryExecutiveMetrics` |
| `server/chat_tools/tool_runAnalytics.js` | `runAnalytics` |
| `server/chat_tools/tool_getWarnings.js` | `getWarningsData` |
| `server/chat_tools/tool_getRegionDetailData.js` | `getRegionDetailData` |
| `server/chat_tools/tool_getDrillDownMetrics.js` | `getStoreDetailData` |
| `server/chat_tools/tool_getProjectStatus.js` | `getTaskListData` |
| `server/chat_tools/tool_getProgressMetrics.js` | `getOverviewData` |
| `server/chat_tools/tool_fetchRawDataset.js` | `fetchRawDataset` |
| `server/chat_tools/tool_executeCode.js` | `executeCode` |

当前危险点：`nodes.js` 里仍出现了 `getProjectStatus`、`getWarnings`、`getProgressMetrics`、`getDrillDownMetrics` 这类旧名或文件名式命名。后续任务必须消除这类不真实工具名。

---

## 5. 修复阶段总览

| 阶段 | 目标 | 优先级 |
|---:|---|---|
| Phase 0 | 建立复查基线与静态保护 | P0 |
| Phase 1 | 修复工具注册、工具候选、intent/tool 映射 | P0 |
| Phase 2 | 打通后端 HITL interrupt/resume 与前端 clarify UI | P0 |
| Phase 3 | 修复 FC 循环的多工具、duplicate、repair、merge 语义 | P1 |
| Phase 4 | 收口 SSE、落库、错误传播、最终回复格式 | P1 |
| Phase 5 | 加强参数校验、scope/role 护栏、namespace 规范 | P1 |
| Phase 6 | 补测试、观测、文档同步 | P1/P2 |

---

## 6. Phase 0：建立复查基线与静态保护

### Task 0.1 生成当前链路事实表

**目标：** 修改前先确认当前请求实际走哪条链路，避免后续 AI 根据旧文档误修。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/routes/chat.js`、`server/services/chatService.js`、`server/agent/graph/graph.js`、`TOT_frontend/src/api/chat/index.ts` |
| 涉及函数 | `handlePostMessage`、`sendMessage`、`sendMessageStream`、`sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph`、`buildGraph`、`streamExecutiveChatMessage` |

**执行步骤：**

- [ ] 记录 `stream: true`、`stream: "langgraph"`、`stream: "legacy_stream"`、不传 `stream` 四种请求分别走哪条函数。
- [ ] 记录 `resume` 当前是否只支持 LangGraph。
- [ ] 记录 regenerate 当前是否有 LangGraph 与 legacy 两套路径。
- [ ] 将结论写到本计划的执行记录，或更新 `../internal/EXECUTIVE-CHAT-CODE-MAP.md`。

**验收：**

- [ ] 后续任务可以明确知道默认流式路径是 `sendMessageStreamLangGraph`。
- [ ] 没有把 legacy `chatAgentRunner` 当作当前默认主链路来修。

### Task 0.2 增加工具名静态检查

**目标：** 防止以后再次把文件名、旧工具名、真实工具名混用。

| 项 | 内容 |
|---|---|
| 涉及文件 | 新增建议：`server/agent/graph/__tests__/toolRegistryNames.test.js` 或现有测试目录；可选新增 `server/scripts/check-executive-tool-names.js` |
| 涉及函数 | `chatToolsService.loadTools`、`chatToolsService.getToolMeta`、后续新增的 `getRegisteredToolNames` |

**执行步骤：**

- [ ] 从 `chatToolsService` 暴露真实注册工具名列表。
- [ ] 写一个静态测试，断言 `ToolRetrieve` 候选工具全都存在于真实 registry。
- [ ] 写一个静态测试，断言 fallback 工具全都存在于真实 registry。
- [ ] 写一个静态测试，断言旧名 `getProjectStatus`、`getWarnings`、`getProgressMetrics`、`getDrillDownMetrics` 不再出现在 LangGraph 候选工具配置里。

**验收：**

- [ ] 测试失败时能直接指出哪个候选工具名不存在。
- [ ] 不需要真实 LLM、真实数据库即可运行。

### Task 0.3 建立最小 smoke 验证命令

**目标：** 每个小任务完成后都能快速确认没有语法级破坏。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/*.js`、`server/services/chatService.js`、`server/services/chatToolsService.js`、`server/routes/chat.js`、`TOT_frontend/src/api/chat/index.ts`、`TOT_frontend/src/utils/execStreamReply.ts` |

**执行步骤：**

- [ ] 后端每次修改后至少跑 `node --check` 覆盖改动文件。
- [ ] 前端每次修改后至少跑项目现有 TypeScript 检查或构建命令。
- [ ] 如果项目没有专门单测，新增最小可运行脚本，避免所有验证都依赖手动聊天。

**验收：**

- [ ] 每个后续 task 的提交说明里包含验证命令和结果。

---

## 7. Phase 1：修复工具注册、工具候选、intent/tool 映射

### Task 1.1 给 `chatToolsService` 增加 registry 访问器

**目标：** 让 LangGraph 不再自己猜工具名，而是从唯一 registry 读取真实工具。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/services/chatToolsService.js` |
| 涉及函数 | `loadTools`、`getToolMeta`、`executeByName`、`module.exports` |

**修改要求：**

- [ ] 新增 `getRegisteredToolNames()`，返回真实 `schema.function.name` 数组。
- [ ] 新增 `getToolSchema(toolName)`，返回单个工具的 OpenAI tool schema。
- [ ] 新增 `getToolSchemasByNames(names)`，按候选名过滤，过滤前必须 normalize namespace。
- [ ] 保持 `executeByName(toolName, params, regionScope)` 向后兼容。
- [ ] `getToolMeta(toolName)` 必须支持传入 `executive_chat.queryExecutiveMetrics` 这种 namespace 前缀名。

**验收：**

- [ ] `getRegisteredToolNames()` 包含 `getTaskListData`，不包含 `getProjectStatus`。
- [ ] `getToolSchemasByNames(["executive_chat.getWarningsData"])` 能返回 `getWarningsData` schema。
- [ ] 老的 `executeByName("queryExecutiveMetrics", ...)` 不受影响。

### Task 1.2 修复 `getLlmWithTools` 的 fallback 工具

**目标：** LLM bind tools 时不能绑定不存在的工具。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js` |
| 涉及函数 | `getLlmWithTools` |

**修改要求：**

- [ ] 使用 `chatToolsService.getToolSchemasByNames(candidateTools)` 替代本地扫描或手工过滤。
- [ ] fallback 工具改成真实存在且安全的工具，建议：`queryExecutiveMetrics`、`getOverviewData`、`getTaskListData`。
- [ ] 如果候选工具全部无效，记录 warning，并使用安全 fallback。
- [ ] 如果 registry 为空，返回不绑定工具的 LLM，并让后续进入 `finalResponseStep` 或错误降级，不要抛未捕获异常。

**验收：**

- [ ] 任意候选名带 namespace 或不带 namespace 都能找到同一个工具。
- [ ] 不再出现 `getProjectStatus` 作为 fallback。

### Task 1.3 修复 `toolRetrieve` 的 intent/tool 映射

**目标：** `ToolRetrieve` 返回真实工具名，且与 `10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` 对齐。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` |
| 涉及函数 | `toolRetrieve` |

**建议映射：**

| intent | candidateTools |
|---|---|
| `matrix_query` / `query_metrics` | `queryExecutiveMetrics`、`getOverviewData`、`getRegionDetailData` |
| `progress_query` | `getOverviewData`、`queryExecutiveMetrics` |
| `project_status` / `task_status` | `getTaskListData`、`getOverviewData`、`queryExecutiveMetrics` |
| `warning_query` / `store_warning` | `getWarningsData`、`queryExecutiveMetrics`、`getStoreDetailData` |
| `drill_down` | `getRegionDetailData`、`getStoreDetailData`、`queryExecutiveMetrics` |
| `analytics_query` / `analytics` | `runAnalytics`、`queryExecutiveMetrics`、`fetchRawDataset`、`executeCode` |

**修改要求：**

- [ ] 消除 `getDrillDownMetrics`、`getProjectStatus`、`getProgressMetrics`、`getWarnings` 旧名。
- [ ] 根据 `RoutingPolicy.tiers[state.selected_tier].tool_top_k` 截断候选。
- [ ] 所有候选都经过 registry 存在性过滤。
- [ ] 如果过滤后为空，使用安全 fallback。

**验收：**

- [ ] “任务状态怎么样” 至少候选到 `getTaskListData`。
- [ ] “哪些门店有预警” 至少候选到 `getWarningsData`。
- [ ] “某区域/门店详情” 至少候选到 `getRegionDetailData` 或 `getStoreDetailData`。

### Task 1.4 统一 Router intent 命名与别名映射

**目标：** `ContextAnalyzerRouter` 不要随机输出一套与规格文档不一致的 intent。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` |
| 涉及函数 | `contextAnalyzerRouter`、`toolRetrieve` |

**修改要求：**

- [ ] 在 Router prompt 的 schema 中使用规格文档里的 canonical intent。
- [ ] 保留 alias normalize 层，兼容当前可能出现的 `query_metrics`、`task_status`、`store_warning`、`analytics`。
- [ ] 新增 helper，建议命名 `normalizeIntent(intent)`。
- [ ] `toolRetrieve` 只消费 normalize 后的 canonical intent。

**验收：**

- [ ] Router 输出旧 alias 时，仍能进入正确工具映射。
- [ ] 文档 `10` 与代码 canonical intent 列表一致。

### Task 1.5 为工具候选加入 namespace 规范

**目标：** 内部真实工具名与对 LLM 暴露的 namespace 名称不要混乱。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatToolsService.js` |
| 涉及函数 | `getLlmWithTools`、`toolRetrieve`、`fc_ValidateParams`、`fc_ExecuteTool` |

**修改要求：**

- [ ] 明确候选列表里存内部名还是 namespace 名。建议 state 内统一存内部名，例如 `queryExecutiveMetrics`。
- [ ] 如果 bind tools 给 LLM 时需要 namespace，在一个 helper 中集中转换，不要散落在多个节点里。
- [ ] `fc_ValidateParams` 和 `fc_ExecuteTool` 都通过同一个 `normalizeToolName(toolName, namespace)` 还原内部名。

**验收：**

- [ ] `executive_chat.queryExecutiveMetrics` 和 `queryExecutiveMetrics` 两种输入都能校验和执行。
- [ ] `state.calledTools` 中记录的工具名格式一致。

---

## 8. Phase 2：打通 HITL interrupt/resume 与前端 clarify UI

### Task 2.1 明确定义 `InterruptPayload` 与 `ResumePayload`

**目标：** 后端、前端、API 文档使用同一份字段语义。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/state.js`、`server/agent/graph/nodes.js`、`TOT_frontend/src/api/chat/index.ts`、可选 `TOT_frontend/src/types/chat.ts`、`../specs/04-API-SPEC.md` |
| 涉及函数 | `ExecChatGraphState`、`humanInTheLoopGate`、`streamExecutiveChatMessage` |

**建议契约：**

```ts
type InterruptPayload = {
  type: "select" | "input" | "confirm";
  prompt: string;
  options?: Array<{ id: string; label: string; meta?: Record<string, unknown> }>;
  agent_id: "executive_chat";
  reason: "low_confidence_entity" | "missing_required_param" | "ambiguous_intent" | "confirm_high_risk";
  resume_token?: string;
  context?: Record<string, unknown>;
};

type ResumePayload = {
  resume_type: "slot_fill" | "intent_shift" | "cancel";
  value?: unknown;
  selected_option_id?: string;
  user_text?: string;
};
```

**验收：**

- [ ] API 文档、后端 payload、前端类型字段一致。
- [ ] `resume_type` 的三种路径都有明确后端行为。

### Task 2.2 修复 `humanInTheLoopGate` 的真实 payload

**目标：** 不再返回 `O1/O2` 这种占位选项，而是基于缺失字段或低置信实体生成可用澄清。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js` |
| 涉及函数 | `fc_ValidateParams`、`humanInTheLoopGate` |

**修改要求：**

- [ ] 低置信实体场景：payload 的 `options` 应来自真实候选或明确要求用户输入，不得使用假选项。
- [ ] 缺失必填参数场景：payload 的 `prompt` 应指出缺少什么，例如区域、任务、门店、时间范围。
- [ ] 高风险确认场景：payload 使用 `confirm` 类型，并带上将要执行的动作摘要。
- [ ] payload 写入 `interrupt_payload` 与 `hitl_payload` 时保持兼容，但最终只保留一个 canonical 字段。

**验收：**

- [ ] 用户看到的澄清问题可直接回答。
- [ ] payload 里能追踪是哪个 tool call、哪个字段触发澄清。

### Task 2.3 修复 resume 后的图路由

**目标：** `slot_fill` 继续工具链，`intent_shift` 必须回到 `ContextAnalyzerRouter`，`cancel` 进入安全结束。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/graph.js`、`server/agent/graph/nodes.js`、`server/agent/graph/state.js` |
| 涉及函数 | `buildGraph`、`routeAfterRouter`、新增建议 `routeAfterHumanInTheLoop`、`humanInTheLoopGate` |

**修改要求：**

- [ ] `humanInTheLoopGate` resume 后写入 `hitl_status: "resumed"`。
- [ ] `resume_type: "slot_fill"` 时，把用户补充值合并进 `entities` 或当前 tool args，然后路由到 `fc_CheckSteps` 或 `fc_ValidateParams`。
- [ ] `resume_type: "intent_shift"` 时，把新的 `userMessage` 或补充文本写回 state，并路由到 `ContextAnalyzerRouter`。
- [ ] `resume_type: "cancel"` 时写入 `reply_markdown`，路由到 `PersistAndEmit`。
- [ ] 不要仅仅给 LLM 塞一个 ToolMessage 后继续旧路径。

**验收：**

- [ ] 意图变化不会继续执行旧工具。
- [ ] slot 补齐不会重新创建 user message。
- [ ] cancel 会安全落库并结束。

### Task 2.4 `chatService` 正确处理 LangGraph interrupt

**目标：** Graph interrupt 时，HTTP/SSE 层能把 clarify payload 发给前端，而不是当作异常或静默结束。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/services/chatService.js`、`server/utils/sseResponse.js` |
| 涉及函数 | `sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph`、`createSseSender` |

**修改要求：**

- [ ] 调研当前 LangGraph JS interrupt 返回形态，确认 `app.invoke` 是返回 `__interrupt__`、抛异常，还是 checkpoint 挂起。
- [ ] 捕获 interrupt 后发送 SSE `event: delta`，payload 建议 `{ phase: "clarify", interruptPayload }`。
- [ ] 明确 interrupt 时是否发送 `done`。建议发送一个结构化状态，例如 `{ status: "interrupted", sessionId, interruptPayload }`，但不得被前端误当作 assistant 完成回答。
- [ ] 确保连接关闭后 checkpoint 可以被 `/resume` 接上。

**验收：**

- [ ] 后端触发 HITL 时，前端能收到 `phase: "clarify"`。
- [ ] `/resume` 能从同一个 `thread_id` 恢复。
- [ ] interrupt 不会写入假的 assistant 最终回答。

### Task 2.5 前端新增 resume API

**目标：** 前端可以调用后端 `/resume`。

| 项 | 内容 |
|---|---|
| 涉及文件 | `TOT_frontend/src/api/chat/index.ts` |
| 涉及函数 | 新增建议 `streamResumeExecutiveChatMessage` 或 `resumeExecutiveChatMessage` |

**修改要求：**

- [ ] 新增 `POST /chat/executive/sessions/{sessionId}/resume` 的 API 包装。
- [ ] 支持 SSE，与 `streamExecutiveChatMessage` 使用同一套 `streamSsePostJson`。
- [ ] 请求体包含 `{ resumePayload, stream: true }`。
- [ ] 类型中区分普通 `SendMessageResult` 与 interrupted/resumed 状态。

**验收：**

- [ ] `index.vue` 不直接拼 URL。
- [ ] 普通发送、regenerate、resume 三类 SSE 包装风格一致。

### Task 2.6 前端流式解析支持 `phase: "clarify"`

**目标：** clarify 不应被拼进普通正文。

| 项 | 内容 |
|---|---|
| 涉及文件 | `TOT_frontend/src/utils/execStreamReply.ts` |
| 涉及函数 | `normalizeStreamDelta`、`feedExecStreamDelta`、`runExecStyleSseChat`、新增建议 `runExecResumeSseChat` |

**修改要求：**

- [ ] `normalizeStreamDelta` 识别 `interruptPayload`。
- [ ] `feedExecStreamDelta` 遇到 `phase: "clarify"` 时不要写入 `contentBuf` 或 `reasoningBuf`。
- [ ] 新增 callback，例如 `onClarify(payload)`。
- [ ] 保持 `reasoning/content` 现有行为不变。

**验收：**

- [ ] 澄清卡片不会显示成 Markdown 正文。
- [ ] 普通 token 流不受影响。

### Task 2.7 前端页面实现 pending clarification 状态

**目标：** 用户可以在 Executive Chat 页面完成澄清选择或输入。

| 项 | 内容 |
|---|---|
| 涉及文件 | `TOT_frontend/src/views/executive/index.vue` |
| 涉及函数 | `handleSend`、`runStreamSend`、`handleStop`、`historyItemsToMessages`、新增建议 `handleClarifySubmit`、`handleClarifyCancel` |

**修改要求：**

- [ ] 增加 `pendingClarification` 状态，保存 `InterruptPayload`。
- [ ] clarify 到达时，把当前 loading assistant message 更新成“需要你确认/补充”的 UI。
- [ ] select 类型渲染选项按钮，input 类型渲染输入框，confirm 类型渲染确认/取消。
- [ ] 用户提交后调用 `streamResumeExecutiveChatMessage`。
- [ ] resume 流式返回时，继续更新同一条 assistant message，不新建 user message，除非产品明确要展示用户补充文本。
- [ ] stop/cancel 时清理 `pendingClarification` 和 `abortController`。

**验收：**

- [ ] 用户选择澄清选项后，assistant 能继续生成最终答案。
- [ ] 切换会话时不会把 A 会话的 pending clarification 带到 B 会话。
- [ ] 刷新页面后，如果 checkpoint 尚未恢复，至少不会出现无法发送新消息的死锁。

---

## 9. Phase 3：修复 FC 循环的多工具、duplicate、repair、merge 语义

### Task 3.1 抽出 tool call helper

**目标：** 消除各节点重复读取 `lastMsg.tool_calls[0]` 的代码。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`，可选新增 `server/agent/graph/toolCallUtils.js` |
| 涉及函数 | `fc_CheckDuplicate`、`fc_ValidateParams`、`fc_ParamRepair`、`fc_ExecuteTool`、`fc_MergeToolResults` |

**建议 helper：**

- [ ] `getLastAiToolCalls(state)`
- [ ] `normalizeToolName(toolName, namespace)`
- [ ] `buildToolSignature(toolCall, regionScope)`
- [ ] `makeToolMessage(toolCall, content, statusMeta)`
- [ ] `safeJsonContent(value)`

**验收：**

- [ ] 上述 FC 节点不再直接散落 `lastMsg.tool_calls[0]`。
- [ ] namespace normalize 逻辑只有一处。

### Task 3.2 修复 `fc_CheckDuplicate` 多工具语义

**目标：** 每个 tool call 都能独立判断是否重复。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatSessionStateService.js` |
| 涉及函数 | `fc_CheckDuplicate`、`chatSessionStateService.buildScopeFingerprint`、`chatSessionStateService.getLatestBySignature` |

**修改要求：**

- [ ] 遍历所有 tool calls，不只处理第一个。
- [ ] 命中缓存时把结果写入 `state.toolResults[toolCall.id]`。
- [ ] 未命中时保留到待执行集合。
- [ ] 如果所有 tool calls 都是 duplicate，直接让 `fc_MergeToolResults` 生成标准 ToolMessage。
- [ ] 如果部分 duplicate，后续 `fc_ExecuteTool` 只执行未命中的 tool calls。

**验收：**

- [ ] duplicate 命中后 LLM 能看到对应 ToolMessage。
- [ ] 不会因为 last message 是 `ToolMessage` 就让 merge 空转。

### Task 3.3 修复 `fc_ValidateParams` 多工具与 namespace

**目标：** 所有待执行工具都经过参数和权限前置校验。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatToolsService.js` |
| 涉及函数 | `fc_ValidateParams`、`chatToolsService.getToolMeta`、`chatToolsService.validateToolArgs` |

**修改要求：**

- [ ] 对每个待执行 tool call 获取 normalized tool name。
- [ ] `getToolMeta` 支持 namespace 后再查 meta。
- [ ] 参数校验结果要带 `tool_call_id` 和 `field`，便于 repair 或 HITL 精准处理。
- [ ] 可修复错误进入 `fc_ParamRepair`。
- [ ] 不可修复或需要用户补充的错误进入 `HumanInTheLoopGate`。

**验收：**

- [ ] 多个 tool calls 中一个失败不会让错误归因到另一个工具。
- [ ] 缺少必填参数时能生成具体字段级提示。

### Task 3.4 修复 `fc_ParamRepair` 的修参闭环

**目标：** 参数修复不是简单返回错误，而是让 LLM 或规则产生新的参数并重新校验。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/agent/graph/routingPolicy.js` |
| 涉及函数 | `fc_ParamRepair`、`fc_ValidateParams`、`routeAfterValidateParams` |

**修改要求：**

- [ ] `fc_ParamRepair` 明确针对哪个 `tool_call_id` 修。
- [ ] 每次修复递增 `fc_repair_attempts`。
- [ ] 达到 `max_repair_attempts` 后，不再循环修参，进入 HITL 或 fallback。
- [ ] 修复后的 tool args 要更新到 state 中，而不是只写一个 ToolMessage 让 LLM 猜。

**验收：**

- [ ] 缺失但可从上下文推断的参数能自动补齐。
- [ ] 不可推断的参数会走澄清，不会无限循环。

### Task 3.5 修复 `fc_ExecuteTool` 多工具执行

**目标：** 所有通过校验的 tool calls 都能执行并产生独立结果。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatToolsService.js` |
| 涉及函数 | `fc_ExecuteTool`、`chatToolsService.executeByName` |

**修改要求：**

- [ ] 遍历待执行 tool calls，建议先顺序执行，避免 DB 与 SSE 顺序复杂化。
- [ ] 每个工具发送独立 `tool_start` 与 `tool_end` SSE。
- [ ] 单个工具失败时写入该 tool call 的错误结果，不要让整轮直接崩溃，除非是权限或系统级错误。
- [ ] 权限错误必须停止危险工具执行，并进入安全 fallback 或 deny。
- [ ] `calledTools` 记录所有实际执行的工具。

**验收：**

- [ ] LLM 一次请求两个工具时，两个工具都有结果。
- [ ] 一个工具失败不会覆盖另一个工具的成功结果。

### Task 3.6 修复 `fc_MergeToolResults`

**目标：** merge 节点只负责把 `toolResults` 转成标准 ToolMessage，并缓存成功结果。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatSessionStateService.js` |
| 涉及函数 | `fc_MergeToolResults`、`chatSessionStateService.upsertState` |

**修改要求：**

- [ ] 对每个 tool call 生成一个 `ToolMessage`，`tool_call_id` 必须对应。
- [ ] duplicate 缓存结果也要生成 ToolMessage。
- [ ] 没有对应结果时，不要静默写 `"No data returned"`；应写结构化错误并增加 fallback 计数。
- [ ] 只缓存成功且可复用的工具结果。
- [ ] `fc_super_step_count` 在完成一轮 merge 后递增一次。

**验收：**

- [ ] ToolMessage 数量与 LLM 发出的 tool_calls 数量一致。
- [ ] 失败结果可被 LLM 读懂并决定修参、降级或最终回答。

### Task 3.7 修复 FC 条件边

**目标：** 循环控制清晰，不靠消息类型偶然判断。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/graph.js`、`server/agent/graph/state.js` |
| 涉及函数 | `routeAfterFcCheckSteps`、`routeAfterFcLlm`、`routeAfterCheckDuplicate`、`routeAfterValidateParams`、`routeAfterMerge` |

**修改要求：**

- [ ] 增加明确状态字段，例如 `fc_next_action`，可选值 `validate`、`execute`、`merge`、`repair`、`hitl`、`finalize`。
- [ ] 条件边优先看状态字段，其次才看 last message 类型。
- [ ] duplicate skip 不应依赖 last message 是 `ToolMessage` 这种副作用。
- [ ] over cap 统一进入 `fc_FinalizeOrFallback` 或当前 `finalResponseStep`。

**验收：**

- [ ] FC 循环每个出口都可解释。
- [ ] duplicate、repair、HITL、over-cap 不互相误路由。

---

## 10. Phase 4：收口 SSE、落库、错误传播、最终回复格式

### Task 4.1 明确 `PersistAndEmit` 与 `chatService` 的职责边界

**目标：** 防止 assistant 重复落库或 SSE `done` 双发。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatService.js` |
| 涉及函数 | `persistAndEmit`、`sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph` |

**推荐短期方案：**

- [ ] `persistAndEmit` 负责 assistant 落库、session `updated_at`、memory event、返回 `finalMessageId`。
- [ ] `chatService` 负责 HTTP/SSE transport，基于 final state 发送唯一 `done`。
- [ ] 文档里说明这是 transport 边界实现，不等同于新增第二个图出口。

**如果选择严格 To-Be 方案：**

- [ ] `persistAndEmit` 发送 SSE `done`。
- [ ] 同一个改动中移除 `chatService` 的 `done` 发送。
- [ ] 增加测试确保 `done` 只发送一次。

**验收：**

- [ ] 每次成功回答只插入一条 assistant message。
- [ ] 每次成功流式回答只收到一个 `done`。

### Task 4.2 `PersistAndEmit` 不再吞掉 DB 失败

**目标：** 落库失败不能伪装成成功回答。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatService.js` |
| 涉及函数 | `persistAndEmit`、`sendMessageStreamLangGraph`、`resumeMessageStreamLangGraph` |

**修改要求：**

- [ ] assistant message 插入失败时抛出明确错误，例如 `CHAT_PERSIST_FAILED`。
- [ ] `chatService` 捕获后发送 SSE `error`，不要发送成功 `done`。
- [ ] session update 失败也要记录错误，按产品要求决定是否 fail request。
- [ ] memory event 失败不应阻塞主回答，但必须记录 warning。

**验收：**

- [ ] 模拟 DB insert 失败时，前端收到 error 而非 success。
- [ ] 正常场景历史记录一定能看到 assistant。

### Task 4.3 修复最终兜底回复，不输出裸 JSON

**目标：** Executive 用户看到的是可读 Markdown，而不是工具 JSON dump。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`，可选新增 `server/agent/graph/renderers.js` |
| 涉及函数 | `finalResponseStep` |

**修改要求：**

- [ ] 新增 `renderToolResultsMarkdown(toolResults, intent)`。
- [ ] 对常见工具结果给出摘要、关键指标、异常、建议行动。
- [ ] JSON 只能作为调试信息，不默认面向用户输出。
- [ ] 如果工具结果不可解析，输出“已获取数据但格式异常”的可读降级信息。

**验收：**

- [ ] 普通用户回答中不出现大段 ```json。
- [ ] 工具失败时回答能解释失败原因和下一步建议。

### Task 4.4 统一 SSE phase 与前端解析

**目标：** 后端 phase 和前端 parser 使用同一套枚举。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/agent/graph/nodes.js`、`server/services/chatService.js`、`TOT_frontend/src/utils/execStreamReply.ts`、`../specs/04-API-SPEC.md` |
| 涉及函数 | `fc_LlmToolCallStep` callbacks、`fc_ExecuteTool`、`sendMessageStreamLangGraph`、`normalizeStreamDelta`、`feedExecStreamDelta` |

**建议 phase：**

| phase | 用途 |
|---|---|
| `reasoning` | 思考/推理 token |
| `content` | 用户可见正文 token |
| `tool_start` | 工具开始 |
| `tool_end` | 工具结束 |
| `clarify` | 需要用户澄清 |
| `error` | 可恢复或不可恢复错误提示 |

**验收：**

- [ ] 前端不会把 `tool_start/tool_end/clarify` 拼进正文。
- [ ] API 文档与代码 phase 枚举一致。

---

## 11. Phase 5：加强参数校验、scope/role 护栏、namespace 规范

### Task 5.1 深化 `validateToolArgs`

**目标：** 当前只做浅层 required/type 校验，需要支持 enum、array、object、nullable、默认值。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/services/chatToolsService.js` |
| 涉及函数 | `validateToolArgs` |

**修改要求：**

- [ ] 支持 JSON schema 的 `required`、`type`、`enum`、`items`、`properties`。
- [ ] 返回结构化 violations，不只返回字符串。
- [ ] 区分 `repairable` 与 `requires_user_input`。
- [ ] 保持 `executeByName` 对旧调用方兼容。

**验收：**

- [ ] array/object 参数错误能被发现。
- [ ] enum 错误能进入 repair 或 HITL。

### Task 5.2 把业务校验从节点里收口

**目标：** region/task/store/date 等业务规则不要散落在 `nodes.js`。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/services/chatToolsService.js`，可选新增 `server/services/chatToolValidationService.js` |
| 涉及函数 | `validateToolArgs`、`authorizeToolCall`、`executeByName`、`fc_ValidateParams` |

**修改要求：**

- [ ] `fc_ValidateParams` 只编排校验结果，不直接写大量业务规则。
- [ ] 区域越权、national-only、角色要求由服务层硬校验。
- [ ] task/store/region/date 的可选规范化可以放到专门 helper。

**验收：**

- [ ] 同一个工具无论从 LangGraph 还是 legacy 调用，都受到相同校验。

### Task 5.3 `authorizeToolCall` 支持更清晰的 scope 结果

**目标：** 权限失败要能被 FC 节点转换成安全的用户回答。

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/services/chatToolsService.js`、`server/agent/graph/nodes.js` |
| 涉及函数 | `authorizeToolCall`、`executeByName`、`fc_ExecuteTool` |

**修改要求：**

- [ ] 权限失败返回或抛出结构化错误：`code`、`message`、`toolName`、`scope`。
- [ ] `fc_ExecuteTool` 根据权限错误停止危险执行。
- [ ] 最终回答要说明无法访问的数据范围，不能让 LLM 编造。

**验收：**

- [ ] 区域 scope 用户无法查询其他区域详情。
- [ ] 权限错误不会被当作普通工具数据摘要。

---

## 12. Phase 6：测试、观测、文档同步

### Task 6.1 后端单元测试清单

**目标：** 用低成本测试覆盖这次复查发现的核心问题。

| 测试目标 | 涉及文件 / 函数 |
|---|---|
| 工具名真实存在 | `chatToolsService.getRegisteredToolNames`、`toolRetrieve` |
| intent alias normalize | `normalizeIntent`、`toolRetrieve` |
| namespace normalize | `normalizeToolName`、`getToolMeta`、`executeByName` |
| duplicate cache | `fc_CheckDuplicate`、`fc_MergeToolResults` |
| 多工具执行 | `fc_ExecuteTool`、`fc_MergeToolResults` |
| 参数校验 | `validateToolArgs`、`fc_ValidateParams` |
| Persist error | `persistAndEmit`、`sendMessageStreamLangGraph` |

**验收：**

- [ ] 不依赖真实 LLM 的测试能在本地稳定跑。
- [ ] 至少覆盖 P0/P1 问题的 happy path 与 failure path。

### Task 6.2 前端测试清单

**目标：** 防止 clarify 被拼进正文，防止 resume 破坏普通聊天。

| 测试目标 | 涉及文件 / 函数 |
|---|---|
| phase 解析 | `normalizeStreamDelta`、`feedExecStreamDelta` |
| clarify callback | `runExecStyleSseChat`、新增 `onClarify` |
| resume API | `streamResumeExecutiveChatMessage` |
| pending UI | `index.vue` 的 `pendingClarification`、`handleClarifySubmit` |
| stop/cancel | `handleStop`、`handleClarifyCancel` |

**验收：**

- [ ] `phase: "clarify"` 不进入 `contentBuf`。
- [ ] resume 成功后同一条 assistant message 继续更新。

### Task 6.3 E2E 业务问题回归

**目标：** 用真实业务问题验证工具路由修复有效。

| 问题类型 | 示例 | 预期工具 |
|---|---|---|
| 总览指标 | “现在整体完成率怎么样？” | `getOverviewData` 或 `queryExecutiveMetrics` |
| 任务列表 | “当前项目状态/任务进展有哪些？” | `getTaskListData` |
| 区域详情 | “华东区表现如何？” | `getRegionDetailData` |
| 门店下钻 | “某门店为什么落后？” | `getStoreDetailData` |
| 预警 | “哪些门店有风险？” | `getWarningsData` |
| 分析 | “帮我分析影响完成率的因素” | `runAnalytics`、必要时 `fetchRawDataset` |
| 澄清 | “查一下那个店” | `HumanInTheLoopGate` + `/resume` |

**验收：**

- [ ] 每类问题都能在日志或 Langfuse 中看到预期工具候选。
- [ ] 至少一条低置信/缺参问题能完整走 clarify -> resume -> final。

### Task 6.4 文档同步清单

**目标：** 修完后文档不再误导下一轮 AI。

| 文档 | 必须同步内容 |
|---|---|
| `../specs/04-API-SPEC.md` | `/resume` 请求体、SSE `clarify/tool_start/tool_end/error/done` payload |
| `../specs/10-EXECUTIVE-CHAT-INTENTS-TOOLS.md` | canonical intent、alias、真实工具名、intent/tool 映射 |
| `../specs/11-EXECUTIVE-CHAT-REQUEST-FLOW.md` | 当前 LangGraph 默认流式链路、HITL resume 路径 |
| `../internal/EXECUTIVE-CHAT-CODE-MAP.md` | 主入口、状态节点、工具层、前端入口最新映射 |
| `../frontend/05-EXECUTIVE-CHAT.md` | clarify UI、resume API、pending state |

**验收：**

- [ ] 文档里不再把 `getProjectStatus` 当作真实工具名。
- [ ] 文档明确 LangGraph 接入层级和 legacy 保留范围。

---

## 13. 推荐提交顺序

为了降低回归风险，建议后续 AI 按以下提交粒度执行：

| Commit | 内容 |
|---:|---|
| 1 | `chatToolsService` registry 访问器 + 工具名静态测试 |
| 2 | `toolRetrieve`、`getLlmWithTools`、intent alias 修复 |
| 3 | 后端 HITL payload、resume route、interrupt handling |
| 4 | 前端 resume API、stream parser、clarify UI |
| 5 | FC 多工具 helper、duplicate、validate、execute、merge 修复 |
| 6 | Persist/SSE/error/final markdown 收口 |
| 7 | 参数校验和权限错误结构化 |
| 8 | E2E 回归、文档同步 |

每个 commit 完成后至少运行：

```bash
node --check TOT_backend/server/agent/graph/nodes.js
node --check TOT_backend/server/agent/graph/graph.js
node --check TOT_backend/server/services/chatService.js
node --check TOT_backend/server/services/chatToolsService.js
node --check TOT_backend/server/routes/chat.js
```

前端改动后运行项目现有的类型检查或构建命令。如果当前项目没有明确命令，执行 AI 必须先查看 `TOT_frontend/package.json` 再决定。

---

## 14. Definition of Done

本轮 post-audit 修复完成的最低标准：

- [ ] `ToolRetrieve` 和 `getLlmWithTools` 不再引用不存在的工具名。
- [ ] 每个 intent 都能映射到真实、可注册、可执行的工具候选。
- [ ] 后端 HITL 能发出结构化 `InterruptPayload`。
- [ ] 前端能显示 clarify UI，并调用 `/resume` 继续同一轮对话。
- [ ] `slot_fill`、`intent_shift`、`cancel` 三种 resume 路径行为明确。
- [ ] FC 循环能处理多个 tool calls，不只处理第一个。
- [ ] duplicate cache 命中后能正确生成 ToolMessage 反馈给 LLM。
- [ ] assistant 落库失败不会被当作成功返回。
- [ ] 最终用户回复不默认输出裸 JSON。
- [ ] API、intent/tool、request-flow、frontend 文档与代码保持一致。

