# 看板指标规格

**版本:** 1.2.1 | **PRD §5.2, §6.7, §6.11, §6.12** | **更新日期:** 2026-03-28

---

## Day2 当前状态（联调边界）

- **Dev1 已完成：**
  - `tasks / assignments / stores / employees` 基础查询数据可用于看板聚合
  - Assignment 进度字段（`status`、`progress`、`updated_at`）可直接聚合
- **Dev2 待实现：**
  - 看板接口：`GET /dashboard/summary`、`GET /dashboard/heatmap`、`GET /dashboard/top-bottom`、`GET /dashboard/alerts`
  - 预警列表与建议文案输出
  - 与通知已读链路联动的 KPI（push/read/真实发放率）

> 接口路径与响应字段以 `04-API-SPEC.md` 第 5 章为主（P0 下钻见 **§5.6**）。

---

## Day5 实现状态（已完成）

| 接口 | 文件 | 说明 |
|------|------|------|
| `GET /api/v1/dashboard/overview` | `routes/dashboard.js` | ✅ 总完成率、在途/逾期数、KPI（push/read/发放率）、warningCount |
| `GET /api/v1/dashboard/heatmap` | `routes/dashboard.js` | ✅ 按门店/区域聚合，含 heatColor（red/yellow/green/gray）|
| `GET /api/v1/dashboard/store-rank` | `routes/dashboard.js` | ✅ Top5 + Bottom5 门店，支持 orderBy 参数 |
| `GET /api/v1/dashboard/warnings` | `routes/dashboard.js` | ✅ P1/P2 预警列表，含 aiSuggestion mock 文案 |
| `GET /api/v1/dashboard/store-detail` | `routes/dashboard.js` | ✅ 单门店下钻，含员工列表 + 落队等级 |

> 接口路径与响应字段以 `04-API-SPEC.md` 第 5 章为主。**单门店下钻的 HTTP 契约（查询参数、响应体、`lagLevel`）以 §5.6 为准。**

---

## 落队等级定义

基于 Assignment 维度（个人进度）：

| 等级 | 条件 | 颜色 |
|------|------|------|
| 快完成 | `progress >= 80` | 绿色 |
| 中等 | `50 <= progress < 80` | 黄色 |
| 严重落队 | `progress < 50` | 红色 |

基于门店维度（completionRate）：

| 预警级别 | 条件 | 说明 |
|---------|------|------|
| `normal` | completionRate >= 80% | 正常 |
| `yellow` | 50% ≤ completionRate < 80% | 黄色预警 |
| `red` | completionRate < 50% | 红色预警（覆盖黄色）|

**区域预警:** 按区域聚合门店预警，展示黄警区域数与红警区域数（红覆盖黄）

---

## KPI 定义与计算口径

### 推送人数

```sql
SELECT COUNT(DISTINCT target_user_id) AS push_count
FROM notification_events
WHERE task_id = :taskId
  AND event_type = 'task_assigned';
```

说明：系统成功写入并触发通知事件的用户数（去重到用户）

### 店员已读人数

```sql
SELECT COUNT(DISTINCT rr.user_id) AS employee_read_count
FROM read_receipts rr
JOIN notification_events ne ON rr.event_id = ne.id
WHERE ne.task_id = :taskId;
```

推荐口径（与通知规格一致）：仅统计 `rr.source='task_detail_open'` 的用户，避免“仅点铃铛未进入任务详情”带来的虚高。



### 任务真实发放率

```
任务真实发放率 = 打开任务详情人数（去重）/ 目标应发人数

打开任务详情人数 =
  SELECT COUNT(DISTINCT rr.user_id)
  FROM read_receipts rr
  JOIN notification_events ne ON rr.event_id = ne.id
  WHERE ne.task_id = :taskId
    AND rr.source = 'task_detail_open';

目标应发人数 =
  SELECT COUNT(*) FROM task_assignments WHERE task_id = :taskId;
```

**注意:** MVP 不做"送达"指标（无送达率 KPI）

---

## 整体完成率

> **口径说明:** `completion_rate` / `completionRate` 全系统统一为**整数百分比（0–100）**，SQL 使用 `ROUND(100.0 * completed / total, 0)`，API 响应字段同单位（如 `32` 表示 32%）。

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 0) AS completion_rate,
  ROUND(AVG(progress), 0) AS avg_progress
FROM task_assignments
WHERE task_id = :taskId;
```

若 `COUNT(*) = 0`，应用层返回：
- `completionRate = 0`
- `avgProgress = 0`
- `total = 0`
- `completed = 0`

---

## 门店维度聚合

```sql
SELECT
  s.id AS store_id,
  s.name AS store_name,
  s.region,
  s.dealer_name,
  COUNT(ta.id) AS total,
  SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
  ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completion_rate,
  ROUND(AVG(ta.progress), 0) AS avg_progress
FROM task_assignments ta
JOIN stores s ON ta.store_id = s.id
WHERE ta.task_id = :taskId
GROUP BY ta.store_id
ORDER BY completion_rate DESC;
```

**alertLevel 计算（应用层）:**

```javascript
function getAlertLevel(completionRate) {
  if (completionRate < 50) return 'red';
  if (completionRate < 80) return 'yellow';
  return 'normal';
}
```

---

## 经销商维度聚合

```sql
SELECT
  s.dealer_name,
  COUNT(ta.id) AS total,
  SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
  ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completion_rate,
  SUM(
    CASE WHEN ta.status != 'completed'
          AND datetime('now') > t.ddl_at
    THEN 1 ELSE 0 END
  ) AS overdue_count
FROM task_assignments ta
JOIN stores s ON ta.store_id = s.id
JOIN tasks t ON ta.task_id = t.id
WHERE ta.task_id = :taskId
  AND s.dealer_name IS NOT NULL
GROUP BY s.dealer_name
ORDER BY completion_rate DESC;
```

注意：`dealer_name IS NULL` 的门店不参与经销商榜单（避免“未知经销商”污染对比）。

---

## 地区维度聚合

```sql
SELECT
  s.region,
  COUNT(ta.id) AS total,
  SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
  ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completion_rate,
  ROUND(AVG(ta.progress), 0) AS avg_progress
FROM task_assignments ta
JOIN stores s ON ta.store_id = s.id
WHERE ta.task_id = :taskId
GROUP BY s.region
ORDER BY completion_rate DESC;
```

---

## Top / Bottom 5 门店

```sql
-- 使用 CTE 避免 store_summary 未定义的引用
WITH store_summary AS (
  SELECT
    s.id AS store_id,
    s.name AS store_name,
    COUNT(ta.id) AS total,
    SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
    ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completion_rate
  FROM task_assignments ta
  JOIN stores s ON ta.store_id = s.id
  WHERE ta.task_id = :taskId
  GROUP BY ta.store_id
)
-- Top 5（完成率最高）
SELECT store_id, store_name, completion_rate, completed, total
FROM store_summary
ORDER BY completion_rate DESC
LIMIT 5;

-- Bottom 5（完成率最低，排除已全部完成的门店）
WITH store_summary AS (
  SELECT
    s.id AS store_id,
    s.name AS store_name,
    COUNT(ta.id) AS total,
    SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
    ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completion_rate
  FROM task_assignments ta
  JOIN stores s ON ta.store_id = s.id
  WHERE ta.task_id = :taskId
  GROUP BY ta.store_id
)
SELECT store_id, store_name, completion_rate, completed, total
FROM store_summary
WHERE completion_rate < 100
ORDER BY completion_rate ASC
LIMIT 5;
```

Tie-break（并列排序）建议：
1) `completion_rate`  
2) `avg_progress`  
3) `store_id`（稳定排序）

---

## 预警列表（P0：仅展示，无操作界面）

**预警触发规则:**

| 预警级别 | 触发条件 |
|---------|---------|
| P1（红）| 门店 completionRate < 50%，**或** completionRate < 80% 且距 ddlAt 不足 24 小时 |
| P2（黄）| 50% ≤ 门店 completionRate < 80%（且不满足 P1 时间条件）|

> P1 时间条件：实现中以 `datetime('now') > datetime(t.ddl_at, '-24 hours')` 判断，P1 优先级高于 P2。

**预警列表响应结构:**

```json
[
  {
    "level": "P1",
    "storeId": "S005",
    "storeName": "北京中关村店",
    "region": "华北",
    "completionRate": 30,
    "avgProgress": 35,
    "triggerReason": "完成率低于 50%，距截止时间不足 48 小时",
    "aiSuggestion": "建议发起红色催办"
  }
]
```

**aiSuggestion:** MVP 使用 Mock 静态文案，按 completionRate 分段：
- < 30%: "情况紧急，建议立即电话跟进并发起红色催办"
- 30-49%: "建议发起红色催办"
- 50-79%: "建议通过系统发送黄色催办提醒"

---

## API 对齐（P0）

看板查询统一使用以下端点（详见 `04-API-SPEC.md` 第 5 章：**§5.1** 概览、**§5.2** 热力图、**§5.3** 门店排行、**§5.5** 预警、**§5.6** 门店员工下钻；**§5.4** 为导出 **P1**，P0 可忽略）。

| 规格路径（旧） | 实现路径（当前） | 说明 |
|--------------|----------------|------|
| `GET /dashboard/summary` | `GET /api/v1/dashboard/overview` | §5.1 总部看板概览（含 KPI + warningCount）|
| `GET /dashboard/heatmap` | `GET /api/v1/dashboard/heatmap` | §5.2 RTM/区域热力图 |
| `GET /dashboard/top-bottom` | `GET /api/v1/dashboard/store-rank` | §5.3 Top/Bottom 5 门店 |
| `GET /dashboard/alerts` | `GET /api/v1/dashboard/warnings` | §5.5 P1/P2 预警列表 |
| _(新增)_ | `GET /api/v1/dashboard/store-detail` | **§5.6** 单门店下钻（员工维度）|

统一要求：
- 响应 `completionRate` / `avgProgress` 为整数（0-100）
- 全部接口返回 `{ code, message, data, requestId }`
- central 可全量查询

---

## 完成趋势数据（看板折线图）

```sql
-- 按小时统计完成数量（用于趋势折线图）
SELECT
  strftime('%Y-%m-%dT%H:00:00Z', completed_at) AS hour_bucket,
  COUNT(*) AS completed_count
FROM task_assignments
WHERE task_id = :taskId
  AND status = 'completed'
  AND completed_at IS NOT NULL
GROUP BY hour_bucket
ORDER BY hour_bucket ASC;
```

---

## 看板更新时间显示

**要求:** 看板顶部显示最近更新时间，避免误判数据延迟。

```javascript
// 前端：每次获取 summary 数据后更新显示时间
function renderLastUpdated(updatedAt) {
  const time = new Date(updatedAt).toLocaleTimeString('zh-CN');
  document.getElementById('last-updated').textContent = `数据截至 ${time}`;
}
```

响应中的 `updatedAt` 字段 = 该任务最近一次 assignment 更新时间（`MAX(task_assignments.updated_at)`），由 `GET /api/v1/dashboard/overview` 的响应体携带。

---

## 个人维度（总部下钻）

按员工展示完整进度，见 `04-API-SPEC.md` **§5.6** `GET /api/v1/dashboard/store-detail`（总部下钻）。

个人落队等级显示：

```javascript
function getPersonalLagLevel(progress) {
  if (progress >= 80) return { level: 'fast', label: '快完成', color: 'green' };
  if (progress >= 50) return { level: 'medium', label: '进行中', color: 'yellow' };
  return { level: 'behind', label: '严重落队', color: 'red' };
}
```
