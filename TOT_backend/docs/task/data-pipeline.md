# 数据管线

## 工具 → 数据 → 图表/表格 全流程

### 1. 工具调用与返回

Agent FC 循环中 `fc_ExecuteTool` 通过 `chatToolsService.executeByName()` 调工具 handler。

9 个可用工具（`server/chat_tools/`）：

| 工具 | 返回格式 | 涉及 MySQL 表 |
|---|---|---|
| `search_task` | `{ success, data: { total_count, rows } }` | `task_publish` |
| `list_task_progress` | `{ success, data: { rows } }` | `task_publish`, `learner_task_queue` |
| `get_task_dashboard` | `{ success, data: { overall_metrics, completion_funnel } }` | `task_publish`, `learner_task_queue`, `task_publish_learner` |
| `query_metric` | `{ success, data: { task_id, rows, dimension } }` | `task_publish`, `learner_task_queue`, `mypal_learning_progress_sync`, `reseller_store` |
| `query_trend` | `{ success, data: { rows } }` | `mypal_learning_progress_sync` |
| `funnel_analysis` | `{ success, data: { stages } }` | `learner_task_queue`, `mypal_learning_progress_sync` |
| `fetch_alert_persons` | `{ success, data: { rows } }` | `learner_task_reminder`, `learner_task_queue` |
| `fetch_incomplete_persons` | `{ success, data: { rows } }` | `learner_task_queue`, `mypal_learning_progress_sync` |
| `ask_user` | 不走 DB，触发 HITL 中断 | — |

### 2. toolResults 解析统一入口

`server/agent/graph/shared/normalizeToolResults.js`（2026-05-21 创建）

输入的 `toolResults` 是 `{ [toolCallId]: { data, toolName, error? } }` map。
输出 `[{ id, toolName, rows, meta }]`。

支持 7 种工具返回格式：
1. `{ data: [...] }` — 数组在 data 键下
2. `{ data: { rows: [...] } }` — list_task_progress 格式
3. `{ rows: [...] }` — query_metric 格式（rows 在顶层）
4. `{ data: { overall_metrics, completion_funnel } }` — get_task_dashboard 格式
5. `{ data: {...} }` — 单条对象
6. 裸数组
7. 裸对象

### 3. 下游消费

```
normalizeToolResults
    ├── extractPlottableData   → datasets (ranking/trend/comparison/funnel)
    │   ├── chart 数据 → AiChartRenderer (ECharts)
    │   └── rawRows    → buildTableFromRows → TableBlock
    │
    ├── decideChart           → 临时图表建议（已废弃，仅 fc_LlmToolCallStep 注入 prompt 时用）
    │
    ├── renderers              → renderToolResultsMarkdown（降级兜底 markdown）
    │
    └── prepareToolData        → JSON.stringify → LLM prompt 上下文
```

### 4. 数据查询层

`server/modules/dashboard/services/executiveMetricsService.js`

- 维度映射 `DIMENSION_MAP`：`{ all, channel_l3, channel_l4, dealer, store }` → 数据库列名
- 聚合逻辑：group by → count 状态分类 → 计算 rate/avg
- 状态分类 `classifyStatus()`（`queryEngine.js`）：根据 `mypal_learning_progress_sync` 判断 completed/in_progress/pending

⚠️ `executiveMetricsService.js` 的 `DIMENSION_MAP` 与 `queryEngine.js` 的 `DIMENSION_KEY` 是两个独立的映射表，键名不完全一致（`channel_l3` vs `rtm`）。已知问题，暂未合并（候选 1，被跳过）。

### 5. 会话标题生成

`persistAndEmit.js` → `generateSessionTitle()`

- 时机：第一条 assistant 回复入库后
- 条件：`chat_session.title IS NULL`
- 模型：DeepSeek Chat，maxTokens=32，temperature=0
- 存储：`chatCrud.updateSessionTitle()`
- 传输：LangGraph state `sessionTitle` → SSE `done` 事件 → 前端侧栏
