# A — Dashboard 看板模块 技术审计

> 日期：2026-05-13 | 分支：modular-dashboard | 审查范围：`modules/dashboard/` + 相关 `modules/common/`

---

## 1. 目录结构总览

```
modules/dashboard/
├── crud/
│   └── dashboardCrud.js              # 9函数，纯聚合查询，用新表名 ✅
├── services/
│   ├── queryEngine.js                # 1220行，~40处旧表SQL ❌
│   ├── insightService.js             # 763行，~16处旧表SQL + db.run崩溃bug ❌
│   ├── executiveMetricsService.js    # 241行，~5处旧表SQL ❌
│   └── analyzers/
│       ├── funnelAnalyzer.js         # 65行 ✅ 调queryEngine，零SQL
│       ├── trendAnalyzer.js          # 92行 ✅ 同上
│       ├── warningAnalyzer.js        # 131行 ✅ 同上
│       ├── rtmAnalyzer.js            # 106行 ✅ 同上
│       ├── runRegionAnalyzers.js     # 105行 ✅ 并发编排，零SQL
│       ├── shared.js                 # 144行 ✅ 纯工具
│       └── promptTemplates.js        # 96行 ✅ 纯模板
├── routes/
│   ├── dashboardRoutes.js            # 70行 ✅ 零SQL，调queryEngine
│   └── insightRoutes.js              # 24行 ✅ 零SQL，调insightService
```

### 行数统计

| 文件 | 行数 | 状态 |
|------|------|------|
| dashboardCrud.js | 210 | 规范，需扩展 |
| queryEngine.js | 1220 | **超800行上限，SQL未提取** |
| insightService.js | 763 | 接近上限，SQL未提取，有bug |
| executiveMetricsService.js | 241 | SQL未提取 |
| analyzers/ (7文件) | 739 | 规范 |
| routes/ (2文件) | 94 | 规范 |
| **合计** | **~3267** | |

---

## 2. 三层架构合规检查

### 2.1 Route 层

| 文件 | SQL数量 | 调Service | 参数校验 | 统一响应 |
|------|---------|-----------|----------|----------|
| dashboardRoutes.js | 0 | queryEngine | 无 | 手动 `{code, message, data}` |
| insightRoutes.js | 0 | insightService | 无 | 手动 (createInsight走SSE) |

**结论**：Route 层符合"零SQL"规则，但缺少参数校验，未用 responseHelper。

### 2.2 Service 层

| 文件 | SQL数量 | 调用链 | 表名 |
|------|---------|--------|------|
| queryEngine.js | **~40** | 直接 `db.get/all(sql)` | 旧表名 |
| insightService.js | **~16** | 直接 `db.get/all(sql)` | 旧表名 |
| executiveMetricsService.js | **~5** | 直接 `db.get/all(sql)` | 旧表名 |
| analyzers/* | 0 | 调 queryEngine 导出函数 | — |

**结论**：Service 层严重违反"零SQL"规则。三个核心文件的 SQL 全部物理嵌入，未提取到 crud。同时使用旧表名，与 dashboardCrud.js 的新表名并存。

### 2.3 Crud 层

**dashboardCrud.js 现有 9 个函数（全部用新表名）：**

| 函数 | SQL表 | 说明 |
|------|-------|------|
| `getOverviewMetrics` | learner_task_queue, task_publish, reseller_store | JOIN 3表 |
| `getTrendData` | 同上 | 按维度分组 |
| `getWarningData` | 同上 | HAVING incomplete_rate > threshold |
| `getHeatmapData` | 同上 | 多维度支持 |
| `getFunnelData` | learner_task_queue | 单表聚合 |
| `getReminderStats` | learner_task_reminder, task_publish | 催办分组统计 |
| `getReminderLogList` | task_reminder_log, task_publish, reseller_store | 催办日志+关联 |
| `getExecutiveMetrics` | learner_task_queue, task_publish, reseller_store | 多维度高管指标 |
| `getStoreDrillData` | learner_task_queue, task_publish, learner_account | 门店下钻 |

---

## 3. 关键问题清单

### 3.1 CRITICAL（阻断运行）

**C1 — insightService.js: `db.run` 未定义**

文件第12-15行 `db` 只定义了 `get`/`all`，但第605、731、733、739、741行调用了不存在的 `db.run()` → TypeError 崩溃。影响 `createInsight` 和 `recordVote` 全部功能。

**C2 — queryEngine.js 全部使用旧表名**

| queryEngine 使用（旧） | dashboardCrud 使用（新） | 计划要求 |
|---|---|---|
| `task_assignments` | `learner_task_queue` | learner_task_queue |
| `tasks` | `task_publish` | task_publish |
| `stores` | `reseller_store` | reseller_store |
| `users` | — | account |
| `employees` | `learner_account` | learner_account |
| `notification_events` | `learner_task_reminder` | learner_task_reminder |
| `read_receipts` | `task_reminder_log` | task_reminder_log |

**C3 — insightService.js 全部使用旧表名**（同 C2）

### 3.2 HIGH（架构违规）

**H1 — queryEngine.js 超行数**：1220行，应 ≤800行

**H2 — db 访问模式不一致**（3种写法）：
- dashboardCrud.js：`getDb().prepare(sql).get(params)` 
- queryEngine/insightService/executiveMetrics：包装 `db = {get, all}`
- auditCrud.js：`var getDb` + `.apply()` 传参

**H3 — `executiveMetricsService.js` 假 async**：函数声明 `async` 但内部全是同步 `db.all()`（better-sqlite3 是同步的）

**H4 — dashboardCrud.js 覆盖不全**：缺少 queryEngine 需要的 ~40 个查询

### 3.3 MEDIUM（应关注）

**M1 — `dashboardWarningRates.js` 引用旧路径**
```
require('../../../services/autoNudgeRules')
// 应改为
require('../../task-publish/services/reminderService')
```

**M2 — `executiveMetricsService.js` 硬编码 task alias**
```
{ keys: ['phone', 'iphone', '17'], id: 'TASK_A' }  // 应走配置或字典表
```

**M3 — Route 层零参数校验**：`req.query` 直接透传给 service

**M4 — responseHelper 定义了但未用**：route 中手动构造 `{code, message, data}`

### 3.4 LOW（代码风格）

**L1 — dashboardCrud.js 使用 `var`**：L88, L126, L162, L168, L189 等，应改为 `const`

**L2 — heatmapColor 函数内联在 queryEngine**：应提取到 shared 或 utils

---

## 4. 跨模块依赖

### 4.1 A 对 B（task-publish）的依赖

A 对 B 有两类依赖：

**数据依赖**（dashboardCrud.js 自行 JOIN B 的表，未调 B 的 crud）：
- 查询 `learner_task_queue`、`task_publish`、`learner_task_reminder`、`task_reminder_log`

**函数依赖**（需修复的 3处跨模块引用）：
```
queryEngine.js:22              → ../../../services/autoNudgeRules
executiveMetricsService.js:6   → ../../../services/autoNudgeRules
dashboardWarningRates.js:3      → ../../../services/autoNudgeRules

正确路径应为：../../task-publish/services/reminderService
（B 已在 modular-task 分支完成迁移，导出：
 parseAutoNudgeRules, getDeadlineCrisisHours, classifyDeadlineCrisisBand）
```

### 4.2 A 对 C（admin）的依赖

dashboardCrud.js 自行 JOIN C 的表（`reseller_store`、`learner_account`），未调 C 的 crud。

### 4.3 依赖关系图

```
┌──────────────────┐
│   A: Dashboard   │
│                  │
│ dashboardCrud ───┼──── 直接JOIN B的表 (learner_task_queue, task_publish...)
│                  │     直接JOIN C的表 (reseller_store, learner_account...)
│ queryEngine ─────┼──── 旧SQL直接访问所有表 ❌
│ insightService ──┼──── 旧SQL直接访问所有表 ❌
│                  │
│ analyzers ───────┼──── 调queryEngine导出函数（纯数据，零SQL）
│ routes ──────────┼──── 调service，零SQL ✅
└──────────────────┘
        │
   引用B的纯函数 ──── parseAutoNudgeRules
                     classifyDeadlineCrisisBand
                     getDeadlineCrisisHours
        │            (目前引用旧路径 ❌)
```

---

## 5. SQL 清单

### 5.1 queryEngine.js（~40处SQL，9个导出函数）

| 函数 | SQL数 | 涉及旧表 |
|------|-------|----------|
| `getOverviewBoardData` | 7 | task_assignments, tasks, stores, notification_events, read_receipts, users |
| `getFunnelBoardData` | 3 | task_assignments, tasks, stores, notification_events |
| `getAlertFunnelData` | 1 | tasks |
| `getAlertDrillDownData` | 2 | task_assignments, stores, tasks |
| `getHeatmapBoardData` | 1 | task_assignments, stores, tasks |
| `getTrendBoardData` | 2 | task_assignments, stores, tasks |
| `getUnifiedAlertsBoardData` | — | 间接调用其他函数 |
| `getWarningsBoardData` | 2 | task_assignments, stores, tasks, notification_events |
| `getNudgeConversionBoardData` | 2 | notification_events, stores, task_assignments |

内部 helper：`queryBaseAgg`(1SQL)、`queryPushUserCount`(2SQL)、`queryNudgeSeverityCounts`(1SQL)

### 5.2 insightService.js（~16处SQL，8个数据函数 + 投票）

| 函数 | SQL数 | 涉及旧表 |
|------|-------|----------|
| `buildNorthStarFacts` | 2 | task_assignments, tasks, stores |
| `buildFunnelFacts` | 4 | task_assignments, tasks, stores, users, notification_events, read_receipts |
| `buildWeeklyCompletionFacts` | 3 | task_assignments, stores |
| `buildDailyCompletionFacts` | 3 | task_assignments, stores |
| `buildHeatmapRankFacts` | 3 | task_assignments, stores, tasks |
| `buildWarningStatsFacts` | 1 | task_assignments, stores, tasks |
| `buildChannelNorthStarFacts` | 1 | task_assignments, stores, tasks |
| `persistInsightRecord` | 1 (INSERT) | dashboard_insights |
| `recordVote` | 4 (UPDATE/SELECT) | dashboard_insights |

---

## 6. 修复路径

### 第一步：紧急修复（~15分钟，零依赖）

```
A1. insightService.js    — db 对象补充 run 方法
A2. dashboardCrud.js     — var → const（~10处）
A3. auditCrud.js         — var → const + 展开运算符
```

### 第二步：修复跨模块引用（B 已完成 ✅，~10分钟）

```
A4. queryEngine.js:22              — 路径改为 ../../task-publish/services/reminderService
A5. executiveMetricsService.js:6    — 同上
A6. dashboardWarningRates.js:3      — 同上
```

### 第三步：SQL 提取（核心，~6小时）

```
A7.  dashboardCrud.js        — 补充 ~60 个查询函数，使用新表名
A8.  queryEngine.js          — 所有 db.get/all → 调 dashboardCrud
A9.  insightService.js       — 所有 db.get/all/run → 调 dashboardCrud
A10. executiveMetricsService — 所有 db.get/all → 调 dashboardCrud
A11. executiveMetricsService — 去掉假 async
```

### 第四步：规范化（~2小时）

```
A12. dashboardRoutes.js — 补充必填参数校验
A13. insightRoutes.js   — 同上
A14. 统一使用 responseHelper
A15. executiveMetricsService — 硬编码 alias 移到配置
```

---

## 7. dashboardCrud.js 扩展预估

当前 210 行，需补充 ~60 个函数，预估增量 ~400 行，到达 ~600 行。

若超 800 行限制，按域拆分：
```
dashboardCrud.js         # 基础聚合：概览、趋势、热力图、漏斗
dashboardAlertCrud.js    # 预警/催办聚合：warnings、nudge、crisis
dashboardInsightCrud.js  # 洞察数据：facts查询、投票、持久化
```

---

## 8. 与旧代码的对照

| 旧文件 | 行数 | 新文件 | 状态 |
|--------|------|--------|------|
| services/dashboardQueryCore.js | 1208 | queryEngine.js | ⚠️ 移动但未去SQL |
| services/dashboardInsightService.js | 759 | insightService.js | ⚠️ 移动但未去SQL + bug |
| services/executiveMetricsQueryService.js | 235 | executiveMetricsService.js | ⚠️ 移动但未去SQL |
| services/dashboardSubAgents/* | 762 | analyzers/* | ✅ 原样移动，正确 |
| routes/dashboard.js | 90 | dashboardRoutes.js | ✅ 重写，正确 |
| routes/dashboardInsights.js | 45 | insightRoutes.js | ✅ 重写，正确 |
