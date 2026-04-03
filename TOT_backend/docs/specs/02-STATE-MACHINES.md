# 状态机规格

**版本:** 1.1.0 | **PRD §6.1, §6.2**

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

**触发:** `POST /api/tasks/:id/dispatch`

**权限:** `central` only

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
5. WebSocket 广播 task_dispatched 事件（含 assignmentCount）
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
| `in_progress` | 用户已点击"开始任务" |
| `completed` | 所有配置平台均已完成 |

---

### Transition: `pending → in_progress`

**触发:** `POST /api/assignments/:id/start`

**权限:** Assignment 归属用户（employee 本人）

**Guard:**

```
assignment.status === 'pending'
  → 幂等：若已是 in_progress，直接返回 200（不报错）
  → 若是 completed，返回 HTTP 400，errorCode: ASSIGN_004
```

**Side Effects:**

```
1. assignment.status = 'in_progress'
2. assignment.started_at = now()
3. assignment.updated_at = now()
4. WebSocket 广播 assignment_started 事件
```

---

### Transition: `in_progress → completed`（系统自动触发）

**触发时机:** 每次标记平台完成后，系统自动检查是否满足条件

**条件（AND）:**

```
task.has_mypal / has_smartsell / has_ai_demo / has_live_broadcast 中值为 1 的每个平台，
对应的 assignment.*_completed 均为 1
```

**Guard:**

```
所有配置平台均完成（由系统检查，不由用户手动触发）
```

**Side Effects:**

```
1. assignment.status = 'completed'
2. assignment.completed_at = now()
3. assignment.progress = 100
4. assignment.updated_at = now()
5. WebSocket 广播 assignment_completed 事件
6. 前端侧：已完成的 Assignment 对应的催办通知自动隐藏（前端过滤逻辑）
```

---

### 禁止操作

| 操作 | 条件 | HTTP | 错误码 |
|------|------|------|--------|
| 标记平台完成 | status === 'pending' | 400 | ASSIGN_002 |
| 回退状态 | status === 'completed' | 400 | ASSIGN_004 |
| 被催办 | status === 'completed' | 400 | NUDGE_001 |
| 直接跳转到 completed | 绕过 in_progress | 400 | ASSIGN_002 |

---

## 3. 平台完成标记状态

每个 `*_completed` 字段的状态转换（独立于 Assignment 状态）：

```
0（未完成）──[标记完成]──▶ 1（已完成）（终态，不可撤销）
```

**幂等:** 已完成的平台再次调用标记完成接口，返回 200，不重复计算进度。

---

## 4. 状态流转完整时序

```
总部:    POST /api/tasks           → Task{status: draft}
总部:    POST /api/tasks/:id/dispatch
           └─▶ Task{status: dispatched}
           └─▶ Assignment × N {status: pending}
           └─▶ NotificationEvent × N {event_type: task_assigned}

员工: POST /api/assignments/:id/start
           └─▶ Assignment{status: in_progress, started_at: now}

员工: POST /api/assignments/:id/platforms/smartsell/complete
           └─▶ Assignment{smartsell_completed: 1, progress: 50}

员工: POST /api/assignments/:id/platforms/mypal/complete
           └─▶ Assignment{mypal_completed: 1, progress: 100}
           └─▶ [系统检查：所有平台完成？YES]
           └─▶ Assignment{status: completed, completed_at: now}
```

---

## 5. 错误码速查

| 错误码 | HTTP | 场景 |
|--------|------|------|
| TASK_003 | 409 | 任务已下发，不允许重复下发 |
| TASK_004 | 400 | 任务状态不允许此操作（dispatched 后修改核心字段）|
| ASSIGN_002 | 400 | Assignment 状态不允许（pending 时标记平台 / 回退完成）|
| ASSIGN_003 | 400 | 平台不在任务配置中 |
| ASSIGN_004 | 400 | Assignment 已完成，不允许回退 |
| NUDGE_001 | 400 | 目标用户任务已完成，不能催办 |
