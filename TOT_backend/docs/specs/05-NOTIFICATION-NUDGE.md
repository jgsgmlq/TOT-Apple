# 通知与催办系统规格

**版本:** 1.3.0 | **PRD §5.5、§6.4、附录 F** | **更新日期:** 2026-04-09

---

## 产品与工程边界（PRD vs 代码）

- **产品主路径（P0 验收）：** PRD **§5.5 / §6.4** 强调**规则自动触发**预警与提醒，同一任务可在不同命中时点重复触发，且任务完成后消息中心中相关通知与预警**自动消失**；**§6.1** 等与附录 **F.3** 明确 MVP **不做人工催办**为范围口径——**总部主动触达类能力不作为 P0 必选验收项**，以规则预警与链路闭环为准。
- **工程现状：** 服务端仍实现 **`POST /api/v1/nudges`**、**`GET /api/v1/nudges`**、**`POST /api/v1/nudges/ai-generate`** 等（命名沿用历史「催办」），与 **`autoNudgeScheduler` + `services/autoNudge.js`** 写入的 **`notification_events`（`nudge_yellow` / `nudge_red`）** 共用同一套事件与 WS 形态；规格上区分为下文的 **规则自动预警** 与 **总部主动催办（可选）**。

---

## 系统概览

通知与催办由三张表构成（与 `01-DATA-MODEL.md`、`server/db/schema.sql` 对齐）：

| 表 | 职责 |
|----|------|
| `notification_events` | 每条通知一行（1 行 = 某员工 1 次触达）；含任务下发、任务更新、黄/红提醒等 |
| `read_receipts` | 已读回执（主路径 **`task_detail_open`** / **`task_detail_open:{平台}`**；历史数据可有 `notification_click`） |
| `nudge_records` | 与「催办/触达」相关的审计行（总部主动路径与自动预警路径均可能写入，见下文） |

**接口与字段细节以 `04-API-SPEC.md` 为准。**

---

## 实现状态与路由清单

| 能力 | 路径 / 位置 | 说明 |
|------|----------------|------|
| 创建系统事件（内部） | `POST /api/v1/events` | `routes/notifications.js`；仅 `task_assigned` / `task_updated`，**禁止**经此创建 `nudge_*`（须走 nudges 或自动预警逻辑） |
| 通知列表 | `GET /api/v1/events` | 含 `isActive`、`readStatus`、`ruleType`（自动预警且 `dedupe_key` 形如 `autonudge:…` 时解析） |
| 未读数 | `GET /api/v1/events/unread-count` | 店员 `employeeId`；无则返回 0 |
| 任务详情已读（主路径） | `POST /api/v1/assignments/:assignmentId/viewed` | 可选 **`platform`**：`task_detail_open` 或 `task_detail_open:{标签}` + `received_at`；必要时补建 `task_assigned` 后写 `read_receipts` |
| 总部主动催办 | `POST /api/v1/nudges` | `routes/nudge.js`；**仅 `central`** |
| 催办记录列表 | `GET /api/v1/nudges` | **仅 `central`**；`taskId` 必填 |
| AI 辅助催办文案 | `POST /api/v1/nudges/ai-generate` | **`central` / `admin`** |
| 手动触发自动扫描 | `POST /api/v1/tasks/:id/auto-nudge` | `routes/tasks.js`；`central` / `admin`；调用 `evaluateAndTriggerAutoNudges` |
| 定时自动预警 | `jobs/autoNudgeScheduler.js` | 进程启动后按间隔扫描已下发且配置了 `auto_nudge_rules` 的任务 |
| WebSocket | `ws://[host]/ws?token=<JWT>` | `ws/manager.js`；需 JWT 含 **`employeeId`** |

---

## 两类触达路径

### 1. 规则自动预警（P0 主路径，与 PRD §5.5 / §6.4 一致）

- **配置：** 任务 `auto_nudge_rules`（进度掉队、起步异常、deadline 危机等，口径见 PRD **§6.4**）。
- **执行：** `autoNudgeScheduler` 周期性调用 `evaluateAndTriggerAutoNudges(taskId)`（`services/autoNudge.js`）。
- **落库：** 向 `notification_events` 写入 **`nudge_yellow` / `nudge_red`**，`dedupe_key` 形如 **`autonudge:{ruleType}:{assignmentId}`**，用于**同规则同 assignment 幂等**；`GET /events` 通过 `dedupe_key` 前缀解析 **`ruleType`**（如 `progressLag`、`startDelay`、`deadlineCrisisP0`）。
- **审计：** 自动路径为每个目标用户写入 **`nudge_records`**（`target_type='employee'`，`target_id` 为员工 id，`initiator_id` 为服务内约定的系统用户，见实现代码）。
- **WS：** 推送 **`nudge_sent`**，负载含 `taskId`、`severity`、`eventType`、`content`（AI 生成或兜底）、`ruleType` 等（与实现一致）。

### 2. 总部主动催办（代码存在，PRD 附录 F：**非 P0 必选验收**）

- **入口：** `POST /api/v1/nudges`（仅 `central`），按 `targetType`（`employee` / `store` / `region`）解析目标 `assignments`，跳过已完成，全完成则 **409 `NUDGE_001`**。
- **落库：** 事务内写 **`nudge_records`** + 对应 **`notification_events`** + `task_assignments.nudge_count += 1`。
- **WS：** **`nudge_sent`**，负载含 `nudgeRecordId`、`taskId`、`severity`、`eventType`、`initiatorRole` 等（与 `routes/nudge.js` 一致）。

---

## 通知类型

| event_type | 触发时机 | severity | 说明 |
|-----------|---------|---------|------|
| `task_assigned` | 任务下发，每 assignment 一条（`dedupe_key` 幂等） | — | 文案示例见前端 |
| `task_updated` | 已下发任务 `PATCH` 变更（如 ddl）后批量写入 | — | `assignment_id` 可为空（实现侧按用户维度插入） |
| `nudge_yellow` | 规则自动预警或总部主动催办 | yellow | 同类型，靠 `dedupe_key` / `nudge_records` 区分来源 |
| `nudge_red` | 同上 | red | 同上 |

---

## 通知生命周期（端到端）

```
任务下发（POST /api/v1/tasks/:id/dispatch）
  └─▶ notification_events（task_assigned）+ WS task_assigned
       └─▶ POST /assignments/:id/viewed（task_detail_open，已读主路径）

任务更新（PATCH /api/v1/tasks/:id，dispatched）
  └─▶ notification_events（task_updated）+ WS task_updated

规则自动预警（autoNudgeScheduler → evaluateAndTriggerAutoNudges）
  └─▶ notification_events（nudge_*，dedupe_key=autonudge:…）+ nudge_records + nudge_count
       └─▶ WS nudge_sent（含 content、ruleType）

总部主动催办（POST /api/v1/nudges，可选）
  └─▶ nudge_records + notification_events（nudge_*）+ nudge_count
       └─▶ WS nudge_sent（含 nudgeRecordId、initiatorRole 等）

任务完成（assignment → completed）
  └─▶ WS assignment_completed；铃铛未读/列表 isActive 随 assignment 状态变化
```

---

## 催办权限规则（总部主动 API）

| 接口 | 角色 |
|------|------|
| `POST /api/v1/nudges` | **仅 `central`** |
| `GET /api/v1/nudges` | **仅 `central`** |
| `POST /api/v1/nudges/ai-generate` | **`central` / `admin`** |

| 发起角色 | 可催对象 | targetType |
|---------|---------|-----------|
| `central`（POST /nudges） | 员工 / 门店 / 区域 | `employee` / `store` / `region` |

---

## 催办业务规则

| 规则 | 口径 |
|------|------|
| 重复催办 | 允许；每次独立 `nudge_record` 与 `notification_events`（自动路径用 `dedupe_key` 防重复刷屏） |
| 已完成任务 | 目标范围内**全部** assignment 已完成 → **409**（`NUDGE_001`）；部分完成则跳过已完成 |
| 频控 | MVP 不设人工频控；自动路径以规则 + `dedupe_key` 为准 |
| 审计 | `nudge_records` 与 `notification_event_ids` 的对应关系见实现 |

---

## 催办通知的前端展示逻辑

**持续显示：** 任务未完成前，催办类通知可参与展示；完成后随 `assignment` 状态在 **`GET /events`** 的 `isActive` / 未读统计中体现为不活跃（`task_updated` 行在实现中始终视为 active，见 `notifications.js`）。

**铃铛未读：** `GET /events/unread-count` 对 `task_assigned` / `nudge_*` 在未读且 assignment 未完成时计入；`task_updated` 单独计入未读逻辑（见代码）。

---

## 已读统计规则（KPI / 看板）

| KPI | 计算方式（与 PRD §5.6 / 看板一致时） |
|-----|--------------------------------------|
| 店员已读（任务详情打开） | **看板未传 `platform`**：`read_receipts.source = 'task_detail_open'` 精确匹配；**传 `platform`**：`source = task_detail_open:{标签}`。铃铛 **列表/未读**：按 **`(event_id,user_id)`** 聚合多 `source`，任一回执即已读 |

**已读条件：**

- 打开任务详情：`POST /assignments/:id/viewed` → `task_detail_open`（并写 `received_at`；**唯一**写入入口，见 `04-API-SPEC` §4.3）
- 历史：`notification_click` 来自已移除的 `POST /events/:eventId/read`，仅存量数据可能出现

---

## nudge_records 字段说明（与 `01-DATA-MODEL.md` 一致）

| 字段 | 说明 |
|------|------|
| id | nanoid |
| task_id | 任务 id |
| target_type | `employee` / `store` / `region` |
| target_id | `employees.id` / `stores.id` / 区域名 |
| initiator_id | `users.id`（INTEGER） |
| severity | `yellow` / `red` |
| notification_event_ids | JSON 数组，本次产生的 `notification_events.id` |
| created_at | ISO 8601 |

---

## WebSocket

连接端点：`ws://[host]/ws?token=<JWT>`，仅当 Token 含 **`employeeId`** 时可建立连接；`central` / `admin` / `executive` 无 `employeeId` 时须轮询 REST（如 `GET /events`、`GET /dashboard/...`）。

| 操作 | WS 事件 | 接收方 |
|------|----------|--------|
| 任务下发 | `task_assigned` | 目标用户 |
| 任务更新 | `task_updated` | 有 assignment 的用户 |
| 自动/人工催办 | `nudge_sent` | 被触达用户 |
| 任务完成 | `assignment_completed` | 完成者本人 |

> **central 无 WS：** 总部看板依赖轮询；与附录 F 一致。

---

## 断线重连

重连后建议补拉：

```javascript
async function onReconnect() {
  const { data } = await GET('/api/v1/events?pageNum=1&pageSize=50');
  updateNotificationBell(data);
  const { data: assignments } = await GET('/api/v1/assignments');
  updateTaskList(assignments);
}
```

---

## 文档维护

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.2.0 | 2026-03-27 | 初版联调边界 |
| 1.3.0 | 2026-04-09 | 与 PRD §5.5/§6.4/附录 F 及 `notifications.js`、`nudge.js`、`autoNudge.js` 对齐；区分规则自动预警与总部主动催办；更新权限与路由清单 |
