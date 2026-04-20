# Executive Chat 意图与工具实现说明（As-Is）

**最后更新：** 2026-04-17  
**状态：** Current  
**适用范围：** `TOT_backend/server/services/chatIntentService.js`、`chatAgentRunner.js`、`chatToolsService.js`、`server/chat_tools/*`

> 约定：`09-EXECUTIVE-CHAT.md` 对意图与工具仅保留摘要列表；本文件作为意图/工具实现与扩展流程的详细说明正本。

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

## 1. 当前已实现意图（intentType）

当前代码中有效意图集合定义于 `chatIntentService.js` 的 `VALID_INTENTS`：

| intentType | 语义 | 示例问题 | 当前状态 |
|-----------|------|----------|----------|
| `progress_query` | 培训进度与完成率查询 | 「Q1 新品培训完成率是多少？」 | 已实现 |
| `project_status` | 项目/任务状态查询 | 「现在有哪些进行中的培训任务？」 | 已实现 |
| `warning_query` | 预警与风险查询 | 「现在有哪些门店需要重点关注？」 | 已实现 |
| `drill_down` | 区域或门店下钻查询 | 「华东区怎么样？」/「上海环球港店怎么样？」 | 已实现 |
| `analytics_query` | 统计分析查询（依赖 `analysisType`） | 「华东区 P90 完成耗时是多少？」 | 已实现 |
| `unknown` | 闲聊或超范围问题兜底 | 「你好」「谢谢」 | 已实现 |

---

## 2. 当前已注册工具（tool name）

工具由 `chatToolsService.js` 在启动时动态加载 `server/chat_tools/*.js` 并注册。

| tool name | 文件 | 核心用途 |
|----------|------|----------|
| `getOverviewData` | `server/chat_tools/tool_getProgressMetrics.js` | 在**当前高管数据权限**下，对已下发任务做**全量或按任务/大区**汇总：门店 assignment 总数、已完成/进行中/待开始人数、整体完成率、按时完成率、平均完成耗时（小时）；可选 `taskId`、`region` 收窄范围。 |
| `getTaskListData` | `server/chat_tools/tool_getProjectStatus.js` | 列出**状态为已下发**的培训任务：每项任务的标题、截止时间、下发门店 assignment 数、已完成数及该项任务的完成率；用于回答「有哪些任务、各自进度到哪了」。 |
| `getWarningsData` | `server/chat_tools/tool_getWarnings.js` | 优先返回**完成率低于阈值**的门店清单（风险门店）；若无足够明细，按实现**依次降级**：低完成率门店排行 → 权限内整体完成概览 → 近 7 日完成趋势，并在结果里标明数据来源，避免「无数据却沉默」。 |
| `getRegionDetailData` | `server/chat_tools/tool_getRegionDetailData.js` | **指定大区名称**（必填 `region`）：该区在权限内的 assignment 汇总（总数、完成率、进行中/待开始、平均耗时），并给出门店**完成率最低/最高**各 `topN` 家，用于区域对比与垫底门店定位。 |
| `getStoreDetailData` | `server/chat_tools/tool_getDrillDownMetrics.js` | **指定门店**（`storeId`，或传入名称由后端在权限内模糊匹配）：若名称命中多家则返回**候选列表**请用户消歧；确定门店后返回该店在某一任务下的**员工级** assignment 状态与进度字段，用于「这家店每个人做到哪一步」。 |
| `runAnalytics` | `server/chat_tools/tool_runAnalytics.js` | 根据参数 **`analysisType`** 执行一类统计：如完成耗时 **P90/分位**、耗时**分布桶**、**nudge 与 progress 相关性**、按渠道的完成率**方差**、基于近期速度的**完成率预测**、**截尾均值**等；可配合 `taskId` / `region` / `storeId` 过滤。 |

---

## 3. 当前意图 -> 工具映射关系

### 3.1 Intent Routing 模式（默认）

`CHAT_AGENT_MODE=intent_routing` 时，映射由 `chatAgentRunner.js` 中 `toolMap` 控制：

| intentType | 工具映射规则 |
|-----------|--------------|
| `progress_query` | `getOverviewData` |
| `project_status` | `getTaskListData` |
| `warning_query` | `getWarningsData` |
| `drill_down` | 若 `entities.region` 存在且 `storeId/storeName` 均为空 -> `getRegionDetailData`；否则 -> `getStoreDetailData` |
| `analytics_query` | `runAnalytics` |
| `unknown` | 不调用工具，直接返回对话/引导内容 |

### 3.2 Function Calling 模式（可切换）

`CHAT_AGENT_MODE=function_calling` 时，模型可自主选择调用多个工具；最终 `intentType` 由以下逻辑推导：

1. 若发生工具调用：按调用过的工具名集合推导（`deriveIntentType`）
2. 若无工具调用：使用正则兜底推导（`inferIntentFromMessage`）

---

## 4. analytics_query 的 analysisType 子能力

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

1.  **分析触发 (Phase 1)**: 用户提出分析类问题。AI 识别意图并获取数据，首轮返回 Markdown 文字总结，并在文末通过 **` ```suggestions ` 建议区块** 放入带有 `[绘图]` 标记的建议。
2.  **一键直达 (Phase 2)**: 前端检测到建议区块包含 `[绘图]`，点击后跳过输入框直接发送请求。
3.  **上下文恢复与复用**: 
    *   后端 `chatAgentRunner.js` 探测到 `[绘图]` 关键字，自动回溯 Session 缓存。
    *   **极速出数**: 优先复用上一轮成功的 `toolResult`，实现瞬间响应。

### 5.2 后端实现与补偿 (Compensate Logic)

为了对抗 LLM 输出 JSON 格式的不稳定性，采用了 **“AI 生成为主，代码补偿为辅”** 的策略：

*   **Prompt 引导**: 在提示词中约束模型必须将图表 JSON 放入 **` ```echarts ` 代码块**。
*   **硬逻辑补偿**: 若 LLM 返回结果缺失该代码块，后端逻辑层会根据 `toolResult` 自动生成标准的 ECharts 载荷补位。

### 5.3 前端渲染规范

*   **流式闸门**: 为防止解析半截 JSON 导致崩溃，`AiChartRenderer` 仅在 SSE 消息标记为 `done` 后才正式挂载 ECharts 实例。
*   **JSON 修复**: 前端集成 `repairJson` 工具，自动修复 LLM 常见的末尾逗号、未闭合引号等语法错误。
*   **交互优化**:
    *   **多图 Swiper**: 图表 > 1 时启用 CSS 横向滑动容器。
    *   **手势增强**: 默认开启 `inside` 型 DataZoom 支持双指缩放。

### 5.4 工具执行指示器 (Implemented)

为了解决分析类请求耗时较长导致的“黑盒等待”问题，系统在 `function_calling` 模式下实现了实时状态同步：

1.  **后端触发**: 在 `chatAgentRunner.js` 的 FC 循环中，每次工具调用前后分别推送 `tool_start` 和 `tool_end` 事件。
2.  **SSE 载荷**: `data: {"text": "toolName", "phase": "tool_start"}`。
3.  **前端展示**: `executive/index.vue` 接收该事件，并根据 `TOOL_DISPLAY_NAMES` 映射表，在 AI 消息气泡顶部显示带 `n-spin` 的“正在查询...”文案。

---

## 6. 如何新增意图（Intent）

以下流程适用于新增例如 `ranking_query` 这类新意图。

### Step 1: 扩展意图定义与提示词

修改 `server/services/chatIntentService.js`：

1. 在 `VALID_INTENTS` 中加入新意图名
2. 在 `SYSTEM_PROMPT` 的“合法 intentType”与示例中加入正例/反例
3. 若与现有意图边界易混淆，补充区分规则（例如与 `warning_query` 的区别）

### Step 2: 在调度器注册映射

修改 `server/services/chatAgentRunner.js`：

1. `runIntentRouting()` 中的 `toolMap` 新增映射  
   例如：`ranking_query: 'getRankingData'`
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

## 6. 如何新增工具（Tool）

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

## 7. 新增意图 + 新增工具的最小变更清单（Checklist）

- [ ] `chatIntentService.js`：新增 intent 定义与提示词样例  
- [ ] `chat_tools/tool_<name>.js`：新增工具 schema/meta/handler  
- [ ] `chatAgentRunner.js`：新增映射与意图反推逻辑  
- [ ] 测试脚本与 fixtures：新增覆盖  
- [ ] `09-EXECUTIVE-CHAT.md`：能力描述与示例更新  
- [ ] `04-API-SPEC.md`：若有外部契约变化则更新  
- [ ] 本文档：更新 As-Is 清单与映射表

---

## 8. 常见坑位

- 只加了工具文件，**没加映射**，导致 intent_routing 永远不会调用新工具
- 只加了映射，**没加 `deriveIntentType`**，导致 FC 落库 `intentType` 语义不准
- 只加了意图，**没补提示词样例**，分类精度下降
- 忽略 `regionScope`，造成越权风险（应返回统一权限错误）
- 更新了实现，**未同步 09/04 文档**，造成文档与代码漂移

