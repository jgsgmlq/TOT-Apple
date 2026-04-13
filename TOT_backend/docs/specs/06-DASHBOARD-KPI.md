# 看板指标规格

**版本:** 1.3.0 | **PRD §5.3、§6.6、附录 F** | **更新日期:** 2026-04-09

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

`GET /dashboard/overview` 支持查询参数 **`taskId`**、**`rtm`**、**`format`**（均可选，组合为对 `task_assignments` + `JOIN stores` 的过滤）。未传 `taskId` 时，推送/已读等依赖 `notification_events.task_id` 的统计在实现中会按「全任务或 1=1」条件聚合（与 `04-API-SPEC` 说明一致）。

---

## 落队等级（个人 / 门店下钻）

**Assignment 个人进度（与 `store-detail` 中 `lagLevel` 一致）：**

| 等级 | 条件 | API 值 |
|------|------|--------|
| 快完成 | `progress >= 80` | `fast` |
| 中等 | `50 <= progress < 80` | `medium` |
| 严重落队 | `progress < 50` | `behind` |

**门店完成率（概览 `warningCount`、预警列表分级）：**

实现侧对「门店维度」完成率 `completion_rate`（0–100 整数）：

- **P1 计数：** `completion_rate < 50`，**或**（`completion_rate < 80` **且** 距该任务 `ddl_at` 不足 24 小时）。
- **P2 计数：** 不满足 P1，且 `completion_rate < 80`。

（用于 `overview.data.warningCount.p1` / `p2`。）

**热力图色值：** `GET /heatmap` 返回 **`color` 为十六进制**（如 `#4CAF50` / `#FF9900` / `#F44336`），非 `red/yellow/green` 枚举字符串。

---

## KPI 与概览字段（`GET /dashboard/overview`）

### 规模与进度

- **totalAssignments：** 范围内 assignment 总数。
- **completedCount / completionRate：** 完成数；`completionRate = ROUND(100 * completed / total)`，total=0 时为 0。
- **onTimeCompletionRate：** `completed_at <= ddl_at` 的完成数 / total（整数百分比）。
- **avgCompletionTimeHours：** 已完成 assignment 的 `(completed_at - task.created_at)` 小时均值（实现为 SQLite `julianday` 差 ×24，保留一位小数）。
- **inProgressCount / pendingCount / overdueCount：** 状态中人数；**逾期** = 未完成且当前时间晚于 `tasks.ddl_at`。

### 链路（通知与已读）

- **pushUserCount：** `notification_events` 中 `event_type = 'task_assigned'` 的 **去重 `target_user_id`**（带 `taskId` 时按任务过滤）。
- **employeeReadCount / managerReadCount：** 实现上对 **`read_receipts.source = 'task_detail_open'`** 去重统计；当前两条 SQL 结构相同，一般 **`totalReadCount = employeeReadCount + managerReadCount`**（若产品需区分店长/店员，应后续在数据模型中区分用户类型后再拆口径）。
- **taskReachRate：** 实现中通过 `u.last_login_at >= ta.created_at`、`ta.received_at IS NOT NULL` 或者 websocket 接收等联合判断，占位为成功触达数 / total * 100（百分比点数，一位小数）。
- **taskReadRate：** `totalReadCount / totalAssignments * 100`（一位小数）。
- **nudgeConversionRate：** 在 **`nudge_count > 0`** 的 assignment 中，已 **`started_at` 非空或状态为 `completed`** 的比例（整数百分比）；与 PRD「提醒转化率」命名可能不完全一致，以 **`04-API-SPEC`** 字段名为准。

### 预警率（基于自动预警事件 `dedupe_key`）

对范围内 `notification_events` 与 assignment 关联行，按 **`dedupe_key` 子串** 粗计 **`startDelay` / `deadlineCrisisP0` / `deadlineCrisisP1`** 命中次数，再除以 **totalAssignments** 得到 **startDelayRate、crisisP0Rate、crisisP1Rate**（百分比点数，一位小数）。规则与 `services/autoNudge.js` 写入的 `autonudge:…` 前缀一致。

### 其他

- **warningCount：** `{ p1, p2 }`，见上文「门店完成率」规则按店聚合后计数。
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
- **taskId：** 可选；**warningLevel：** `p1` | `p2`，按门店+任务聚合后的完成率区间过滤（与 overview 的 p1/p2 **分级口径不完全相同**：列表侧重「完成率区间」，见实现 `HAVING`）。
- 列表项含：`taskId`、`storeId`、`warningLevel`（`p1`/`p2`）、`completionRate`、`triggerDesc`、`aiSuggestion`（按完成率分段 Mock 文案）等。

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
| 1.2.1 | 2026-03-28 | Day5 初版对齐 |
| 1.3.0 | 2026-04-09 | 与 `routes/dashboard.js`、PRD §5.3/§6.6 对齐：角色矩阵、`overview` 扩展 KPI、`/trend`、预警/热力图口径、移除过时 Day2 待办表述 |
