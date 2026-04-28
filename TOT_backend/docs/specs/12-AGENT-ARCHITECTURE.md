# 12. Agent 架构与机制说明

**状态:** Current | **对应版本:** API v1.5.3+

本文档主要描述系统内非对话类（非 E-Chat）的自主智能体（Autonomous Agents）架构，以 **看板智能 Agent 诊断 (`Dashboard Agent`)** 为例，阐述其 ReAct 工作流、工具链调用 (Tool Calling) 以及持久化记忆库的设计。

---

## 1. 核心架构：ReAct (Reasoning and Acting)

以往的 AI 功能多基于简单的单轮 Prompt 请求（即 One-Shot Generation），缺乏验证和思考过程。新的 Agent 架构采用了 **ReAct 循环** 设计：

1. **观察与思考 (Reasoning)**：Agent 被激活后，并不立即生成最终结果，而是通过大模型先生成一段内部思考，判断当前缺少什么信息。
2. **工具调用 (Acting)**：基于思考，Agent 向后端发起 `tool_calls` 请求（如“读取历史经验”、“查询数据库”）。
3. **获取反馈 (Observation)**：后端执行具体的 JavaScript 函数拦截调用，提取数据库或 API 数据，并将其作为新一轮对话的 `tool` 角色消息返回给 Agent。
4. **闭环输出**：经过多轮（通常设限为 5-6 轮防死循环）收集充足信息后，Agent 不再调用工具，而是输出严格符合业务要求的最终 JSON 结构。

## 2. 数据库设计：经验与记忆库

为了让 Agent “越用越聪明”，系统引入了持久化的可读写记忆表。

### `agent_guidelines` 表结构

此表由 Agent 自主决定何时写入（通过调用 `upsert_agent_guidelines` 工具）。

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT | 主键，nanoid |
| `agent_type` | TEXT | 区分是哪一个 Agent 写下的规律（如 'dashboard', 'e-chat'），实现命名空间隔离。 |
| `rule_text` | TEXT | Agent 自我总结提炼的全量经验文档（不超过 1000 字）。 |
| `created_at` | TEXT | 创建时间 (localtime) |

**机制（定长维基记忆）：**
为了防止 Agent 记忆无限膨胀和产生逻辑冲突，系统并未采用无限 Append 模式。每次 Agent 被唤醒时，会调用 `read_agent_guidelines` 加载自身的一条聚合经验。当 Agent 想要更新经验时，会被强制要求将新旧知识融合成一篇精炼的短 Markdown，然后调用 `upsert_agent_guidelines` 对该 `agent_type` 的记录进行 **全量覆盖替换（DELETE + INSERT）**。

## 3. 工具链 (Toolbox) 定义与扩展

Agent 可使用的能力封装在 `server/agent/tools/` 目录下（如 `dashboardTools.js`）。

### 3.1 现有工具清单（Dashboard Agent）

- **`query_active_tasks`**：无参。返回当前活跃任务的进度、逾期率等系统实时大盘数据。
- **`read_agent_guidelines`**：无参。读取 `agent_guidelines` 表中对应 `agent_type` 的全部经验条目并返回为拼接文本。
- **`upsert_agent_guidelines`**：参数 `{ "merged_markdown_content": "string" }`。Agent 在分析过程中如果发现新规律或纠错经验，会要求它将新知识与旧知识进行合并、去重、压缩（限制在 1000 字以内），然后调用此接口进行全量覆盖写入（UPSERT 逻辑）。这防止了记忆库的无限膨胀和内容冲突。

### 3.2 开发者如何扩展新工具

如需让 Agent 具备新能力（例如给相关店长发邮件），开发者只需两步：

1. **定义 Schema**：在 `dashboardToolsSchema` 数组中增加标准 OpenAI/DeepSeek 的 Function JSON-Schema 声明。
2. **实现 Handler**：在 `executeDashboardTool(name, args, context)` 的 `if/else` 分支中，增加对应的业务逻辑代码。由于 Agent 后端与数据库同构，Handler 内部可以直接调用 `db.get()` / `db.run()` 等原生操作。

## 4. 容错与边界防御

- **幻觉隔离**：Agent 最终被要求以 `json_object` format 强制输出 JSON，且由专门的正则 `extractJsonFromText` 进行安全反序列化。
- **循环限制**：在 `dashboardDiagnose.js` 等 Skill 执行流中，硬编码了 `MAX_LOOPS = 6`。如果大模型陷入“连续调用工具而不输出最终结果”的死循环，达到 6 轮后将主动抛出 `AGENT_003` 异常终止执行，防止 Token 消耗失控。

## 5. LangGraph 演进 (v4.0 Executive Chat)

对于对话类 Agent (如 Executive Chat)，为了解决状态流转隐式化、消歧恢复困难及与 SSE 协议耦合过深的问题，系统在 API v4.0.0 阶段引入了 **LangGraph**。

### 5.1 单层 StateGraph 模型

- 放弃了基于函数的 `runFunctionCalling` 递归。
- 采用 **拍平的 `ExecChatGraphState`**。所有关键信息（消息历史、抽取实体、当前修参次数、挂起状态）在状态机的一级属性中维护。
- 使用原生的 `Checkpointer` (如 Postgres) 进行会话级的快照持久化，天然支持中途打断和唤醒（Human In The Loop）。

### 5.2 `fc_*` 执行循环节点

LangGraph 图包含了以下关键流转节点：
1. **`ContextAnalyzerRouter`**: 前置小模型，一步完成安全判定、意图分类与实体槽位提取。
2. **`fc_CheckSteps`** -> **`fc_LlmToolCallStep`**: 工具预测阶段。流式 (SSE) `reasoning` 副作用会通过传入的 `sseEmitter` 直接发给客户端。
3. **`fc_ValidateParams`** -> **`fc_ParamRepair`**: **修参闭环**。当工具参数不符合 Schema 或跨字段约束时，不再直接报错给用户，而是带着违规详情回转给 LLM 进行纠错。当超过最大重试次数（如 2 次）后执行 **Fail Fast** 中止。
4. **`fc_ExecuteTool`**: 将工具鉴权（`tool_namespace`, `regionScope`）通过硬代码抽离到执行节点之前。

### 5.3 Fire & Forget 记忆异步写入

在图流转结束后 (`PersistAndEmit` 节点)，提取长期记忆的行为不再阻塞主线程响应。系统会向后端的 `MemoryIngestionQueue` (BullMQ 抽象) 抛出一个不等待的事件。独立的 Queue Worker 在后台消费事件、提取新知识并设置 TTL（如 Redis EX 的 14 天过期）。

---

## 6. 更新日志与版本记录

- **v4.0.0 (2026-04-27)**: Executive Chat 模块整体迁移至 LangGraph。实现动态 `RoutingPolicy` 分层、Postgres Checkpointer 状态机恢复以及异步 Queue 记忆架构。
- **v1.5.3 (2026-04-23)**: 首次引入全局 `agent_guidelines` 记忆表与 `agentTools` 工具链。将原有的静态 Prompt 接口 `/api/v1/dashboard/agent/diagnose` 升级为具备多轮思考能力的自主 Agent，实现动态经验加载与自动进化。