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

- **`query_active_tasks`**：无参。返回任务数组；每项仅 **`taskId` / `title` / `ddl_at` / `avgProgressPercent` / `regionInsights`**。**`regionInsights`** 是 4 个区域子 Agent 已经分别独立分析后的结构化结果（`funnel` / `warning` / `trend` / `rtm`，每个含 `severity` / `summary` / `keyFindings` / `focusHint`，降级时会带 `degraded=true`）。主 Agent 不再处理原始看板大数据，仅基于 4 段子 Agent 文案与 KPI 综合给出 `topTasks` 与 `focusModule`。详见 §7。
- **`read_agent_guidelines`**：无参。读取 `agent_guidelines` 表中对应 `agent_type` 的全部经验条目并返回为拼接文本。
- **`upsert_agent_guidelines`**：参数 `{ "merged_markdown_content": "string" }`。Agent 在分析过程中如果发现新规律或纠错经验，会要求它将新知识与旧知识进行合并、去重、压缩（限制在 1000 字以内），然后调用此接口进行全量覆盖写入（UPSERT 逻辑）。这防止了记忆库的无限膨胀和内容冲突。

### 3.2 开发者如何扩展新工具

如需让 Agent 具备新能力（例如给相关店长发邮件），开发者只需两步：

1. **定义 Schema**：在 `dashboardToolsSchema` 数组中增加标准 OpenAI/DeepSeek 的 Function JSON-Schema 声明。
2. **实现 Handler**：在 `executeDashboardTool(name, args, context)` 的 `if/else` 分支中，增加对应的业务逻辑代码。由于 Agent 后端与数据库同构，Handler 内部可以直接调用 `db.get()` / `db.run()` 等原生操作。

## 4. 容错与边界防御

- **幻觉隔离**：Agent 最终被要求以 `json_object` format 强制输出 JSON，且由专门的正则 `extractJsonFromText` 进行安全反序列化。
- **循环限制**：在 `dashboardDiagnose.js` 等 Skill 执行流中，硬编码了 `MAX_LOOPS = 6`。如果大模型陷入“连续调用工具而不输出最终结果”的死循环，达到 6 轮后将主动抛出 `AGENT_003` 异常终止执行，防止 Token 消耗失控。

## 5. LangGraph 演进（Executive Chat，目标态说明）

对于对话类 Agent（如 Executive Chat），为了解决状态流转隐式化、消歧恢复困难及与 SSE 协议耦合过深的问题，团队正在推进 **LangGraph** 迁移。  
**当前代码事实**：主链仍是 `chatService -> chatAgentRunner`；`server/agent/graph/*` 为原型实现，尚未替换线上主路径。

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

在目标态图流转结束后 (`PersistAndEmit` 节点)，记忆提取不再阻塞主线程。系统将向 `MemoryIngestionQueue` 抛出事件并由 Worker 异步处理。  
**当前实现**：仍以 `chatMemoryService.extract(sessionId)` 的 `setImmediate` 异步方式为主，BullMQ Producer 已有原型但未接入主链。

---

## 7. 多 Agent 协作模型（看板诊断）

为了让 `Dashboard Agent` 在更细粒度上专业化、且单次 Prompt 不再被原始看板数据塞爆，看板诊断从 v1.5.7 起切换为「主 Agent + 4 个区域子 Agent」协作架构：

```
generateDashboardAgentInsight(userId)
├── (1) 列出所有 dispatched 任务（**已过期任务自动跳过**：`ddl_at < datetime('now','localtime')` 在数据源处直接过滤；`ddl_at IS NULL` 的视为不可判定过期，仍参与诊断）
├── (2) 对每个任务 × 4 个区域 → 并行调度 dashboardSubAgents/runRegionAnalyzers
│       ├── funnelAnalyzer    转化漏斗（reach → read → completion → nudge）
│       ├── warningAnalyzer   预警风险漏斗（P2/P1/P0 + 红橙黄催办覆盖与转化）
│       ├── trendAnalyzer     完成趋势（按日新增 / 累计 / 距 ddl 风险）
│       └── rtmAnalyzer       RTM/门店进度排行（区域分化 + 拖后腿门店）
├── (3) 汇总 regionInsights 注入主 Agent (skills/dashboardDiagnose)
│       └── 主 Agent 通过 query_active_tasks 看到 regionInsights
│           → 综合各区域 severity/focusHint，给出 topTasks/focusModule
└── (4) 写入 dashboard_insights(global_agent) 作为主 Agent 缓存
```

### 7.1 子 Agent 契约（promptTemplates.js）

每个子 Agent 接收 **该任务自己区域的瘦身切片**（来自 `dashboardQueryCore` 的同源数据），调用 `simpleChat (deepseek-chat)`，强制返回如下 JSON：

```json
{
  "severity": "red|orange|green",
  "summary":   "≤80 字业务白话总结",
  "keyFindings": { "<指标中文名>": <数值或字符串>, ... 2~6 项 },
  "focusHint": "north_star|warning_details|rtm_timezone|crisis_p0|funnel_read_rate|nudge_conversion|metrics_overdue"
}
```

JSON 解析失败或 LLM 异常时，每个 analyzer 内置**模板化降级**：基于硬数据（如 P0Rate、taskReadRate、hoursLeft）输出确定性的 severity/summary/focusHint，并打 `degraded=true`，不阻塞主 Agent。

### 7.2 并发与限流

`runRegionAnalyzers` 提供轻量级 limiter，默认 `concurrency = 6`：4 region × N tasks 的所有 LLM 调用并发上限固定为 6，避免 DeepSeek API rate-limit；总 elapsed 在 console 中打点。

### 7.3 缓存策略

- **不缓存**子 Agent 单次输出：每次主 Agent 触发刷新都会重跑一遍 4 段子 Agent，确保实时。
- **保留**主 Agent 已有的缓存（`dashboard_insights.module_type='global_agent'`）；当 `getDashboardAgentInsight(userId, refresh=false)` 时直接吐最近一条 `context_json`。

### 7.4 共享记忆

子 Agent 与主 Agent **共享** `agent_guidelines` 表的 `agent_type='dashboard'` 命名空间。当前阶段子 Agent **只读不写**——只有主 Agent 会调用 `upsert_agent_guidelines` 维护那条全量经验。

### 7.5 过期任务跳过规则

`generateDashboardAgentInsight` 在数据源处即过滤掉 **已过期任务**（`tasks.status = 'dispatched'` 且 `ddl_at < datetime('now','localtime')`）：

- 时区口径与 `dashboardQueryCore.getOverviewBoardData` 中判断 overdue 的 `datetime('now','localtime') > t.ddl_at` 严格一致，避免 8 小时偏差。
- `ddl_at IS NULL` 的任务**保留**进入诊断（不可判定过期）。
- 过滤动作发生在子 Agent 之前，**4 个区域子 Agent 与主 Agent 都不会**为已过期任务消耗 LLM token。
- 返回结构新增字段 `skippedExpiredCount`（向后兼容，未参与跳过时为 0），同时落入 `dashboard_insights.context_json`。
- 当过滤后 `activeTasks.length === 0` 且存在跳过项时，`overallSummary` 改为「已自动跳过 N 个过期任务，当前没有进行中的活跃任务。」；其余分支保持原文案。

---

## 6. 更新日志与版本记录

- **v1.5.8 (2026-05-09)**: 看板诊断 `generateDashboardAgentInsight` 在数据源处自动跳过已过期任务（`ddl_at < now('localtime')`），子 Agent 与主 Agent 都不再为过期任务消耗 LLM token；返回结构新增 `skippedExpiredCount`；空任务分支文案带上跳过计数。
- **v1.5.7 (2026-05-09)**: 看板诊断切换到「主 Agent + 4 个区域子 Agent」协作架构。`query_active_tasks` 不再返回原始 `boardView`，改为返回每个任务的 4 段 `regionInsights`（funnel/warning/trend/rtm）。新增 `server/services/dashboardSubAgents/` 目录与 `runRegionAnalyzers`（默认并发 6、各 analyzer 自带模板降级）；`dashboardQueryCore` 增加 `getWarningsBoardData` / `getNudgeConversionBoardData`，`/dashboard/warnings` 与 `/dashboard/nudge-conversion` 路由薄壳化。
- **v1.5.6 (2026-05-08)**: 看板诊断 `query_active_tasks` 载荷以 **`boardView` 为主**（overview + heatmap_rtm + heatmap_store + trend_daily，与 dashboard HTTP 同源）；`dashboardQueryCore` 增加 **`getTrendBoardData`**；`/dashboard/trend` 路由改为调用 core。
- **v4.0.0 (2026-04-27)**: Executive Chat LangGraph 迁移方案与原型落地（目标态文档与原型代码已建立，主链待切换）。
- **v1.5.3 (2026-04-23)**: 首次引入全局 `agent_guidelines` 记忆表与 `agentTools` 工具链。将原有的静态 Prompt 接口 `/api/v1/dashboard/agent/diagnose` 升级为具备多轮思考能力的自主 Agent，实现动态经验加载与自动进化。