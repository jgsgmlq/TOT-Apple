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

## 5. 更新日志与版本记录

- **v1.5.3 (2026-04-23)**: 首次引入全局 `agent_guidelines` 记忆表与 `agentTools` 工具链。将原有的静态 Prompt 接口 `/api/v1/dashboard/agent/diagnose` 升级为具备多轮思考能力的自主 Agent，实现动态经验加载与自动进化。