# 看板指标规格

**版本:** 1.5.5 | **PRD §5.3、§6.6、附录 F** | **更新日期:** 2026-04-30

---

## 产品与工程对齐

- **PRD：** 总部看板北极星指标（整体完成率、人均完成时间）、按时完成率、RTM L4 差异、链路（触达/读取/转化）、预警（起步异常、deadline 危机等）见 **§5.3、§6.6**；工程形态见 **附录 F**。
- **实现：** `server/routes/dashboard.js` 实时从 `task_assignments` / `tasks` / `stores` / `notification_events` / `read_receipts` 聚合，**无独立 KPI 缓存表**；`completionRate` / `avgProgress` 等与 API 一致为 **整数 0–100（百分比点数）**。
- **接口契约（请求/响应字段）：** 以 **`04-API-SPEC.md` 第 5 章**（`/dashboard/*`）为准；本节描述**口径与计算逻辑**，便于评审与对账。

---

## 路由与角色（与 `dashboard.js` 一致）

| 方法 | 路径 | 角色 |
|------|------|------|
| GET | `/api/v1/dashboard/overview` | `central` · `executive` · `admin` |
| GET | `/api/v1/dashboard/heatmap` | `central` · `executive` · `admin` |
| GET | `/api/v1/dashboard/store-rank` | `central` · `executive` · `admin` |
| GET | `/api/v1/dashboard/trend` | `central` · `executive` · `admin` |
| GET | `/api/v1/dashboard/warnings` | **`central` · `admin` 仅**（不含 `executive`） |
| GET | `/api/v1/dashboard/store-detail` | **`central` · `admin` 仅** |

统一响应包装：`{ code, message, data, requestId }`。

---

## 筛选维度（overview / 部分聚合）

`GET /dashboard/overview` 支持查询参数 **`taskId`**、**`rtm`**、**`format`**（均可选，组合为对 `task_assignments` + `JOIN stores` 的过滤）。**另支持可选 `platform`**（任务合集平台颗粒度）：与 **`04-API-SPEC` §5.0** 一致，影响完成/已读等 KPI 口径。未传 `taskId` 时，推送/已读等依赖 `notification_events.task_id` 的统计在实现中会按「全任务或 1=1」条件聚合（与 `04-API-SPEC` 说明一致）。

---

## 落队等级（个人 / 门店下钻）

**Assignment 个人进度（与 `store-detail` 中 `lagLevel` 一致）：**

| 等级 | 条件 | API 值 |
|------|------|--------|
| 快完成 | `progress >= 80` | `fast` |
| 中等 | `50 <= progress < 80` | `medium` |
| 严重落队 | `progress < 50` | `behind` |

**门店预警计数（概览 `warningCount`、预警列表分级）：**

实现侧按 **门店 + 任务** 聚合后，与 **`services/autoNudge.js` 临期（`deadlineCrisis`）规则一致**：

- 读取该任务 `tasks.auto_nudge_rules` 中的 **`deadlineCrisis.p0` / `p1`**（缺省与自动预警相同：**24** / **48** 小时）；若任务**未配置** `deadlineCrisis`，则**不计**临期预警（与自动扫描不触发临期一致）。
- 剩余小时与自动预警相同：`(new Date(ddl_at) - Date.now()) / 3600000`；**`hoursLeft <= 0`（已过期）不计**入 P0/P1 临期档。
- 仍有未完成人数时：`hoursLeft <= p0` → **P0**；否则 `hoursLeft <= p1` → **P1**（黄）。

（用于 `overview.data.warningCount.p1` / `p0`；与 `services/autoNudgeRules.js` 中 `classifyDeadlineCrisisBand` 同源。）

**热力图色值：** `GET /heatmap` 返回 **`color` 为十六进制**（如 `#4CAF50` / `#FF9900` / `#F44336`），非 `red/yellow/green` 枚举字符串。

---

## KPI 与概览字段（`GET /dashboard/overview`）

### 规模与进度

- **totalAssignments：** 范围内 assignment 总数。
- **completedCount / completionRate：** 未传 **`platform`** 时「完成」以 **`status = 'completed'`** 为准；传 **`platform`** 时以对应 **`_*_completed = 1`** 为准（见 **`04-API-SPEC` §5.0**）。`completionRate = ROUND(100 * completed / total)`，total=0 时为 0。
- **onTimeCompletionRate：** 在 **`completedCond`** 为真的 assignment 中，**`completed_at <= ddl_at`** 的数量 / **total**（整数百分比；**传 `platform`** 时 **`completedCond`** 为对应 **`_*_completed = 1`**，仍用 **`ta.completed_at`** 与 **`ddl_at`** 比较，与 **`dashboard.js`** 一致）。
- **avgCompletionTimeHours：** 已完成 assignment 的 `(completed_at - task.created_at)` 小时均值（实现为 SQLite `julianday` 差 ×24，保留一位小数）。**传 `platform`** 时「已完成」子集与 **`_*_completed`** 一致。
- **inProgressCount / pendingCount / overdueCount：** 状态中人数；**逾期** = 未「完成」且当前时间晚于 `tasks.ddl_at`；**传 `platform`** 时「完成」见 **§5.0**。

### 链路（通知与已读）

- **pushUserCount：** `notification_events` 中 `event_type = 'task_assigned'` 的 **去重 `target_user_id`**（带 `taskId` 时按任务过滤）。
- **employeeReadCount / managerReadCount：** **未传 `platform`** 时仅统计 **`read_receipts.source = 'task_detail_open'`**（精确匹配，与未带 **`platform`** 的 **`POST /assignments/:id/viewed`** 一致）。**传 `platform`** 时为 **`source = task_detail_open:{平台标签}`**（见 **`04-API-SPEC` §5.0**）。**`managerReadCount`** 当前实现与 **`employeeReadCount`** 同值，**`totalReadCount`** 取 **`employeeReadCount`**（避免重复相加）。
- **taskReachRate：** **未传 `platform`**：成功触达 assignment 数 / total ×100；单条计为已触达当 **`u.last_login_at >= ta.created_at`** 或 **`ta.received_at IS NOT NULL`**（见 `04-API-SPEC` v1.4.23）。**传 `platform`**：在上述范围内再要求存在 **`read_receipts`**（**`source = task_detail_open:{标签}`**）对该 assignment 的 **`task_assigned`** 事件已读（**EXISTS** 子查询，见 **`dashboard.js`**）。
- **taskReadRate：** `totalReadCount / totalAssignments * 100`（一位小数）。
- **nudgeConversionRate：** 在 **`nudge_count > 0`** 的 assignment 中，已 **`started_at` 非空或状态为 `completed`** 的比例（整数百分比）；与 PRD「提醒转化率」命名可能不完全一致，以 **`04-API-SPEC`** 字段名为准。

### 预警率（与 `evaluateAndTriggerAutoNudges` / `GET /dashboard/warnings` 规则一致）

在筛选范围内对每条 **`task_assignments`**（带 `tasks.created_at` / `ddl_at` / `auto_nudge_rules`）实时判定，**按 assignment 计数**，再除以 **totalAssignments** 得到 **startDelayRate、crisisP1Rate、crisisP0Rate**（百分比点数，一位小数）。**不再**用 `notification_events` 事件条数作分子（与下钻门店 `warningRate` 为同一套公式，概览为全任务汇总）。口径简述：

- **startDelayRate**：时间进度占比 ≥ `startDelay` 阈值，且未完成且 `progress=0` 的 assignment 数 / 总人数。
- **crisisP1Rate**：任务处于 P1 临期带时，**未完成** assignment 数 / 总人数。
- **crisisP0Rate**：任务处于 P0 临期带时，**未完成** assignment 数 / 总人数。

三项可分别独立计数，同一 assignment 可能同时计入起步与临期（与自动预警落库时「每人只发一条」不同）。Dashboard 展示顺序仍为：起步异常 → 48h 临期（P1）→ 24h 临期（P0）。

### 其他

- **warningCount：** `{ p1, p0 }`，见上文「门店预警计数」规则按店聚合后计数。
- **updatedAt：** 范围内 **`MAX(task_assignments.updated_at)`**，无数据时为当前时间。

---

## 整体完成率（SQL 参考）

与实现一致的核心聚合：

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 0) AS completion_rate
FROM task_assignments
WHERE task_id = :taskId;
```

`total = 0` 时 API 侧返回 completionRate=0。

---

## 门店维度聚合（参考 SQL）

下钻、热力图、排行等均基于 `task_assignments` JOIN `stores` JOIN `tasks` 按 `store_id` 或 RTM/区域/业态分组；**经销商维度**（`dealer_name`）当前 **无独立 HTTP 端点**，若产品需要可在此 SQL 上增加报表或后续接口。

---

## `GET /dashboard/heatmap`

- **必填：** `taskId`。
- **rtmLevel：** `rtm` | `region` | `format` | `subRtm`（映射到 `stores` 对应列分组）。
- 每组返回：`rtmValue`、`completionRate`、`color`（hex）、`assignmentCount`、`completedCount`、`avgCompletionTimeHours` 等（见 `04-API-SPEC`）。

---

## `GET /dashboard/store-rank`

- **必填：** `taskId`、`type`（`top` | `bottom`）。
- **limit：** 默认 5，最大 50。
- **format：** 可选，按门店业态过滤。
- **Bottom：** SQL `HAVING completion_rate < 100`；排序 `completion_rate ASC`，并列时 `avg_progress`、`store_id` 稳定排序。

---

## `GET /dashboard/warnings`

- **角色：** 仅 `central` / `admin`。
- **分页：** `pageNum` / `pageSize`。
- **聚合维度 (`level`)：** `store`（默认）| `rtm` | `format` | `dealer`。支持按不同业务维度汇总预警数据。
- **taskId：** 可选；**warningLevel：** `p1` | `p0` | `startDelay`。
- 列表项含：`taskId`、`targetId`、`targetName`、`targetType`、`warningLevel`、`completionRate`、`warningRate`、`triggerDesc` 等。

---

## `GET /dashboard/store-detail`

- **角色：** 仅 `central` / `admin`。
- **必填查询参数：** `taskId`、`storeId`。
- **员工行：** `lagLevel`（`fast`/`medium`/`behind`）、`platformStatus`（四平台布尔）、`nudgeCount` 等（见 `04-API-SPEC` §5.6）。

---

## `GET /dashboard/trend`

- **必填：** `taskId`。
- **type：** `daily`（按 `date(completed_at)` 汇总新增完成）| `hourly`（需 **`date`**，默认当天 UTC 日期切片）。
- 返回 `trendData`：`timeKey`、`newCompleted`、`cumulativeCompleted`。

---

## 完成趋势 SQL（参考）

与 `type=hourly` 类似：

```sql
SELECT strftime('%H', completed_at) AS time_key, COUNT(*) AS new_completed
FROM task_assignments
WHERE task_id = :taskId AND status = 'completed' AND completed_at IS NOT NULL
  AND date(completed_at) = :date
GROUP BY strftime('%H', completed_at)
ORDER BY strftime('%H', completed_at) ASC;
```

---

## 看板「数据更新时间」

`overview` / `heatmap` / `store-rank` / `store-detail` 等响应中的 **`updatedAt`**（或各接口约定字段）用于顶部「数据截至 …」展示；语义以 **`04-API-SPEC`** 为准（多为 `MAX(updated_at)` 或请求时时间）。

---

## API 路径对照（规格命名 → 实现）

| 历史/口头路径 | 当前实现 |
|--------------|----------|
| `GET /dashboard/summary` | `GET /api/v1/dashboard/overview` |
| `GET /dashboard/top-bottom` | `GET /api/v1/dashboard/store-rank` |
| `GET /dashboard/alerts` | `GET /api/v1/dashboard/warnings` |
| — | `GET /api/v1/dashboard/trend`（新增） |

导出类接口若为 **P1**，见 `04-API-SPEC` 中 **`/dashboard/reports/export`** 说明。

---

## 文档维护

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.5.0 | 2026-04-16 | **预警列表多维度下钻**：`/dashboard/warnings` 新增 `level` 参数，支持按 `rtm`、`format`、`dealer` 聚合展示；响应增加 `targetId`/`targetName`/`targetType` 统一字段。同时更新 `seed.js` 以自动生成各预警带的模拟数据。 |
| 1.4.0 | 2026-04-14 | **临期预警与 autoNudge 一致**：`warningCount` / `/warnings` 使用 `auto_nudge_rules.deadlineCrisis`（默认 24h/48h 可配置），与 `services/autoNudgeRules.js` / `autoNudge.js` 同源；未配置 `deadlineCrisis` 不计临期；已过期不计临期档。概览按门店+任务聚合。 |
| 1.3.0 | 2026-04-09 | 与 `routes/dashboard.js`、PRD §5.3/§6.6 对齐：角色矩阵、`overview` 扩展 KPI、`/trend`、预警/热力图口径、移除过时 Day2 待办表述 |
| 1.2.1 | 2026-03-28 | Day5 初版对齐 |
