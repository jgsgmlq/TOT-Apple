# Dev1 → Dev2 内部契约文档

**版本:** 1.2.1 | **负责人:** Dev1 | **交付时间:** Day 1 EOD（Day3 / **Day6** 已滚动更新）
**状态:** ✅ P0 契约与实现对齐（含 Day6 Assignments 列表 / 详情 / batch-create）

> 本文档是 Dev2 在 Dev1 代码完成前提前启动的依据。Dev1 完成对应模块后在此处更新。

**产品口径：** 角色、范围、验收以 `docs/product/PRODUCT_REQUIREMENTS.md` 为准。PRD 规定 **P0 不做人工催办**、**店长不设独立管理端**（店长作为学习对象与店员共用学习端）。本文档与接口中的 `NUDGE_` / `nudge` /「催办」等仍为**实现层命名**；链路指标在 PRD 中称 **「提醒转化率」**（定义见 PRD）。

---

## 1. Auth 中间件 — `req.user` 结构

所有受保护路由经过 JWT 验证中间件后，`req.user` 注入以下结构：

```javascript
req.user = {
  id: number,          // users.id（INTEGER）
  username: string,    // 登录用户名
  role: string,        // 'central' | 'store_manager' | 'employee' | 'executive' | 'admin'
  storeId: string | null,    // stores.id，central/executive/admin 为 null
  employeeId: string | null  // employees.id，central/executive/admin 为 null
}
```

**使用方式：**
```javascript
// 引入中间件
const { authenticate } = require('../middleware/auth');

// 路由使用
router.post('/api/v1/tasks/:id/dispatch', authenticate, (req, res) => {
  const { role, storeId } = req.user;
  // ...
});
```

---

## 2. DB Helper 签名

封装位置：`server/db/index.js`（Dev1 实现）

```javascript
// 查询单行，无结果返回 null（同步，better-sqlite3，无需 await）
db.get(sql: string, params: any[]): object | null

// 查询多行，无结果返回 []（同步）
db.all(sql: string, params: any[]): object[]

// 执行写操作（同步）
db.run(sql: string, params: any[]): { lastInsertRowid: number, changes: number }

// 事务包装（同步，fn 内所有 db 操作共享同一事务）
db.transaction(fn: () => void): void
```

> ⚠️ **Dev2 注意：** `better-sqlite3` 是**同步**库，所有 `db.*` 调用直接返回值，**不是 Promise**，请勿使用 `await`。
> 路由回调如需处理异步操作（如 bcrypt），请保留 `async/await`，但 DB 调用本身无需 await。

**使用示例：**
```javascript
const { db } = require('../db');

// 查单条（直接赋值，不用 await）
const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

// 查多条
const assignments = db.all(
  'SELECT * FROM task_assignments WHERE task_id = ?',
  [taskId]
);

// 写入
db.run(
  'UPDATE task_assignments SET status = ?, updated_at = ? WHERE id = ?',
  ['in_progress', new Date().toISOString(), assignmentId]
);
```

---

## 3. 基础数据返回结构

### Task 对象

```typescript
{
  id: string,                  // nanoid
  title: string,
  description: string | null,
  hasMypal: boolean,           // 0/1 → boolean（API 层转换）
  hasSmartSell: boolean,
  hasAiDemo: boolean,
  hasLiveBroadcast: boolean,
  status: 'draft' | 'dispatched',
  targetRole: 'employee' | 'store_manager' | 'both',
  rtmFilter: object[] | null,  // JSON.parse 后
  storeScope: 'all' | string[], // JSON.parse 后
  ddlAt: string,               // ISO 8601
  createdBy: string,
  createdAt: string,           // ISO 8601
  updatedAt: string            // ISO 8601
}
```

### Assignment 对象

```typescript
{
  id: string,                      // nanoid
  taskId: string,
  userId: string,                  // employees.id
  userRole: 'employee' | 'store_manager',
  storeId: string,
  status: 'pending' | 'in_progress' | 'completed',
  mypalCompleted: boolean,
  smartsellCompleted: boolean,
  aiDemoCompleted: boolean,
  liveBroadcastCompleted: boolean,
  progress: number,                // 0–100
  nudgeCount: number,
  receivedAt: string | null,       // ISO 8601
  startedAt: string | null,        // ISO 8601
  completedAt: string | null,      // ISO 8601
  createdAt: string,
  updatedAt: string
}
```

**列表 / 详情（与 `04-API-SPEC` §3.1 / §3.2 对齐，Day6 Dev1）：**

- `GET /api/v1/assignments` 的 `data` 为 `{ list, pagination }`。`list[]` 含 **`assignmentId`**（= `id`）、**`taskAssignedEventId`**（对应 `task_assigned` 通知，无则为 `null`），并保留 **`id`** 兼容旧客户端。
- `GET /api/v1/assignments/:id` 的 `data` 为详情对象，含 **`assignmentId`**、**`taskAssignedEventId`** 及 `startedAt` / `completedAt` / `createdAt` 等。
- 查询参数：`pageNum`（默认 1）、`pageSize`（默认 20，最大 200），以及可选 `taskId`、`status`、`employeeId`、`storeId`（按角色裁剪，见 §3.1）。
- `POST /api/v1/assignments/batch-create`（central/admin）的 `data`：`successCount`、`skippedCount`（已存在 assignment 等跳过）、`failedCount`、`failedUsers`（校验失败明细）。**不**写入 `notification_events`（与 dispatch 路径区分，见 `04-API-SPEC` §3.4）。

**与看板规格：** 门店下钻 KPI 字段定义见 `docs/specs/06-DASHBOARD-KPI.md` §5.6，与 `04-API-SPEC` §5.6 `GET /dashboard/store-detail` 对应。

---

## 4. 统一响应格式

所有接口（成功和失败）统一使用以下结构，与 `04-API-SPEC.md` 保持一致：

**成功响应：**
```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "requestId": "req-20260323120000-123456"
}
```

**失败响应：**
```json
{
  "code": 401,
  "message": "用户名或密码错误",
  "data": null,
  "requestId": "req-20260323120000-123456",
  "errorCode": "AUTH_005"
}
```

`errorCode` 为**可选字段**：业务错误由 `middleware/errorHandler` 在存在 `err.errorCode` 时输出；与 `code`（HTTP 语义对齐）配合使用，便于联调与前端分支。

**`requestId` 生成规则：** `req-{yyyyMMddHHmmss}-{6位随机数}`，在请求进入时由中间件生成并挂到 `req.requestId`。

**HTTP 状态码约定：**

| 场景 | HTTP 状态码 | code 字段 |
|------|------------|----------|
| 成功 | 200 | 200 |
| 参数缺失 / 格式错误 | 400 | 400 |
| 未登录 / Token 无效 | 401 | 401 |
| 权限不足 | 403 | 403 |
| 资源不存在 | 404 | 404 |
| 业务状态冲突（如重复下发）| 409 | 409 |
| 服务器内部错误 | 500 | 500 |

**业务错误码约定（放在 `message` 字段或扩展 `errorCode` 字段）：**

| 前缀 | 对应模块 |
|------|---------|
| `AUTH_` | 认证 / 权限 |
| `TASK_` | 任务相关 |
| `ASSIGN_` | Assignment 相关 |
| `NUDGE_` | 预警/提醒相关（实现层命名，PRD 用语见上） |
| `RTM_` | RTM 筛选相关 |
| `DASH_` / `EVENT_` 等 | 看板 / 事件（以 `04-API-SPEC` 为准） |

---

## 5. 已完成端点清单

> Dev1 完成后勾选，Dev2 可直接使用

- [x] `POST /api/v1/auth/login`
- [x] `GET /api/v1/auth/me` — 当前用户（鉴权联调，需 Bearer Token）
- [x] `GET /api/v1/tasks` — 列表（按 role 过滤）
- [x] `POST /api/v1/tasks` — 创建（central only）
- [x] `GET /api/v1/tasks/:id` — 详情
- [x] `PATCH /api/v1/tasks/:id` — 字段更新（draft 状态，central only）
- [x] `GET /api/v1/assignments` — 分配列表（分页 + 筛选 + `assignmentId` / `taskAssignedEventId`，Day6）
- [x] `GET /api/v1/assignments/:id` — 详情（含 `assignmentId` / `taskAssignedEventId`）
- [x] `POST /api/v1/assignments/batch-create` — §3.4 批量创建（仅写 `task_assignments`，不含通知；Day6）
- [x] `POST /api/v1/assignments` — 创建基础 assignment（central/admin）
- [x] `PATCH /api/v1/assignments/:id` — 更新基础字段（当前仅 nudgeCount，central/admin）
- [x] `DELETE /api/v1/assignments/:id` — 删除 assignment（仅 pending，central/admin）
- [x] `GET /api/v1/stores` — 门店列表（`central` / `admin`）
- [x] `GET /api/v1/stores/:id` — 门店详情
- [x] `POST /api/v1/stores` — 创建门店（central/admin）
- [x] `PATCH /api/v1/stores/:id` — 更新门店（central/admin）
- [x] `DELETE /api/v1/stores/:id` — 删除门店（仅无关联员工）
- [x] `GET /api/v1/employees` — 员工列表（按 storeId 过滤）
- [x] `GET /api/v1/employees/:id` — 员工详情
- [x] `POST /api/v1/employees` — 创建员工（central/admin）
- [x] `PATCH /api/v1/employees/:id` — 更新员工（central/admin）
- [x] `DELETE /api/v1/employees/:id` — 删除员工（无用户/assignment 关联）

### Day 2 Dev1 新增说明（给 Dev2）

- 本次新增均为**基础 CRUD 能力**，未包含 dispatch、状态机、通知、WebSocket、催办、看板聚合逻辑。
- `assignments` 写接口仅用于基础数据维护，状态流转请继续走 Dev2 的状态机端点。
- 删除保护规则：
  - `DELETE /assignments/:id`：仅 `pending` 可删
  - `DELETE /stores/:id`：存在员工关联时拒绝
  - `DELETE /employees/:id`：存在 `users` 或 `task_assignments` 关联时拒绝

---

## 6. 目录结构约定

```
server/
  services/
    assignmentBatch.js ← Dev1：§3.4 批量插入 assignments（无通知）
  db/
    index.js          ← Dev1：DB helper
    schema.sql        ← Dev1：建表脚本
    seed.js           ← Dev1：seed 数据
  middleware/
    auth.js           ← Dev1：JWT 验证，注入 req.user
    errorHandler.js   ← Dev1：统一错误处理
  routes/
    auth.js           ← Dev1
    tasks.js          ← Dev1（CRUD）+ Dev2（dispatch、summary）
    assignments.js    ← Dev1（读、batch-create）+ Dev2（状态机、平台完成）
    notifications.js  ← Dev2
    nudge.js          ← Dev2
    dashboard.js      ← Dev2
    stores.js         ← Dev1
    employees.js      ← Dev1
  app.js              ← 主入口，Dev1 搭架子，Dev2 挂路由
```
