# Executive Chat 意图与工具实现说明（As-Is）

**最后更新：** 2026-04-28  
**状态：** Current  
**适用范围：** `TOT_backend/server/services/chatIntentService.js`、`chatAgentRunner.js`、`chatToolsService.js`、`server/chat_tools/*`

> 约定：`09-EXECUTIVE-CHAT.md` 对意图与工具仅保留摘要列表；本文件作为意图/工具实现与扩展流程的详细说明正本。  
> 当前运行链路以 `chatService -> chatAgentRunner` 为准；LangGraph 迁移内容见 `docs/plans/`，不在本文件混写目标态节点细节。

---

## 文档目的

本文聚焦说明 Executive Chat 当前已经落地的三件事：

1. **已实现的意图（intentType）**
2. **已注册可调用工具（tool name）**
3. **意图到工具的映射关系（含分支规则）**

并提供标准化操作步骤，说明如何新增：

- 新意图（Intent）
- 新工具（Tool）
- 以及二者的联动注册与回归验证

> HTTP 请求/响应字段正本仍以 [`04-API-SPEC.md`](./04-API-SPEC.md) §6 为准；  
> Executive Chat 产品能力边界以 [`09-EXECUTIVE-CHAT.md`](./09-EXECUTIVE-CHAT.md) 为准。

---

## 1. 当前已实现规范意图（Canonical Intents）与别名（Aliases）

### 1.1 规范意图集合（Canonical Intents）

当前系统中，无论是 Router 模型的直接输出，还是经过别名转换后，最终用于路由和视图渲染的规范意图（Canonical Intents）如下：

| 规范意图 (Canonical) | 语义 | 核心工具优先级 | 示例问题 |
|-----------|------|----------|----------|
| `query_metrics` | 综合指标/矩阵查询 | `queryExecutiveMetrics`, `getOverviewData` | 「各区域的完成率和 P0 预警数是多少？」 |
| `progress_query`| 培训进度概览查询 | `getOverviewData`, `queryExecutiveMetrics` | 「Q1 新品培训完成率是多少？」 |
| `project_status`| 项目/任务状态查询 | `getTaskListData`, `getOverviewData` | 「现在有哪些进行中的培训任务？」 |
| `warning_query` | 预警与风险查询 | `getWarningsData`, `queryExecutiveMetrics` | 「现在有哪些门店需要重点关注？」 |
| `drill_down`    | 区域或门店下钻查询 | `getRegionDetailData`, `getStoreDetailData` | 「华东区怎么样？」/「上海环球港店怎么样？」 |
| `analytics_query`| 高阶统计分析查询 | `runAnalytics`, `queryExecutiveMetrics` | 「华东区 P90 完成耗时是多少？」 |
| `chat_only`     | 纯对话/闲聊兜底 | (不调用工具) | 「你好」「谢谢」「你是谁」 |

### 1.2 意图别名映射表（INTENT_ALIAS_MAP）

由于 LLM 偶尔会输出旧版文档中的别名，系统在 `intents.js` 中维护了统一的 `INTENT_ALIAS_MAP` 以进行归一化 (`normalizeIntent`)：

| LLM 输出 / 别名 (Alias) | 规范意图 (Canonical) | 说明 |
|---|---|---|
| `matrix_query` | `query_metrics` | 旧版矩阵查询统一并入 query_metrics |
| `task_status` | `project_status` | 任务状态查询统一并入 project_status |
| `store_warning`| `warning_query` | 门店预警统一并入 warning_query |
| `analytics` | `analytics_query`| 统计分析后缀补齐 |
| `unknown` | `chat_only` | 无法识别或闲聊兜底 |

---

## 2. 当前已注册工具（tool name）

工具由 `chatToolsService.js` 在启动时动态加载 `server/chat_tools/*.js` 并注册。当前仓库内文件与注册名如下：

| tool name | 文件 | 核心用途 |
|-----------|------|----------|
| `getOverviewData` | `server/chat_tools/tool_getProgressMetrics.js` | 在**当前高管数据权限**下，对已下发任务做**全量或按任务/大区**汇总：门店 assignment 总数、已完成/进行中/待开始人数、整体完成率、按时完成率、平均完成耗时（小时）；可选 `taskId`、`region` 收窄范围。 |
| `queryExecutiveMetrics` | `server/chat_tools/tool_queryExecutiveMetrics.js` | **（v3.0 统一入口）** 多维度（区域/业态/经销商/门店）、多度量（完成率/预警/耗时/读取等）组合查询；支持过滤与排序；意图 `matrix_query` 在 intent_routing 下默认走此工具。 |
| `getTaskListData` | `server/chat_tools/tool_getProjectStatus.js` | 列出**状态为已下发**的培训任务：每项任务的标题、截止时间、下发门店 assignment 数、已完成数及该项任务的完成率。 |
| `getWarningsData` | `server/chat_tools/tool_getWarnings.js` | 优先返回**完成率低于阈值**的门店清单；若无足够明细，按实现**依次降级**：低完成率门店排行 → 权限内整体完成概览 → 近 7 日完成趋势，并在结果里标明数据来源。 |
| `getRegionDetailData` | `server/chat_tools/tool_getRegionDetailData.js` | **指定大区名称**（必填 `region`）：该区在权限内的 assignment 汇总及门店**完成率最低/最高**各 `topN` 家。 |
| `getStoreDetailData` | `server/chat_tools/tool_getDrillDownMetrics.js` | **指定门店**（`storeId` 或名称模糊匹配）；名称命中多家则返回**候选列表**消歧；确定后返回员工级 assignment 状态。 |
| `runAnalytics` | `server/chat_tools/tool_runAnalytics.js` | 按 **`analysisType`** 执行统计：分位数/分布/相关性/方差/预测/截尾均值等；可配合 `taskId` / `region` / `storeId` 过滤。 |

### 2.1 `queryExecutiveMetrics` 参数契约（与 schema 对齐）

| 参数名 | 类型 | 必填 | 默认值 | 说明/合法值 |
|--------|------|------|--------|-------------|
| `dimensions` | string[] | 否 | 空或 `["all"]` 语义见 schema | `channel_l3`（大区）、`channel_l4`（业态）、`dealer`、`store` |
| `metrics` | string[] | **是** | - | `completion_rate`、`completed_count`、`total_count`、`avg_completion_time_hours`、`read_rate`、`start_delay_rate`、`crisis_p0_rate`、`crisis_p1_rate`、`crisis_p0_count`、`crisis_p1_count` |
| `taskName` | string | 条件 | - | 任务标题关键词；与 `productName` **业务上二选一**（服务层会校验任务上下文）。 |
| `productName` | string | 条件 | - | MyPAL 产品名；与 `taskName` 二选一。 |
| `filters` | object | 否 | `{}` | `region`、`rtm`、`format`、`dealerName`、`storeId` |
| `sort` | object | 否 | - | `{ sortBy: string, order: "asc" \| "desc" }` |

---

## 3. 意图与候选工具映射 (INTENT_TOOL_MAP)

在当前的 LangGraph 架构中，系统通过 `INTENT_TOOL_MAP` 为不同的规范意图静态绑定了一组推荐的候选工具集合，这些候选工具将提供给 LLM 供其在 FC 循环中自主调用：

| 规范意图 (intent) | 绑定的候选工具列表 (Candidate Tools) |
|-----------|--------------|
| `query_metrics` | `queryExecutiveMetrics`, `getOverviewData`, `getRegionDetailData` |
| `progress_query` | `getOverviewData`, `queryExecutiveMetrics` |
| `project_status` | `getTaskListData`, `getOverviewData`, `queryExecutiveMetrics` |
| `warning_query` | `getWarningsData`, `queryExecutiveMetrics`, `getStoreDetailData` |
| `drill_down` | `getRegionDetailData`, `getStoreDetailData`, `queryExecutiveMetrics` |
| `analytics_query` | `runAnalytics`, `queryExecutiveMetrics`, `fetchRawDataset`, `executeCode` |
| 兜底 (Fallback) | `queryExecutiveMetrics`, `getOverviewData`, `getTaskListData` |

> **说明**：
> 1. `ContextAnalyzerRouter` 确定意图并完成归一化后，`ToolRetrieve` 节点会根据此表筛选工具注入上下文。
> 2. 这是目前的静态绑定策略。未来 `ToolRetrieve` 可能会升级为结合 BM25 动态检索的 Top-K 模式。

---

## 4. `analytics_query` 的 `analysisType` 子能力

`runAnalytics` 当前支持以下 `analysisType`：

| analysisType | 能力说明 | 可视化支持 (visualizations) | 当前状态 |
|-------------|----------|--------------------------|----------|
| `quantile_duration` | 分位数/极值（如 P90） | 推荐仅 `keyNumbers` | 已实现 |
| `completion_time_distribution` | 完成时间分布 | **Bar/Histogram** | 已实现 |
| `metric_correlation` | 指标相关性（Pearson） | **Scatter** | 已实现 |
| `progress_variance_by_channel` | 渠道离散度/方差 | **Bar** (横向对比) | 已实现 |
| `completion_rate_forecast` | 完成率趋势预测 | **Line** (含预测虚线) | 已实现 |
| `trimmed_mean_duration` | 截尾均值 | 推荐仅文字 | 已实现 |

---

## 5. 数据可视化激发与实现机制

### 5.1 激发流程 (Trigger Flow)

为了确保高管在移动端能够获得“先看结论，再看详情”的体验，系统设计了一套结合了 AI 推理与硬编码补偿的可视化闭环。

1. **分析触发 (Phase 1)**：用户提出分析类问题。AI 识别意图并获取数据，首轮返回 Markdown 文字总结，并在文末通过 **` ```suggestions `** 建议区块放入带有 `[绘图]` 标记的建议。
2. **一键直达 (Phase 2)**：前端检测到建议区块包含 `[绘图]`，点击后跳过输入框直接发送请求。
3. **上下文恢复与复用**：
   - 后端 `chatAgentRunner.js` 探测到 `[绘图]` 关键字，可结合 Session 状态（`chatSessionStateService`）复用上一轮 `runAnalytics` 上下文。
   - **极速出数**：在 intent_routing 与 session 缓存命中时，可跳过重复工具执行（实现以代码为准）。

### 5.2 后端实现与补偿 (Compensate Logic)

为了对抗 LLM 输出 JSON 格式的不稳定性，采用了 **“AI 生成为主，代码补偿为辅”** 的策略：

- **Prompt 引导**：在提示词中约束模型将图表 JSON 放入 **` ```echarts `** 代码块。
- **硬逻辑补偿**：若 LLM 返回结果缺失该代码块，后端可根据 `toolResult` 自动生成标准 ECharts 载荷补位（见各分析路径实现）。

### 5.3 前端渲染规范（与 `TOT_frontend` 对齐）

- **流式**：Markdown 由 `MarkdownRenderer` 解析；`echarts` / `suggestions` 块在组件内抽取后分别交给 `AiChartRenderer` 与追问气泡。
- **JSON 修复**：前端 `repairJson` 等用于修复流式半截结构化输出（与 Executive 流式协议配合）。
- **交互**：多图横向滑动、DataZoom 等与 `09` / 前端实现一致。

### 5.4 工具执行阶段与 SSE（`delta` 事件）

FC 循环中，工具调用前后通过 `streamFormatCallbacks.onDelta` 通知流式层：

- **`chatAgentRunner.js`**：`tool_start` / `tool_end` 等 **phase** 与文本增量一并传入回调。
- **`chatService.js`（stream）**：当前将每条增量序列化为  
  `event: delta`，`data: JSON.stringify({ text, phase })`，其中 **`phase`** 可为 `reasoning`、`content`、`tool_start`、`tool_end` 等（以 `meta.phase` 为准）。  
  **说明**：若工具名仅存在于回调 `meta` 的扩展字段而未合并进 `text`，则客户端收到的 `text` 在工具边界处可能为空字符串；如需展示具体工具名，应在后端统一扩展 `data` 字段或把名称并入 `text`（实现演进时同步更新本文与 `04-API-SPEC.md`）。

---

## 6. 语音播报与正文范围（产品约定，前端实现）

与 [`09-EXECUTIVE-CHAT.md`](./09-EXECUTIVE-CHAT.md) §1.1 一致：Executive Chat 支持 TTS（经后端 `/ws/tts` 代理至百炼实时 TTS）。**朗读文本必须与主气泡「正式回答」一致**：

- **不朗读**折叠区「思考过程」（SSE `phase: reasoning` 对应的前端 `thinking` 展示）。
- **朗读**：结构化卡片字段格式化后的正文，或 Markdown **正文**（`content` / `markdownContent`），与 `TOT_frontend` 中 `speechTextForExecutiveTts` / `speechTextForSendResult` 语义对齐。

后端仍只负责 `reasoning_content` 与 `content` 分流（见 `server/utils/ai.js` `chatWithToolsStream`）；TTS 裁剪在前端完成。

---

## 7. 如何新增意图（Intent）

以下流程适用于新增例如 `ranking_query` 这类新意图。

### Step 1: 扩展意图定义与提示词

修改 `server/services/chatIntentService.js`：

1. 在 `VALID_INTENTS` 中加入新意图名
2. 在 `SYSTEM_PROMPT` 的“合法 intentType”与示例中加入正例/反例
3. 若与现有意图边界易混淆，补充区分规则（例如与 `warning_query` 的区别）

### Step 2: 在调度器注册映射

修改 `server/services/chatAgentRunner.js`：

1. `runIntentRouting()` 中的 `toolMap` 新增映射（例如 `ranking_query: 'getRankingData'`）
2. `deriveIntentType()` 新增反推规则（用于 FC 模式落库语义）
3. 如需 regex 兜底识别，更新 `inferIntentFromMessage()`

### Step 3: 联动测试

至少补充：

- `server/scripts/test-intent-classify.js` 基线用例（及对应 fixtures）
- 若涉及分支逻辑（类似 drill-down），补充专门脚本测试

### Step 4: 文档同步

至少同步：

- 本文（`10-EXECUTIVE-CHAT-INTENTS-TOOLS.md`）
- [`09-EXECUTIVE-CHAT.md`](./09-EXECUTIVE-CHAT.md)（能力与示例）
- [`04-API-SPEC.md`](./04-API-SPEC.md)（若对外可见口径变更）

---

## 8. 如何新增工具（Tool）

以下流程适用于新增例如 `getRankingData` 的新工具。

### Step 1: 新建工具文件

在 `server/chat_tools/` 新建 `tool_<name>.js`，导出：

- `schema`（OpenAI function schema，必须有 `function.name`）
- `meta`（如 `requiredRole`、`scopePolicy`、`timeoutMs`）
- `handler(args, regionScope)`（业务实现）

强制约束：

- 所有查询必须带权限范围过滤（`regionScope` + `buildRegionFilter`）
- 入参尽量显式声明 `required`，避免 LLM 无参误调
- 错误需可解释，避免“静默空结果”

### Step 2: 自动注册验证

`chatToolsService.js` 会自动扫描并加载 `chat_tools/*.js`。  
完成后应验证：

1. `TOOL_SCHEMAS` 中存在新工具
2. `executeByName('<newTool>', ...)` 可命中 handler

### Step 3: 将工具接入意图或 FC 提示

根据需求选择：

- Intent Routing：在 `toolMap` 中显式绑定 intent -> tool
- Function Calling：确保 schema 描述清晰，便于模型正确选用

### Step 4: 回归与验收

建议至少执行：

- `node --check server/services/chatAgentRunner.js`
- `node --check server/services/chatIntentService.js`
- `node --check server/chat_tools/tool_<name>.js`
- 意图分类基线与关键场景端到端测试

---

## 9. 新增意图 + 新增工具的最小变更清单（Checklist）

- [ ] `chatIntentService.js`：新增 intent 定义与提示词样例  
- [ ] `chat_tools/tool_<name>.js`：新增工具 schema/meta/handler  
- [ ] `chatAgentRunner.js`：新增映射与意图反推逻辑  
- [ ] 测试脚本与 fixtures：新增覆盖  
- [ ] `09-EXECUTIVE-CHAT.md`：能力描述与示例更新  
- [ ] `04-API-SPEC.md`：若有外部契约变化则更新  
- [ ] 本文档：更新 As-Is 清单与映射表  

---

## 10. 常见坑位

- 只加了工具文件，**没加映射**，导致 intent_routing 永远不会调用新工具
- 只加了映射，**没加 `deriveIntentType`**，导致 FC 落库 `intentType` 语义不准
- 只加了意图，**没补提示词样例**，分类精度下降
- 忽略 `regionScope`，造成越权风险（应返回统一权限错误）
- 更新了实现，**未同步 09/04 文档**，造成文档与代码漂移
- **`matrix_query` 未抽取 `taskName`/`productName`**，导致 `queryExecutiveMetrics` 缺少任务上下文而失败
