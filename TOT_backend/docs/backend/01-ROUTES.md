# 后端路由实现指南

**版本:** 1.1.0 | **基于:** `docs/specs/04-API-SPEC.md` + `docs/specs/08-PERMISSION-MODEL.md`
**图例:** ✅ 已实现并符合 Spec | ⚠️ 部分实现 / 需修改 | ❌ 未实现

---

## 文件位置

```
server/
  auth.js           ← JWT 中间件、requireRole
  routes/
    login.js        ← /api/login, /api/me
    tasks.js        ← 任务 + Assignment 路由
    stores.js       ← /api/stores, /api/stores/:id/employees
    employees.js    ← /api/employees/:id
    notifications.js ← /api/notifications, /api/notifications/:eventId/read
    store-progress.js ← /api/store/tasks/:id/progress
    mypal.js          ← /api/v1/mypal/sync（MyPal 学习进度同步）
```

---

## 1. 认证中间件（server/auth.js）

### 当前状态 ✅

- `authMiddleware` 和 `signToken` 已实现，逻辑正确
- `requireRole()` 已实现并在关键路由中使用
- PUBLIC_PATHS 已收敛为最小公开面（仅 login/health/favicon）：

```javascript
{ method: 'POST', path: '/api/login' },
{ method: 'GET',  path: '/api/health' },
{ method: 'GET',  path: '/favicon.ico' }
```

### 说明

PUBLIC_PATHS 仅保留真正公开的路径，其余均需 token：

```javascript
// 目标
const PUBLIC_PATHS = [
  { method: 'POST', path: '/api/login' },
  { method: 'GET',  path: '/api/health' },
  { method: 'GET',  path: '/favicon.ico' }
];
```

### Gap 清单

- [x] 缩减 PUBLIC_PATHS，去除 tasks/assignments 的豁免
- [x] 在需要角色限制的路由上加 `requireRole(...)` 中间件
- [x] 错误响应统一包含 `errorCode`（见 `auth.js` 与主要 routes）

---

## 2. 认证 API（server/routes/login.js）

### POST /api/login ✅

**当前状态：** 基本符合 Spec，bcrypt 验证通过，JWT payload 包含 id/role/storeId/employeeId/name。

**小差异：**
- 响应中 `user` 对象缺少 `username` 字段（Spec 要求返回 username）

**Gap 清单**
- [ ] 响应 `user` 对象加入 `username` 字段
- [ ] 错误响应加 `errorCode: 'AUTH_001'`

---

### GET /api/me ✅

当前实现返回 `req.user`（JWT payload），符合 Spec。需确保 token 全面鉴权后该路由被保护。

---

## 3. 任务 API（server/routes/tasks.js）

### GET /api/tasks ⚠️

**当前问题：**
- 无角色过滤（所有角色返回全部任务）
- 返回字段名与 Spec 不符（`name` 而非 `title`，`deadline` 而非 `ddlAt`）

**目标行为（见 04-API-SPEC.md §2）：**
- `central` / `admin`：返回全部任务
- `store_manager`：只返回本店有 Assignment 的任务
- `employee`：只返回本人有 Assignment 的任务

**Gap 清单**
- [ ] 按 `req.user.role` 分支，注入 WHERE 子句（参考 `08-PERMISSION-MODEL.md` `buildTaskFilter`）
- [ ] 字段映射：`name → title`，`deadline → ddlAt`，`config_json → platforms`（JSON.parse）

---

### POST /api/tasks ⚠️

**当前问题：**
- 接收字段：`name`（应为 `title`）、`deadline`（应为 `ddlAt`）
- 缺少 `platforms` 字段（在 Spec 中为必填）
- 缺少 `rtmFilter` 字段
- 初始 status 写入 `'pending'`（应为 `'draft'`）
- 未加 `requireRole('central', 'admin')`

**Gap 清单**
- [ ] 接收 `title`，写入 `tasks.title`（数据库字段同步改）
- [ ] 接收 `platforms`（数组），JSON.stringify 后写入 `tasks.platforms`
- [ ] 接收 `rtmFilter`（数组），JSON.stringify 后写入 `tasks.rtm_filter`
- [ ] 接收 `ddlAt`，写入 `tasks.ddl_at`
- [ ] 初始 status 改为 `'draft'`
- [ ] 加 `requireRole('central', 'admin')` 中间件
- [ ] 响应 errorCode: `TASK_001`

---

### GET /api/tasks/:id ⚠️

**当前问题：** 无角色可见性过滤，字段命名不符 Spec。

**Gap 清单**
- [ ] 加角色可见性判断（employee 只能看自己有 Assignment 的任务）
- [ ] 字段映射对齐 Spec 响应格式

---

### POST /api/tasks/:id/dispatch ⚠️

**当前问题（dispatchService.js）：**
- 检查 `status !== 'pending'`（应为 `'draft'`）
- 无 RTM 筛选逻辑（只处理 `store_scope: 'all'` 或 JSON 数组）
- 不写入 `notification_events`
- 不触发 WebSocket 广播
- 使用 `assignee_id`/`assignee_role` 字段（应为 `user_id`/`user_role`）
- 缺少幂等保护（`INSERT OR IGNORE`）

**目标事务步骤（见 04-API-SPEC.md §2）：**
1. 校验 `task.status === 'draft'`，否则返回 TASK_003
2. 执行 RTM 筛选（调用 `buildRtmFilterSQL`，见 07-RTM-FILTER.md）
3. 按 `targetRole` 过滤员工
4. 批量 `INSERT OR IGNORE INTO task_assignments`
5. 批量 `INSERT INTO notification_events`（event_type: `task_assigned`）
6. `UPDATE tasks SET status = 'dispatched'`
7. WebSocket 广播 `task_dispatched`

**Gap 清单**
- [ ] status 判断改为 `'draft'`
- [ ] 引入 RTM 筛选（实现见 02-SERVICES.md）
- [ ] 修改字段名：`assignee_id → user_id`，`assignee_role → user_role`
- [ ] 使�� `INSERT OR IGNORE`（幂等）
- [ ] dispatch 完成后插入 `notification_events`
- [ ] dispatch 完成后 WebSocket 广播（调用 `StateSync.broadcast`）
- [ ] 加 `requireRole('central', 'admin')`

---

### GET /api/tasks/:id/summary ⚠️

**当前状态：** `TaskSummaryService.getTaskSummary()` 存在，但响应 shape 与 Spec 不符（缺少 kpi / byRegion / byDealer / alertList / timeline 等字段，completionRate 单位未统一为整数百分比）。

**Gap 清单**
- [ ] 重写 `TaskSummaryService.getTaskSummary()`，对齐 `06-DASHBOARD-KPI.md` 全部 SQL
- [ ] 加 `requireRole('central', 'admin')`

---

### POST /api/tasks/:id/nudge ❌

**当前状态：** 未实现。

**目标实现（见 04-API-SPEC.md §2 + 05-NOTIFICATION-NUDGE.md）：**

```
POST /api/tasks/:id/nudge
Body: { targetType, targetId, severity }
```

1. 权限校验（见 `validateNudgePermission`，08-PERMISSION-MODEL.md）
2. 查找目标用户的 assignment（检查 status !== 'completed'，否则 NUDGE_001）
3. `INSERT INTO nudge_records`
4. 为每个目标用户 `INSERT INTO notification_events`（nudge_yellow / nudge_red）
5. `UPDATE task_assignments SET nudge_count = nudge_count + 1`
6. WebSocket 广播 `nudge_sent`

**Gap 清单**
- [ ] 创建路由 `POST /api/tasks/:id/nudge`
- [ ] 实现 `validateNudgePermission` 中间件（见 08-PERMISSION-MODEL.md）
- [ ] 实现 NudgeService（见 02-SERVICES.md）
- [ ] 加 `requireRole('central', 'store_manager')`

---

## 4. Assignment API（server/routes/tasks.js）

### GET /api/assignments ❌

**当前状态：** 不存在（有 `GET /api/my-tasks` 但功能和格式完全不同）。

**目标实现（见 04-API-SPEC.md §3）：**

```
GET /api/assignments?taskId=&status=&storeId=
```

- 按 `req.user.role` 过滤（见 `08-PERMISSION-MODEL.md buildAssignmentFilter`）
- 返回字段包含 `taskTitle / taskPlatforms / mypalCompleted / smartsellCompleted ...`
- JOIN `tasks` 表获取任务信息

**Gap 清单**
- [ ] 创建 `GET /api/assignments` 路由
- [ ] 实现角色过滤逻辑（使用参数化查询）
- [ ] 响应 shape 对齐 Spec

---

### GET /api/assignments/:id ⚠️

**当前状态：** 路由存在（调用 `TaskSummaryService.getAssignmentDetail`），但响应字段与 Spec 不符。

**Gap 清单**
- [ ] 加 Assignment 归属校验（见 08-PERMISSION-MODEL.md `requireAssignmentOwner`）
- [ ] 响应字段对齐（taskTitle / userRole / storeName 等）

---

### POST /api/assignments/:id/start ❌

**当前状态：** 未实现（现有 `PATCH /api/assignments/:id` 做 status 更新，但格式和逻辑不符）。

**目标实现：**
1. 幂等：已是 `in_progress` 直接返回 200
2. 状态转换：`pending → in_progress`（guard：pending 才允许，否则 ASSIGN_002）
3. 写入 `started_at = now`
4. 写入 `received_at = COALESCE(received_at, now)`（只写一次，幂等安全）
5. 写入 ReadReceipt（source: `task_detail_open`，用于 KPI 已读统计）
6. WebSocket 广播 `assignment_started`

**Gap 清单**
- [ ] 创建 `POST /api/assignments/:id/start`
- [ ] 加 `requireAssignmentOwner` 中间件
- [ ] 幂等处理

---

### POST /api/assignments/:id/platforms/:platform/complete ❌

**当前状态：** 未实现（现有 `PATCH /api/assignments/:id/progress` 是直接设置 0-100 进度，与新 Spec 逻辑不同）。

**目标实现（见 03-PLATFORM-COMPLETION.md）：**
1. Guard：`assignment.status === 'in_progress'`，否则 ASSIGN_002
2. Guard：`platform` 在 `task.platforms` 中，否则 ASSIGN_003
3. 幂等：已完成返回 200
4. 更新对应平台字段（`mypal_completed = 1` 等）
5. 重新计算 `progress = 完成平台数 / 总平台数 × 100`
6. 若 `progress === 100`，`status = 'completed'`，写 `completed_at`
7. WebSocket 广播 `platform_completed`（或 `assignment_completed`）

**Gap 清单**
- [ ] 创建 `POST /api/assignments/:id/platforms/:platform/complete`
- [ ] 实现平台完成逻辑（见 02-SERVICES.md）
- [ ] 加 `requireAssignmentOwner` 中间件

---

## 5. 通知 API（待创建 server/routes/notifications.js）

### GET /api/notifications ❌

**目标（见 04-API-SPEC.md §4）：**

```
GET /api/notifications?unread=true&taskId=
```

- 仅 `store_manager` / `employee` 可访问
- 查询 `notification_events`，JOIN `read_receipts` 判断是否已读
- 每条通知附 `assignmentStatus` 字段（用于前端隐藏已完成任务的催办通知）

**Gap 清单**
- [ ] 创建 notifications.js 路由文件
- [ ] 实现查询 SQL（JOIN notification_events + read_receipts + task_assignments）
- [ ] 加 `requireRole('store_manager', 'employee', 'admin')`

---

### POST /api/notifications/:eventId/read ❌

**目标：**
1. 查找 `notification_events`，校验归属（`requireNotificationOwner`）
2. `INSERT OR IGNORE INTO read_receipts`（幂等）
3. 返回 `{ eventId, readAt }`

**Gap 清单**
- [ ] 创建路由
- [ ] 实现 `requireNotificationOwner` 中间件（见 08-PERMISSION-MODEL.md）

---

## 6. 店长监管 API（待创建 server/routes/store-progress.js）

### GET /api/store/tasks/:taskId/progress ❌

**目标（见 04-API-SPEC.md §5）：**
- 仅 `store_manager` 可访问本店数据
- 返回：门店汇总（total / pending / inProgress / completed / completionRate）+ 每个成员的 Assignment 详情（包含各平台完成状态）

**Gap 清单**
- [ ] 创建 store-progress.js 路由
- [ ] SQL 查询对齐 Spec 响应格式
- [ ] 校验 `task.store_id === req.user.storeId`

---

## 7. 基础数据 API（server/routes/stores.js + employees.js）

### GET /api/stores ⚠️

**当前问题：**
- role 判断使用 `'store'`（应为 `'store_manager'`）
- 缺少 `format`、`dealerName`、`subRtm` 字段
- employee 角色无 403（Spec 要求 employee 不可访问）

**Gap 清单**
- [ ] 角色判断改为 `'store_manager'`
- [ ] `formatStore` 加入 `format`、`dealerName`、`subRtm` 字段
- [ ] employee 请求返回 403

---

### GET /api/stores/:storeId/employees ⚠️

**当前问题：** `formatEmployee` 包含大量旧版字段（`sc_modules`, `sc_test` 等，数据库可能不存在）。

**Gap 清单**
- [ ] `formatEmployee` 精简为 Spec 字段：id / name / storeId / storeName / role / isManager / riskLevel / lastActive
- [ ] 加 store_manager 仅限本店的校验

---

## 8. MyPal 同步 API（`server/routes/mypal.js`）✅

### POST /api/v1/mypal/sync ✅

- **鉴权：** `authenticate` + `requireRole(['central','admin'])`
- **配置：** 需 `MYPAL_ENABLED=1` 且 `MYPAL_API_BASE`、`MYPAL_APP_ID`、`MYPAL_APP_SECRET`；否则 **503** / `errorCode: MYPAL_DISABLED`
- **请求体：** `{ "mode": "batch" | "weekly", "taskId"?: string, "queryDate"?: string }`（`mode` 默认 `batch`）
- **详细说明：** [`06-MYPAL-INTEGRATION.md`](./06-MYPAL-INTEGRATION.md)

---

## 9. 废弃路由（待清理）

以下路由不在新 Spec 中，后期清理（MVP 阶段可保留不调用）：

| 路由 | 文件 | 说明 |
|------|------|------|
| GET /api/my-tasks | tasks.js | 被 GET /api/assignments 替代 |
| GET /api/tasks/:id/stats | tasks.js | 被 summary 替代 |
| PATCH /api/assignments/:id | tasks.js | 被 start + platform/complete 替代 |
| PATCH /api/assignments/:id/progress | tasks.js | 旧进度更新接口 |
| GET /api/state | index.js | 旧事件总线 |
| POST /api/events | index.js | 旧事件总线 |
| GET /api/events | index.js | 旧事件总线 |
