# 状态机规格

**版本:** 1.2.0 | **PRD §6.1, §6.2** | **更新日期:** 2026-04-09

> **与实现对齐：** 下文 HTTP 路径与行为以 `TOT_backend/server/routes/tasks.js`、`assignments.js` 为准；产品语义见 `docs/product/PRODUCT_REQUIREMENTS.md`。

---

## 1. Task 状态机

### 状态图

```
[创建] ──▶ draft ──[dispatch]──▶ dispatched（终态）
```

### 状态定义

| 状态 | 含义 | 允许的操作 |
|------|------|---------|
| `draft` | 任务已创建，尚未下发 | 编辑字段、下发 |
| `dispatched` | 任务已下发，Assignments 已生成 | 仅修改 ddl_at；无撤回 |

**draft 可编辑字段:** title、description、has_mypal / has_smartsell / has_ai_demo / has_live_broadcast、target_role、rtm_filter、store_scope、ddl_at

**dispatched 不可编辑字段:** has_mypal / has_smartsell / has_ai_demo / has_live_broadcast、target_role、rtm_filter、store_scope（下发范围已固定）

---

### Transition: `draft → dispatched`

**触发:** `POST /api/v1/tasks/:id/dispatch`

**权限:** `central`、`admin`

**Guard（前置校验，任一失败则拒绝）:**

```
1. task.status === 'draft'
   → 否则 HTTP 409，errorCode: TASK_003，"任务已下发"

2. task.has_mypal + task.has_smartsell + task.has_ai_demo + task.has_live_broadcast >= 1
   → 否则 HTTP 400，errorCode: TASK_001，"任务至少配置一个学习平台"

3. 根据 rtm_filter / store_scope 能筛选到 >= 1 个目标用户
   → 否则 HTTP 400，errorCode: RTM_001，"当前筛选无门店命中，请调整筛选条件"
```

**Side Effects（按顺序执行，使用事务）:**

```
1. 查询目标用户列表（见 07-RTM-FILTER.md）
2. 批量 INSERT INTO task_assignments（UNIQUE 约束跳过已存在，保证幂等）
3. 批量 INSERT INTO notification_events（event_type=task_assigned，dedupe_key 去重）
4. UPDATE tasks SET status='dispatched', updated_at=now()
5. WebSocket 广播 task_dispatched 事件（含 assignmentCount）（若实现启用）
```

**注意:** 不要求原子性——已成功生成的 Assignment 保留生效；失败的对象记录错误日志，响应中返回 failedUsers 列表。

---

### 禁止操作

| 操作 | 条件 | 错误码 |
|------|------|--------|
| 重复下发 | status === 'dispatched' | TASK_003 |
| 修改 has_*/target_role/rtm_filter | status === 'dispatched' | TASK_004 |

---

## 2. Assignment 状态机

### 状态图

```
[下发生成] ──▶ pending ──[start]──▶ in_progress ──[all platforms done]──▶ completed（终态）
```

### 状态定义

| 状态 | 含义 |
|------|------|
| `pending` | 已分配，用户未开始 |
| `in_progress` | 用户已点击「开始任务」 |
| `completed` | 所有配置平台均已完成 |

---

### 统一入口：`PUT /api/v1/assignments/:id/status`

学习端对单条 Assignment 的状态与平台完成均通过本接口，请求体字段：

| 字段 | 说明 |
|------|------|
| `operationType` | 必填：`start_task` \| `complete_platform` \| `complete_task` |
| `platform` | `complete_platform` 时必填，取值与任务配置平台对应（如 `mypal`、`smartsell` 等，见 `04-API-SPEC.md`） |

详见 `docs/specs/04-API-SPEC.md` 对应章节。

---

### Transition: `pending → in_progress`

**触发:** `PUT /api/v1/assignments/:id/status`，`operationType: "start_task"`

**权限:** Assignment 归属用户（JWT 与 `task_assignments.user_id` 一致的学习端账号，含店员与店长学习对象）

**Guard:**

```
assignment.status === 'pending'
  → 否则 HTTP 409，errorCode: ASSIGN_013，「当前状态不可开始任务」
  （当前实现不对「已是 in_progress」做 200 幂等）
```

**Side Effects:**

```
1. assignment.status = 'in_progress'
2. assignment.started_at = now()
3. assignment.updated_at = now()
4. WebSocket：`start_task` 不推送（与 §15 事件约定一致）
```

---

### Transition: `in_progress → completed`（系统判定或一键完成）

**路径 A — 逐平台标记（常见）**

**触发时机:** `operationType: "complete_platform"` 且传入合法 `platform`，服务端更新对应 `*_completed` 后按任务配置重算 `progress`；当全部配置平台均为已完成时，将 `status` 置为 `completed` 并写入 `completed_at`。

**条件（AND）:** 与 PRD 一致——任务上勾选的每个平台，对应 Assignment 上该平台字段均为已完。

**路径 B — 一键完成**

**触发:** `operationType: "complete_task"`：服务端将任务配置内的各平台完成位一次性置为已完成，并将 `status` 置为 `completed`（当前实现允许在**未**先执行 `start_task` 时调用，属实现行为；若产品要求必须先「开始任务」，以 PRD/评审结论为准）。

**Side Effects（完成时）：**

```
1. assignment.status = 'completed'
2. assignment.completed_at = now()
3. assignment.progress = 100（或等价计算结果）
4. assignment.updated_at = now()
5. WebSocket 广播 assignment_completed 事件（见实现）
6. 前端侧：已完成的 Assignment 对应的预警/提醒类通知自动隐藏（实现层事件类型可能仍为 nudge_*，以 PRD「提醒」用语为准）
```

---

### 禁止操作（与当前路由校验对齐）

| 操作 | 条件 | HTTP | 错误码 |
|------|------|------|--------|
| `complete_platform` | status === `pending` | 409 | ASSIGN_013 |
| `complete_platform` / `complete_task` | status === `completed` | 409 | ASSIGN_014 |
| 标记平台完成 | 平台未在任务中配置 | 400 | ASSIGN_015 |
| 重复标记同一平台完成 | 该平台已为 1 | 409 | ASSIGN_016 |
| 被催办/提醒目标 | status === `completed` | 400 | NUDGE_001 |

> **说明：** `complete_task` 为服务端一键完成路径，不适用于上表中「pending 禁止标记平台」的逐平台语义；逐平台路径必须使用 `complete_platform`。

---

## 3. 平台完成标记状态

每个 `*_completed` 字段的状态转换（独立于 Assignment 状态）：

```
0（未完成）──[标记完成]──▶ 1（已完成）（终态，不可撤销）
```

**幂等:** 已完成的平台再次调用 `complete_platform` 且指向同一平台时，返回冲突类错误（见 ASSIGN_016），由客户端避免重复提交。

---

## 4. 状态流转完整时序（示例）

```
总部:    POST /api/v1/tasks
           └─▶ Task{status: draft}

总部:    POST /api/v1/tasks/:id/dispatch
           └─▶ Task{status: dispatched}
           └─▶ Assignment × N {status: pending}
           └─▶ NotificationEvent × N {event_type: task_assigned}

学习端: PUT /api/v1/assignments/:id/status  { "operationType": "start_task" }
           └─▶ Assignment{status: in_progress, started_at: now}

学习端: PUT /api/v1/assignments/:id/status  { "operationType": "complete_platform", "platform": "smartsell" }
           └─▶ Assignment{smartsell_completed: 1, progress: 部分, …}

学习端: PUT /api/v1/assignments/:id/status  { "operationType": "complete_platform", "platform": "mypal" }
           └─▶ Assignment{mypal_completed: 1, …}
           └─▶ [系统检查：所有平台完成？YES]
           └─▶ Assignment{status: completed, completed_at: now}

（或）学习端: PUT /api/v1/assignments/:id/status  { "operationType": "complete_task" }
           └─▶ 一次性置各平台完成 + status: completed（与路径 A 二选一，勿混用重复提交）
```

---

## 5. 错误码速查

| 错误码 | HTTP | 场景 |
|--------|------|------|
| TASK_003 | 409 | 任务已下发，不允许重复下发 |
| TASK_004 | 400 | 任务状态不允许此操作（dispatched 后修改核心字段）|
| ASSIGN_002 | 400 | Assignment 状态不允许（历史语义，具体以接口为准）|
| ASSIGN_003 | 400 | 平台不在任务配置中 |
| ASSIGN_004 | 400 | Assignment 已完成，不允许回退（部分旧逻辑）|
| ASSIGN_013 | 409 | 当前状态不可开始任务 / pending 下禁止 complete_platform |
| ASSIGN_014 | 409 | 任务已完成，禁止重复操作 |
| ASSIGN_015 | 400 | 该任务未配置此平台 |
| ASSIGN_016 | 409 | 该平台已标记完成 |
| NUDGE_001 | 400 | 目标用户任务已完成，不能对其实施提醒类操作 |
