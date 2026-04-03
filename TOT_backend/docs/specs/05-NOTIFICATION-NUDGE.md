# 通知与催办系统规格

**版本:** 1.2.0 | **PRD §5.5, §6.4** | **更新日期:** 2026-03-27

---

## 系统概览

通知与催办系统由三张表构成（与 `01-DATA-MODEL.md` 对齐）：

| 表 | 职责 |
|----|------|
| `notification_events` | 每条通知记录（1条 = 1个用户的1次通知） |
| `read_receipts` | 已读回执（记录用户何时、以何种方式读取通知）|
| `nudge_records` | 催办事实记录（完整审计用，不可删除）|

---

## Day2 当前状态（联调边界）

- **Dev1 已完成：**
  - 数据表与索引已就绪（`notification_events` / `read_receipts` / `nudge_records`）
  - Assignment 基础 CRUD 已完成（`nudge_count` 可基础更新）
- **Dev2 待实现：**
  - `POST /events`、`GET /events`、`POST /events/{eventId}/read`、`POST /events/{eventId}/task-detail-read`
  - `GET /events/unread-count`、`POST /nudges`、`GET /nudges`
  - WebSocket 广播与重连补拉联动

> 本文档是 Dev2 的实现约束，接口最终以 `04-API-SPEC.md` 为准。

---

## Day4 实现状态（已完成）

| 接口 | 文件 | 状态 |
|------|------|------|
| `POST /api/v1/events` | `routes/notifications.js` | ✅ 已实现 |
| `GET /api/v1/events` | `routes/notifications.js` | ✅ 已实现（含 isActive/resolvedAt/readStatus 计算）|
| `POST /api/v1/events/:id/read` | `routes/notifications.js` | ✅ 已实现（source=notification_click，幂等）|
| `GET /api/v1/events/unread-count` | `routes/notifications.js` | ✅ 已实现 |
| `POST /api/v1/assignments/:id/viewed` | `routes/assignments.js` | ✅ 已实现（source=task_detail_open，原子写 received_at）|
| `POST /api/v1/nudges` | `routes/nudge.js` | ✅ 已实现（事务原子写 nudge_records + events + nudge_count）|
| `GET /api/v1/nudges` | `routes/nudge.js` | ✅ 已实现 |
| WebSocket 广播 | `ws/manager.js` | ✅ 已实现（task_assigned / nudge_sent / assignment_completed / task_updated）|

> 接口细节以 `04-API-SPEC.md` 为准。

---

## 通知类型

| event_type | 触发时机 | severity | 展示文案 |
|-----------|---------|---------|--------|
| `task_assigned` | 任务下发，为每个 Assignment 创建一条 | — | "你有新的培训任务：{title}" |
| `nudge_yellow` | 黄色催办 | yellow | "{发起人}提醒你完成培训任务：{title}" |
| `nudge_red` | 红色催办 | red | "【紧急】{发起人}要求你立即完成：{title}" |
| `task_updated` | 任务截止时间等信息更新 | — | "培训任务 {title} 已更新" |

---

## 通知生命周期

```
任务下发（POST /api/v1/tasks/:id/dispatch）
  └─▶ 批量创建 notification_events（event_type=task_assigned，dedupeKey 保证幂等）
       └─▶ WS 推送目标用户：{ event:"task_assigned", data:{taskId,taskTitle,ddlAt} }
            └─▶ 用户点击铃铛通知项
                 └─▶ POST /api/v1/events/:eventId/read（source=notification_click）
                      └─▶ 用户进入任务详情
                           └─▶ POST /api/v1/assignments/:assignmentId/viewed（source=task_detail_open）
                                └─▶ 原子写 task_assignments.received_at + read_receipts

任务信息更新（PATCH /api/v1/tasks/:id，仅 dispatched 状态）
  └─▶ 批量创建 notification_events（event_type=task_updated）
       └─▶ WS 推送相关用户：{ event:"task_updated", data:{taskId,ddlAt} }

总部发起催办（POST /api/v1/nudges）
  └─▶ INSERT nudge_records（完整事实，含 notification_event_ids JSON 数组）
       └─▶ 为每个未完成目标用户 INSERT notification_events（nudge_yellow / nudge_red）
       └─▶ task_assignments.nudge_count += 1（每个目标 assignment）
            └─▶ WS 推送目标用户：{ event:"nudge_sent", data:{nudgeRecordId,taskId,severity,...} }
                 └─▶ 前端铃铛未读数 +1
                      └─▶ 任务完成（assignment.status = completed）
                           └─▶ 催办类通知从未读统计中剔除（isActive 计算值变 false）
```

---

## 催办权限规则

| 发起角色 | 可催对象 | targetType | 限制 |
|---------|---------|-----------|------|
| central | 单个员工 | `employee` | 无限制 |
| central | 整个门店 | `store` | 无限制 |
| central | 整个区域 | `region` | 无限制 |


---

## 催办业务规则

| 规则 | 口径 |
|------|------|
| 重复催办 | 允许，每次创建独立的 nudge_record 和 notification_event |
| 已完成任务催办 | 目标范围内**所有** assignment 均已完成时返回 HTTP **409**（`NUDGE_001`）；部分完成则跳过已完成者，仍催办未完成者 |
| 频控策略 | MVP 不设（无频率限制）|
| 催办记录 | 每次必须写入完整的 nudge_records（不可跳过）|

---

## 催办通知的前端展示逻辑

**持续显示规则:** 催办通知在任务未完成前持续显示，完成后自动隐藏。

**前端实现逻辑:**

```javascript
function getVisibleNotifications(notifications) {
  return notifications.filter(n => {
    // task_assigned：未读即显示
    if (n.eventType === 'task_assigned') return !n.isRead;

    // 催办通知：任务完成后不显示
    if (n.eventType.startsWith('nudge_')) {
      return n.assignmentStatus !== 'completed';
    }

    return true;
  });
}

function getUnreadCount(notifications) {
  return getVisibleNotifications(notifications).filter(n => !n.isRead).length;
}
```

**铃铛展示规则:**
- 有未读通知 → 铃铛显示红色数字角标
- 无未读通知 → 铃铛无角标
- 点击铃铛 → 展开通知列表（不自动标记已读）
- 点击列表中的通知 → 调 `POST /events/{eventId}/read`，再跳转任务详情

---

## 已读统计规则

**KPI 口径（用于总部看板）:**

| KPI | 计算方式 |
|-----|---------|
| 店员已读人数 | `SELECT COUNT(DISTINCT rr.user_id) FROM read_receipts rr JOIN notification_events ne ON rr.event_id = ne.id WHERE ne.task_id = ? AND rr.source='task_detail_open'` |
| 任务真实发放率 | 已读人数（去重）/ 目标应发人数（total assignment 数）|

**已读条件：**
- 店员已读：店员打开任务详情页（source: task_detail_open）

---

## nudge_records 完整字段说明

每次催办必须写入以下字段（不可省略）：

| 字段 | 说明 | 示例 |
|------|------|------|
| id | 唯一 ID | nudge_xyz123 |
| task_id | 关联任务 | task_abc123 |
| target_type | 催办对象类型 | employee / store / region |
| target_id | 对象 ID 或名称 | E001 / S001 / 华东 |
| initiator_id | 发起人 user.id | 2 |
| severity | 催办级别 | yellow / red |
| notification_event_ids | 本次创建的 notification event IDs | ["evt_001","evt_002"] |
| created_at | 催办时间 | 2026-03-24T12:00:00Z |

---

## WebSocket 推送时机（已实现）

连接端点：`ws://[host]/ws?token=<JWT>`，仅 `employee`（有 employeeId）可建立连接；`central` / `executive` 无 employeeId，不支持 WS 推送，需轮询 REST 接口。

| 操作 | WS 事件名 | 接收方 | 触发文件 |
|------|----------|--------|---------|
| 任务下发 | `task_assigned` | 所有目标用户 | `routes/tasks.js` dispatch |
| 任务信息更新（dispatched 后） | `task_updated` | 有 assignment 的所有用户 | `routes/tasks.js` PATCH |
| 催办发出 | `nudge_sent` | 被催的未完成用户 | `routes/nudge.js` POST /nudges |
| 任务 auto-complete | `assignment_completed` | 完成者本人 | `routes/assignments.js` PUT /:id/status |

> **central 不可达：** `assignment_completed` 规格要求同时通知 central，但 central 账号无 `employeeId`，无法建立 WS 连接；central 端看板数据通过轮询 `GET /dashboard/overview` 获取。

---

## 断线场景处理

用户断线重连后，需补拉未读通知与任务状态：

```javascript
// 前端断线重连逻辑
async function onReconnect() {
  // 1. 补拉通知事件（按当前用户范围）
  const { data } = await GET('/events?pageNum=1&pageSize=50');
  updateNotificationBell(data);

  // 2. 补拉 assignment 状态
  const { data: assignments } = await GET('/assignments');
  updateTaskList(assignments);
}
```
