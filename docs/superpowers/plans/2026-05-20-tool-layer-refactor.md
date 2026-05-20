# Chat Tools 层重构：合并模块化后端 + V0.3 工具封装

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 dev 分支的模块化后端 (`server/modules/`) 合入本地，修复 Agent 管道 bug，并按 V0.3 规格重写 8 个取数工具，全部调用 service 层而非直接 SQL。

**Architecture:** `Agent (SafetyGateway + FC 5-node) → chat_tools (8 V0.3 工具) → modules/dashboard/services/ + modules/task/services/ → MySQL/SQLite`

**Tech Stack:** Node.js, LangGraph.js, @langchain/openai, modules/dashboard/services/queryEngine, modules/task/crud/taskCrud

---

## 文件变更总览

| Phase | Create | Modify | Delete |
|-------|--------|--------|--------|
| A (合并) | `server/modules/` (整个目录) | `server/services/` (stub 文件), `server/app.js`, `server/routes/chat.js` | — |
| B (修 bug) | — | `fc_LlmToolCallStep.js:16`, `4 个 tool meta` | — |
| C (重写工具) | 8 个 `chat_tools/tool_*.js` | `chatToolsService.js` (工具名映射) | 旧 10 个 tool 文件 |
| D (标准化) | — | `server/agent/graph/graph.js` | — |
| E (清理) | — | — | `chatAgentRunner.js` 等旧文件 |
| F (测试) | `scripts/test-tools.sh` | — | — |

---

## Phase A: 合并 dev 分支模块化后端

### Task A.1: 复制 modules 目录

**Files:**
- Create: `TOT_backend/server/modules/` (entire tree)

- [ ] **Step 1: 复制 modules 目录**

```bash
cp -r /tmp/ops_forge_pilot_admin_backend_dev/server/modules/ TOT_backend/server/modules/
```

- [ ] **Step 2: 验证目录结构**

```bash
ls TOT_backend/server/modules/admin/ TOT_backend/server/modules/common/ TOT_backend/server/modules/dashboard/ TOT_backend/server/modules/mypal/ TOT_backend/server/modules/task/
```

Expected: 5 个子目录都存在。

### Task A.2: 更新 services/ stub 文件

**Files:**
- Modify: `TOT_backend/server/services/` (多个文件)

dev 分支的 `server/services/` 文件已变成指向 `modules/` 的 re-export stub。需要用 dev 版本替换本地的旧实现。

- [ ] **Step 1: 对比差异，确认哪些文件需要替换**

```bash
diff -rq /tmp/ops_forge_pilot_admin_backend_dev/server/services/ TOT_backend/server/services/ 2>&1 | grep -v "autoNudge\|dashboardAgentService\|taskSmartPublishService\|chatToolsService"
```

`autoNudge.js`, `dashboardAgentService.js`, `taskSmartPublishService.js`, `chatToolsService.js` 是本地新增的，保留不动。

- [ ] **Step 2: 替换 stub 文件**

```bash
for f in chatAnalyticsService chatIntentService chatMemoryService chatService chatSessionStateService dashboardInsightService dashboardQueryCore executiveMetricsQueryService; do
  cp /tmp/ops_forge_pilot_admin_backend_dev/server/services/${f}.js TOT_backend/server/services/${f}.js
done
```

- [ ] **Step 3: 替换 dashboardSubAgents 子目录**

```bash
cp /tmp/ops_forge_pilot_admin_backend_dev/server/services/dashboardSubAgents/*.js TOT_backend/server/services/dashboardSubAgents/
```

- [ ] **Step 4: 验证 stub 正确指向 modules**

```bash
head -3 TOT_backend/server/services/executiveMetricsQueryService.js
```

Expected: `module.exports = require('../modules/dashboard/services/executiveMetricsService');`

### Task A.3: 合入 dev 的 app.js 和 routes

**Files:**
- Modify: `TOT_backend/server/app.js`
- Modify: `TOT_backend/server/routes/chat.js`

dev 的 `app.js` 使用 `modules/` 的中间件和路由挂载。本地 `app.js` 需要更新为模块化版本，同时保留 Agent 相关路由。

- [ ] **Step 1: 用 dev 版本替换 app.js**

```bash
cp /tmp/ops_forge_pilot_admin_backend_dev/server/app.js TOT_backend/server/app.js
```

- [ ] **Step 2: 确认 chat 路由还在**

```bash
grep "api/v1/chat" TOT_backend/server/app.js
```

Expected: `app.use('/api/v1/chat', require('./routes/chat'));`

- [ ] **Step 3: 更新 routes/chat.js 为 dev 版本（已引用 sendMessageStreamLangGraph）**

```bash
cp /tmp/ops_forge_pilot_admin_backend_dev/server/routes/chat.js TOT_backend/server/routes/chat.js
```

- [ ] **Step 4: 运行 node --check 确认无语法错误**

```bash
cd TOT_backend/server && node --check app.js 2>&1
```

Expected: no output (no syntax errors).

- [ ] **Step 5: 提交**

```bash
git add TOT_backend/server/modules/ TOT_backend/server/services/ TOT_backend/server/app.js TOT_backend/server/routes/chat.js
git commit -m "feat: merge modular backend (modules/) from dev branch"
```

---

## Phase B: 修复 Agent 管道已知 bug

### Task B.1: 修复 FC LLM 零工具注入

**Files:**
- Modify: `TOT_backend/server/agent/graph/nodes/fc_LlmToolCallStep.js:15-16`

当前 `getToolSchemasByNames()` 无参数调用返回 `[]`，导致 FC LLM 收不到任何工具。

- [ ] **Step 1: 修改 getLlmWithTools**

将 `fc_LlmToolCallStep.js:15-16` 改为：

```js
const getLlmWithTools = () => {
  const allToolNames = chatToolsService.getRegisteredToolNames();
  const finalTools = chatToolsService.getToolSchemasByNames(allToolNames).map((schema) => ({
    type: "function",
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters
    }
  }));

  return finalTools.length > 0 ? getFcModel().bindTools(finalTools) : getFcModel();
};
```

- [ ] **Step 2: 验证修改**

```bash
cd TOT_backend/server && node -e "
const { getLlmWithTools } = require('./agent/graph/nodes/fc_LlmToolCallStep');
const llm = getLlmWithTools();
console.log('boundTools:', Object.keys(llm).includes('boundTools') || llm.bindTools ? 'YES' : 'NO');
"
```

Expected: `boundTools: YES` (当有工具注册时)

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/agent/graph/nodes/fc_LlmToolCallStep.js
git commit -m "fix: pass registered tool names to getToolSchemasByNames in FC LLM"
```

### Task B.2: 修复 requiredRole 配置

**Files:**
- Modify: `TOT_backend/server/chat_tools/tool_getProgressMetrics.js:21`
- Modify: `TOT_backend/server/chat_tools/tool_getProjectStatus.js:15`
- Modify: `TOT_backend/server/chat_tools/tool_getRegionDetailData.js:23`
- Modify: `TOT_backend/server/chat_tools/tool_getDrillDownMetrics.js:21`
- Modify: `TOT_backend/server/chat_tools/tool_getWarnings.js:22-26`
- Modify: `TOT_backend/server/chat_tools/tool_runAnalytics.js`

4 个工具缺少 `requiredRole`，2 个工具 (`getWarningsData`, `runAnalytics`) 只有 `['executive']`。

- [ ] **Step 1: 给缺少 requiredRole 的 4 个工具加上**

对 `tool_getProgressMetrics.js:21`:
```js
// 从
meta: { enabled: true, scopePolicy: 'regional_scoped' },
// 改为
meta: { enabled: true, requiredRole: ['executive', 'central', 'admin'], scopePolicy: 'regional_scoped' },
```

对 `tool_getProjectStatus.js:15`: 同上修改。

对 `tool_getRegionDetailData.js:23`: 同上修改。

对 `tool_getDrillDownMetrics.js:21`: 同上修改。

- [ ] **Step 2: 修复 getWarningsData 和 runAnalytics**

`tool_getWarnings.js:22-26`:
```js
// 从
meta: { enabled: true, requiredRole: ['executive'], scopePolicy: 'regional_scoped', timeoutMs: 8000 },
// 改为
meta: { enabled: true, requiredRole: ['executive', 'central', 'admin'], scopePolicy: 'regional_scoped', timeoutMs: 8000 },
```

`tool_runAnalytics.js` 对应位置:
```js
// 从
requiredRole: ['executive'],
// 改为
requiredRole: ['executive', 'central', 'admin'],
```

- [ ] **Step 3: 验证所有工具都有 requiredRole**

```bash
cd TOT_backend/server && for f in chat_tools/tool_*.js; do
  name=$(grep "name:" "$f" | head -1 | grep -o "'[^']*'" | tr -d "'")
  role=$(grep "requiredRole" "$f" | head -1)
  echo "$name → $role"
done
```

Expected: 每个工具都有 `requiredRole` 包含 `executive, central, admin`。

- [ ] **Step 4: 提交**

```bash
git add TOT_backend/server/chat_tools/tool_getProgressMetrics.js TOT_backend/server/chat_tools/tool_getProjectStatus.js TOT_backend/server/chat_tools/tool_getRegionDetailData.js TOT_backend/server/chat_tools/tool_getDrillDownMetrics.js TOT_backend/server/chat_tools/tool_getWarnings.js TOT_backend/server/chat_tools/tool_runAnalytics.js
git commit -m "fix: add requiredRole to all tools, unify role config"
```

---

## Phase C: 按 V0.3 规格重写工具层

### 架构约定

所有工具遵循统一返回契约：

```ts
// 成功: { success: true, data, summary?, uiHints? }
// 需澄清: { success: false, needDisambiguation: true, reason, message, candidates? }
// 失败: { success: false, errorCode, message }
```

所有数据查询通过 `modules/` service 层：

| 工具 | 调用的 Service |
|------|---------------|
| `get_task_dashboard` | `modules/dashboard/services/queryEngine.getOverviewBoardData()` |
| `list_task_progress` | `modules/task/crud/taskCrud.getTaskList()` + `queryEngine.getOverviewBoardData()` |
| `query_trend` | `modules/dashboard/services/queryEngine.getTrendBoardData()` |
| `query_metric` | `modules/dashboard/services/executiveMetricsService.query()` |
| `funnel_analysis` | `modules/dashboard/services/queryEngine.getFunnelData()` / `getAlertFunnelData()` |
| `fetch_incomplete_persons` | `modules/task/crud/taskCrud.getQueueList()` 或 `modules/dashboard/crud/dashboardCrud.queryAssignmentDetails()` |
| `fetch_alert_persons` | `modules/dashboard/services/queryEngine.getWarningsBoardData()` |
| `search_task` | `modules/task/crud/taskCrud.getTaskList()` 或 `findTasksByName()` |

### Task C.1: 创建 tool_get_task_dashboard.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_get_task_dashboard.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'get_task_dashboard',
      description: '查询单个任务的全景数据（指标、漏斗、预警）。当用户指定了某个具体任务时使用。',
      parameters: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 10000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return {
        success: false,
        needDisambiguation: true,
        reason: 'missing_task_id',
        message: '请提供要查询的任务名称或 ID。'
      };
    }

    const overview = await queryEngine.getOverviewBoardData({ taskId, regionScope });
    const funnel = await queryEngine.getFunnelData({ taskId, regionScope });
    const alerts = await queryEngine.getUnifiedAlertsBoardData({ taskId, regionScope });

    return {
      success: true,
      data: {
        task_id: overview.taskId,
        task_name: overview.taskName,
        platform: overview.platform,
        priority: overview.priority,
        overall_metrics: {
          total_count: overview.totalAssignments,
          sent_count: overview.pushUserCount,
          delivered_count: overview.deliveredCount,
          learning_count: overview.learningCount,
          completed_count: overview.completedCount,
          uncompleted_count: overview.uncompletedCount,
          sent_rate: overview.pushRate,
          delivered_rate: overview.deliveredRate,
          learning_rate: overview.learningRate,
          completion_rate: overview.completionRate
        },
        completion_funnel: funnel,
        alerts: alerts,
        alert_funnel: alerts
      },
      summary: overview.summary || `任务 ${overview.taskName} 完成率 ${overview.completionRate}%`,
      uiHints: { preferredView: 'dashboard' }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_get_task_dashboard.js
```

### Task C.2: 创建 tool_list_task_progress.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_list_task_progress.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');
const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'list_task_progress',
      description: '批量查询多个任务的进度摘要。当用户问"有哪些任务""哪些比较紧急"时使用。',
      parameters: {
        type: 'object',
        properties: {
          task_ids: { type: 'array', items: { type: 'string' }, description: '任务标识列表；不传则返回全部进行中的任务' },
          status: { type: 'string', enum: ['active', 'ended', 'all'], description: '过滤任务状态，默认 active' },
          filters: { type: 'object', description: '筛选条件: {completion_rate_max: 0.5, days_to_deadline_max: 3}' },
          sort_by: { type: 'string', enum: ['deadline', 'completion_rate', 'priority', 'urgency', 'created_at'], description: '排序字段，默认 created_at' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向，默认 desc' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 10000
  },
  handler: async (args, regionScope) => {
    const status = args.status || 'active';
    const tasks = await taskCrud.getTaskList({ statuses: status === 'all' ? ['active', 'ended'] : [status] });

    const rows = await Promise.all(tasks.map(async (t) => {
      const overview = await queryEngine.getOverviewBoardData({ taskId: t.id, regionScope });
      return {
        task_id: t.id,
        task_name: t.name,
        platform: t.platform,
        priority: t.priority,
        completion_rate: overview.completionRate,
        learning_rate: overview.learningRate,
        urgency: overview.urgency || '正常',
        deadline: t.ddl_at,
        learning_count: overview.learningCount
      };
    }));

    let sorted = rows;
    const sortBy = args.sort_by || 'created_at';
    const order = args.sort_order === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      if (sortBy === 'completion_rate') return (a.completion_rate - b.completion_rate) * order;
      if (sortBy === 'deadline') return (a.deadline || '').localeCompare(b.deadline || '') * order;
      return 0;
    });

    if (args.filters) {
      if (args.filters.completion_rate_max != null) {
        sorted = sorted.filter(r => r.completion_rate <= args.filters.completion_rate_max);
      }
      if (args.filters.days_to_deadline_max != null) {
        const threshold = Date.now() + args.filters.days_to_deadline_max * 86400000;
        sorted = sorted.filter(r => r.deadline && new Date(r.deadline).getTime() <= threshold);
      }
    }

    return {
      success: true,
      data: { total_count: sorted.length, rows: sorted }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_list_task_progress.js
```

### Task C.3: 创建 tool_query_metric.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_query_metric.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const executiveMetricsService = require('../modules/dashboard/services/executiveMetricsService');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'query_metric',
      description: '按维度查询指标值，支持 Top/Bottom N 排序。当用户问排名、对比、按维度下钻时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'metrics'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          metrics: { type: 'array', items: { type: 'string' }, description: '指标名称: completion_rate, learning_rate, delivered_rate, sent_rate, total_count, completed_count, uncompleted_count, learning_count, sent_count, delivered_count, p0_count, p1_count, p2_count, p0_rate, p1_rate, p2_rate, avg_duration' },
          dimension: { type: 'string', enum: ['hq', 'l3', 'l4', 'dealer', 'store', 'alert_level'], description: '分组维度，不传则只返回总计' },
          dimension_value: { type: 'string', description: '维度具体值，不传则返回该维度下所有分类' },
          time_range: { type: 'object', description: '{start, end} 或相对表达式如 "last_30_days"' },
          scope_filter: { type: 'object', description: '限定排名范围，如 {l3: "华东大区"}' },
          sort_by: { type: 'string', description: '排序指标' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向' },
          top_n: { type: 'integer', description: '返回 Top/Bottom N 条，不传 dimension_value 时默认 50' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 15000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const params = {
      taskName: taskId,
      metrics: args.metrics || [],
      dimensions: args.dimension ? [args.dimension] : undefined,
      filters: {},
      sort: args.sort_by ? { sortBy: args.sort_by, order: args.sort_order || 'desc' } : undefined,
      topN: args.top_n || 50
    };

    if (args.dimension_value) {
      params.filters[args.dimension] = args.dimension_value;
    }

    const result = await executiveMetricsService.query(params, regionScope);

    if (result.error) {
      return { success: false, errorCode: 'QUERY_ERROR', message: result.message || result.error };
    }

    return {
      success: true,
      data: {
        task_id: result.taskId,
        task_name: result.taskName,
        platform: result.platform,
        priority: result.priority,
        dimension: args.dimension,
        rows: result.rows || [],
        summary: result.summary
      }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_query_metric.js
```

### Task C.4: 创建 tool_query_trend.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_query_trend.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'query_trend',
      description: '查询某任务指标的时间序列。当用户问"每天怎么变""趋势"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'mode', 'time_range'],
        properties: {
          task_id: { type: 'string', description: '任务标识' },
          mode: { type: 'string', enum: ['completion', 'learning'], description: 'completion 返回完成率趋势，learning 返回学习率趋势' },
          time_range: { type: 'object', description: '{start, end} 或相对表达式如 "last_30_days"' },
          granularity: { type: 'string', enum: ['day', 'week'], description: '粒度，默认 day' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 10000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const trendData = await queryEngine.getTrendBoardData({
      taskId,
      regionScope,
      type: args.mode === 'completion' ? 'completion' : 'learning',
      granularity: args.granularity || 'day'
    });

    const overview = await queryEngine.getOverviewBoardData({ taskId, regionScope });

    return {
      success: true,
      data: {
        task_id: overview.taskId,
        task_name: overview.taskName,
        platform: overview.platform,
        priority: overview.priority,
        mode: args.mode,
        granularity: args.granularity || 'day',
        timeline: trendData || []
      }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_query_trend.js
```

### Task C.5: 创建 tool_funnel_analysis.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_funnel_analysis.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'funnel_analysis',
      description: '查询任务完成漏斗或预警催办漏斗。当用户问"各阶段流失""转化率"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'funnel_type'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          funnel_type: { type: 'string', enum: ['completion', 'alert'], description: 'completion 任务完成漏斗，alert 预警催办漏斗' },
          dimension: { type: 'string', enum: ['hq', 'l3', 'l4', 'dealer', 'store'], description: '按维度拆分，不传返回整体' },
          dimension_value: { type: 'string', description: '特定维度值' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 10000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const overview = await queryEngine.getOverviewBoardData({ taskId, regionScope });

    if (args.funnel_type === 'completion') {
      const funnelData = await queryEngine.getFunnelData({ taskId, regionScope });
      return {
        success: true,
        data: {
          funnel_type: 'completion',
          platform: overview.platform,
          priority: overview.priority,
          ...funnelData
        }
      };
    }

    const alertFunnel = await queryEngine.getAlertFunnelData({ taskId, regionScope });
    return {
      success: true,
      data: {
        funnel_type: 'alert',
        platform: overview.platform,
        priority: overview.priority,
        ...alertFunnel
      }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_funnel_analysis.js
```

### Task C.6: 创建 tool_fetch_incomplete_persons.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_fetch_incomplete_persons.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');
const dashboardCrud = require('../modules/dashboard/crud/dashboardCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_incomplete_persons',
      description: '获取未完成人员名单。当用户问"谁还没完成""把名单给我"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          filter: { type: 'object', description: '组织层级筛选: {l3: "华东大区", store: "xxx"}' },
          include_fields: { type: 'array', items: { type: 'string' }, description: '返回字段列表' },
          page_size: { type: 'integer', description: '每页条数，默认 50' },
          page: { type: 'integer', description: '页码，默认 1' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 15000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const page = args.page || 1;
    const pageSize = args.page_size || 50;
    const queues = await taskCrud.getQueuePage({
      taskPublishId: taskId,
      status: 'pending',
      page,
      pageSize
    });

    const rows = queues.map(q => ({
      user_id: q.emailId,
      name: q.learnerName,
      completion_status: '未完成',
      store: q.storeName,
      dealer: q.dealerName,
      l3: q.region,
      l4: q.format
    }));

    return {
      success: true,
      data: {
        task_id: taskId,
        total_count: queues.total || rows.length,
        page,
        page_size: pageSize,
        rows
      }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_fetch_incomplete_persons.js
```

### Task C.7: 创建 tool_fetch_alert_persons.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_fetch_alert_persons.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'fetch_alert_persons',
      description: '获取预警人员名单。当用户问"P0的有哪些人"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'alert_level'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          alert_level: { type: 'string', enum: ['P0', 'P1', 'P2'], description: '预警级别' },
          filter: { type: 'object', description: '组织层级筛选: {l3: "华东大区", store: "xxx"}' },
          include_fields: { type: 'array', items: { type: 'string' }, description: '返回字段列表' },
          page_size: { type: 'integer', description: '每页条数，默认 50' },
          page: { type: 'integer', description: '页码，默认 1' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 15000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const alertLevel = (args.alert_level || '').toLowerCase();
    const warnings = await queryEngine.getWarningsBoardData({
      taskId,
      regionScope,
      warningLevel: alertLevel
    });

    const rows = (warnings.list || []).map(w => ({
      user_id: w.emailId,
      name: w.learnerName,
      alert_level: args.alert_level,
      completion_status: '未完成',
      store: w.storeName,
      dealer: w.dealerName,
      l3: w.region,
      l4: w.format
    }));

    return {
      success: true,
      data: {
        task_id: taskId,
        alert_level: args.alert_level,
        total_count: warnings.pagination?.total || rows.length,
        page: args.page || 1,
        page_size: args.page_size || 50,
        rows
      }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_fetch_alert_persons.js
```

### Task C.8: 创建 tool_search_task.js

**Files:**
- Create: `TOT_backend/server/chat_tools/tool_search_task.js`

- [ ] **Step 1: 写工具文件**

```js
'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'search_task',
      description: '按条件搜索任务元数据。当用户想查找任务但不确定具体名称时使用。返回任务列表而非指标数据。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '模糊搜索任务名称关键字' },
          status: { type: 'string', enum: ['active', 'ended', 'all'], description: '过滤任务状态，默认 all' },
          time_range: { type: 'object', description: '{start, end} 或相对表达式' },
          platform: { type: 'string', enum: ['MyPAL', 'SmartSell', 'AI Demo', 'Live Broadcast'], description: '平台过滤' },
          sort_by: { type: 'string', enum: ['deadline', 'completion_rate', 'priority', 'created_at'], description: '排序字段' },
          page_size: { type: 'integer', description: '每页条数，默认 20' },
          page: { type: 'integer', description: '页码，默认 1' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'public',
    timeoutMs: 8000
  },
  handler: async (args, regionScope) => {
    const tasks = await taskCrud.getTaskList({
      statuses: args.status === 'ended' ? ['ended'] : args.status === 'active' ? ['active'] : ['active', 'ended'],
      limit: args.page_size || 20,
      offset: ((args.page || 1) - 1) * (args.page_size || 20)
    });

    let rows = tasks.map(t => ({
      task_id: t.id,
      task_name: t.name,
      platform: t.platform,
      priority: t.priority,
      status: t.status,
      start_date: t.start_at,
      deadline: t.ddl_at,
      completion_rate: t.completionRate,
      learning_count: t.learningCount
    }));

    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      rows = rows.filter(r => r.task_name.toLowerCase().includes(kw));
    }

    if (args.platform) {
      rows = rows.filter(r => r.platform === args.platform);
    }

    return {
      success: true,
      data: { total_count: rows.length, rows }
    };
  }
};
```

- [ ] **Step 2: 运行 node --check**

```bash
cd TOT_backend/server && node --check chat_tools/tool_search_task.js
```

### Task C.9: 删除旧工具文件

- [ ] **Step 1: 删除旧 10 个工具文件**

```bash
rm TOT_backend/server/chat_tools/tool_executeCode.js
rm TOT_backend/server/chat_tools/tool_fetchRawDataset.js
rm TOT_backend/server/chat_tools/tool_getDrillDownMetrics.js
rm TOT_backend/server/chat_tools/tool_getProgressMetrics.js
rm TOT_backend/server/chat_tools/tool_getProjectStatus.js
rm TOT_backend/server/chat_tools/tool_getRegionDetailData.js
rm TOT_backend/server/chat_tools/tool_getWarnings.js
rm TOT_backend/server/chat_tools/tool_queryExecutiveMetrics.js
rm TOT_backend/server/chat_tools/tool_runAnalytics.js
rm TOT_backend/server/chat_tools/tool_searchEntities.js
```

- [ ] **Step 2: 提交 Phase C**

```bash
git add TOT_backend/server/chat_tools/
git commit -m "feat: implement V0.3 tool spec (8 tools), remove old 10 tools"
```

---

## Phase D: 统一与集成

### Task D.1: 更新 graph.js — 工具与 FC 循环对接

**Files:**
- Modify: `TOT_backend/server/agent/graph/graph.js`

确认 `buildGraph` 中的 FC 节点可以正确加载新工具（通过 `chatToolsService` 自动扫描 `chat_tools/` 目录）。

- [ ] **Step 1: 验证新工具被 chatToolsService 自动加载**

```bash
cd TOT_backend/server && node -e "
const chatToolsService = require('./services/chatToolsService');
const names = chatToolsService.getRegisteredToolNames();
console.log('注册工具:', names);
console.log('工具数量:', names.length);
"
```

Expected: 8 个工具 `['get_task_dashboard', 'list_task_progress', 'query_trend', 'query_metric', 'funnel_analysis', 'fetch_incomplete_persons', 'fetch_alert_persons', 'search_task']`

- [ ] **Step 2: 确认 graph.js 不需要改**

当前的 graph.js 通过 `fc_LlmToolCallStep` 的 `getLlmWithTools()` 动态拉取工具列表（Phase B.1 已修复），无需变更 graph.js 的节点注册。

### Task D.2: 更新 SafetyGateway prompt — 对齐新工具描述

**Files:**
- Modify: `TOT_backend/server/prompts/safetyGateway.js`

- [ ] **Step 1: 在 prompt 中更新实体提取规则**

在 SAFETY_GATEWAY_PROMPT 末尾添加：

```js
【工具能力范围】
本系统支持以下数据查询操作：
- 任务全景查询（指标、漏斗、预警）
- 任务进度列表（批量摘要、筛选排序）
- 趋势分析（时间序列）
- 指标对比（按维度下钻、Top/Bottom N 排名）
- 漏斗分析（任务完成漏斗、预警催办漏斗）
- 人员名单（未完成人员、预警人员）
- 任务搜索（按关键字、平台、时间范围）

判断 mode=tool 时，确认用户请求落在以上范围内。超出范围的（如数据修改、发送通知）标记 mode=deny。`;
```

- [ ] **Step 2: 提交 Phase D**

```bash
git add TOT_backend/server/prompts/safetyGateway.js
git commit -m "feat: update SafetyGateway prompt with V0.3 tool descriptions"
```

---

## Phase E: 清理旧代码

### Task E.1: 删除旧的 Agent 相关文件

**Files:**
- Delete: `TOT_backend/server/services/chatAgentRunner.js` (如存在)

dev 分支的 `chatAgentRunner.js` 是旧 Agent 执行器，本地已用 LangGraph SafetyGateway 替代。

- [ ] **Step 1: 确认文件存在并删除**

```bash
test -f TOT_backend/server/services/chatAgentRunner.js && rm TOT_backend/server/services/chatAgentRunner.js && echo "deleted" || echo "not found"
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "chore: remove old chatAgentRunner (replaced by LangGraph SafetyGateway)"
```

---

## Phase F: 端到端验证

### Task F.1: 创建 smoke test 脚本

**Files:**
- Create: `TOT_backend/server/scripts/test-tools-smoke.sh`

- [ ] **Step 1: 写 smoke test 脚本**

```bash
#!/bin/bash
# Smoke test: 验证 8 个 V0.3 工具能正确加载并调用 service 层

set -e
cd "$(dirname "$0")/.."

echo "=== 1. 工具加载验证 ==="
node -e "
const srv = require('./services/chatToolsService');
const names = srv.getRegisteredToolNames();
console.log('注册工具数:', names.length);
console.log('工具列表:', names.join(', '));
if (names.length !== 8) { console.error('ERROR: expected 8 tools'); process.exit(1); }
console.log('OK');
"

echo ""
echo "=== 2. 工具 Schema 验证 ==="
for name in get_task_dashboard list_task_progress query_trend query_metric funnel_analysis fetch_incomplete_persons fetch_alert_persons search_task; do
  node -e "
const srv = require('./services/chatToolsService');
const schema = srv.getToolSchema('${name}');
if (!schema) { console.error('ERROR: ${name} schema not found'); process.exit(1); }
if (!schema.function.parameters) { console.error('ERROR: ${name} schema missing parameters'); process.exit(1); }
console.log('${name}: schema OK');
"
done

echo ""
echo "=== 3. 工具 Meta 验证 ==="
for name in get_task_dashboard list_task_progress query_trend query_metric funnel_analysis fetch_incomplete_persons fetch_alert_persons search_task; do
  node -e "
const srv = require('./services/chatToolsService');
const meta = srv.getToolMeta('${name}');
if (!meta) { console.error('ERROR: ${name} meta not found'); process.exit(1); }
if (!meta.scopePolicy) { console.error('ERROR: ${name} missing scopePolicy'); process.exit(1); }
if (!meta.requiredRole || meta.requiredRole.length === 0) { console.error('ERROR: ${name} missing requiredRole'); process.exit(1); }
console.log('${name}: meta OK (scopePolicy=${meta.scopePolicy}, roles=[${meta.requiredRole.join(\",\")}])');
"
done

echo ""
echo "=== 4. Graph 编译验证 ==="
node -e "
const { buildGraph } = require('./agent/graph/graph');
const { MemorySaver } = require('@langchain/langgraph');
const graph = buildGraph();
const app = graph.compile({ checkpointer: new MemorySaver() });
console.log('Graph compiled OK');
process.exit(0);
"

echo ""
echo "=== ALL CHECKS PASSED ==="
```

- [ ] **Step 2: 执行 smoke test**

```bash
chmod +x TOT_backend/server/scripts/test-tools-smoke.sh
cd TOT_backend/server && bash scripts/test-tools-smoke.sh
```

Expected: ALL CHECKS PASSED

- [ ] **Step 3: 提交**

```bash
git add TOT_backend/server/scripts/test-tools-smoke.sh
git commit -m "test: add tool layer smoke test"
```

---

## 不改的文件

- `TOT_backend/server/agent/graph/nodes/` (除 `fc_LlmToolCallStep.js:16` 外)
- `TOT_backend/server/agent/graph/state.js`
- `TOT_backend/server/agent/graph/graph.js` (节点注册不动)
- `TOT_backend/server/agent/graph/shared/`
- `TOT_backend/server/agent/graph/__tests__/`
- `TOT_backend/server/modules/` (合并后不动)
- `TOT_backend/server/services/chatToolsService.js` (自动扫描，无需改动)
- `TOT_backend/server/services/autoNudge.js` (本地新增，保留)
- `TOT_backend/server/services/dashboardAgentService.js` (本地新增，保留)
- `TOT_backend/server/services/taskSmartPublishService.js` (本地新增，保留)
