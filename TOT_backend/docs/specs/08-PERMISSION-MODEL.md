# 权限与可见性模型规格

**版本:** 1.3.0 | **PRD §6.5, §2.2** | **更新日期:** 2026-04-13

**相关规格:** [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md)（高管对话与会话归属）、[04-API-SPEC.md](./04-API-SPEC.md)（接口契约正文）

**可信来源:** 以 `TOT_backend/server/routes/*.js`、`middleware/auth.js`、`middleware/permissions.js` 的实现为准；本页矩阵为可读摘要，若与代码不一致以代码为准。

---

## Day2/Day3 实施状态

- ✅ 已落地：任务列表/详情可见性（`central/admin` 全量、`employee` 本人 assignment 关联；`executive` 见下方矩阵）
- ✅ 已落地：`requireTaskAccess`（`GET /api/v1/tasks/:id` 前置）：`central/admin` 放行，`employee` 需存在对应 assignment，其余角色 `403 AUTH_003`
- ✅ 已落地：`POST /api/v1/tasks/:id/dispatch` 为 `central` + `admin`
- ✅ 已落地：Assignment 状态机 `requireAssignmentActor`（`central/admin` 或 assignment 所属 `employee`）

---

## Day4 实施状态（已完成）

- ✅ 已落地：`GET /api/v1/events` — `employee` 仅 `target_user_id = 本人 employeeId`；`central` / `admin` / `executive` **无额外 SQL 过滤**（可拉全表，依赖业务上是否写入面向该角色的事件）
- ✅ 已落地：`GET /api/v1/events/unread-count` — **无 `employeeId` 时直接返回 `unreadCount: 0`**
- ✅ 已落地：`POST /api/v1/assignments/:id/viewed` — 已认证即可；**仅当 `employeeId` 存在时**校验 `assignment.user_id === employeeId`
- ✅ 已落地：`POST /api/v1/nudges` — **`central` 专用**（`admin` / `executive` 不可用）；`POST /api/v1/nudges/ai-generate` 为 `central` + `admin`
- ✅ 已落地：`GET /api/v1/nudges` — **`central` 专用**
- ✅ 已落地：WebSocket `ws` — `employee` 须带 `employeeId`；`central` / **`executive`** / `admin` 进入看板连接池（`dashboardClients`）

---

## Day5 实施状态（看板）

- ✅ 已落地：`GET /api/v1/dashboard/overview`、`heatmap`、`store-rank`、`trend` — `central` + **`executive`** + `admin`
- ✅ 已落地：`GET /api/v1/dashboard/warnings`、`store-detail` — 仅 `central` + `admin`（**`executive` 为 403**）

---

## Day6 实施状态（Executive Chat）

- ✅ 已落地：`/api/v1/chat/executive/*` 全系 `requireRole(['executive'])`；`/api/v1/chat/dashboard/*` 为总部看板机器人对话，`requireRole(['central','admin'])`，与 executive **共用** `chatService` 与数据表；会话与消息归属 `users.id`（详见 [09-EXECUTIVE-CHAT.md](./09-EXECUTIVE-CHAT.md)）

---

## 矩阵图例

| 符号 | 含义 |
|------|------|
| 是 | 允许（按路由白名单与业务逻辑返回数据） |
| 否 | 禁止或未纳入白名单（通常 `403 AUTH_003`） |
| 空 | 允许调用但 **返回空列表 / 零计数**（业务上无数据） |
| 注 | 允许，但无 `employeeId` 时 **不校验资源归属**（见「实现注意事项」） |

---

## 角色定义

| 角色 key | 说明 | username 规范（种子数据） | 典型 JWT `employeeId` |
|---------|------|---------------------------|------------------------|
| `central` | 总部运营，任务创建/派发/催办核心角色 | `central` | `null` |
| `employee` | 店员，仅本人 assignment / 通知 | `emp_E{employeeId}` 或邮箱登录 | 有值 |
| `admin` | 系统管理员：维护门店/员工/部分 AI 与派发能力 | `admin` | `null` |
| `executive` | 高管：聚合看板（子集）+ Executive Chat；**不**承担门店 CRUD、任务编辑、催办 | `executive`、`executive_huadong` 等 | `null` |

`users` 表可为 executive 配置 `executive_regions` / `executive_rtm`（JSON 字符串）；**当前登录 JWT 仅包含** `id, username, role, storeId, employeeId`（见 `routes/auth.js`），区域裁剪若在 Chat 内使用，由服务层读库补充。

---

## API 权限矩阵（摘要）

| 接口 | central | employee | admin | executive |
|------|:-------:|:--------:|:-----:|:---------:|
| POST /api/v1/auth/login | 是 | 是 | 是 | 是 |
| GET /api/v1/auth/me | 是 | 是 | 是 | 是 |
| **任务** | | | | |
| POST /api/v1/tasks | 是 | 否 | 否 | 否 |
| GET /api/v1/tasks | 是（全量） | 是（本人 assignment） | 是（全量） | 空 |
| GET /api/v1/tasks/:id | 是 | 是（本人） | 是 | 否 |
| PATCH /api/v1/tasks/:id | 是 | 否 | 否 | 否 |
| POST /api/v1/tasks/:id/dispatch | 是 | 否 | 是 | 否 |
| POST /api/v1/tasks/ai-*、`auto-nudge` 等 | 见路由 | 否 | 部分（见路由） | 否 |
| **Assignment** | | | | |
| GET /api/v1/assignments | 是（全量） | 是（本人） | 是（全量） | 空 |
| GET /api/v1/assignments/:id | 是 | 是（本人） | 是 | 是 |
| PUT /api/v1/assignments/:id/status | 是 | 是（本人） | 是 | 否 |
| POST /api/v1/assignments/:id/viewed | 注 | 是（本人，有 employeeId 时） | 注 | 注 |
| POST/PATCH …（batch-create、admin patch 等） | 见 `04` | 否 | 部分 | 否 |
| **通知** | | | | |
| GET /api/v1/events/unread-count | 空（0） | 是（本人未读） | 空（0） | 空（0） |
| GET /api/v1/events | 是（无 SQL 过滤） | 是（本人） | 是（无 SQL 过滤） | 是（无 SQL 过滤） |
| POST /api/v1/events | 是 | 否 | 是 | 否 |
| **催办** | | | | |
| POST /api/v1/nudges | 是 | 否 | 否 | 否 |
| GET /api/v1/nudges | 是 | 否 | 否 | 否 |
| **看板** | | | | |
| GET /api/v1/dashboard/overview、heatmap、store-rank、trend | 是 | 否 | 是 | 是 |
| GET /api/v1/dashboard/warnings、store-detail | 是 | 否 | 是 | 否 |
| **基础数据** | | | | |
| GET /api/v1/stores | 是 | 否 | 是 | 否 |
| GET /api/v1/stores/:id | 是 | 是 | 是 | 是 |
| GET /api/v1/employees（含 `?storeId=`） | 是 | 否 | 是 | 否 |
| GET /api/v1/employees/:id | 是 | 是 | 是 | 是 |
| GET /api/health | 是 | 是 | 是 | 是 |
| **Executive Chat** | | | | |
| `/api/v1/chat/executive/*` | 否 | 否 | 否 | 是 |
| `/api/v1/chat/dashboard/*`（总部看板机器人，与 E-chat 同实现） | 是 | 否 | 是 | 否 |

说明：**不存在** `GET /api/v1/tasks/:id/summary` 路由；门店员工列表请使用 **`GET /api/v1/employees?storeId=`**，不要使用已废弃文档路径 `GET /stores/:id/employees`。

---

## 实现注意事项（无 `employeeId` 账号）

对 `central` / `admin` / `executive` 等 **`employeeId` 为 `null`** 的账号，下列接口在代码中 **仅在 `employeeId` 存在时** 才校验「资源是否属于本人」：

- `POST /api/v1/assignments/:id/viewed`

因此这些账号在技术上可写入上述端点所触及的任意 assignment / 事件（依赖产品层是否暴露 UI）。若需收紧，应在路由层显式按角色拒绝或改为使用 `user.id` 维度校验。

---

## 数据可见性规则

### central（总部）

- 任务与 Assignment 全量；可创建/编辑任务、派发、`POST /nudges`
- 可访问全部看板端点（含 `warnings`、`store-detail`）

### admin（系统管理员）

- 任务列表/详情只读全量与 `central` 同级；**创建/编辑任务**仅为 **`central`**（`POST`/`PATCH /tasks`）
- 可 `dispatch`、门店/员工维护、部分 AI 与 batch assignment；**不可** `POST/GET /nudges`（非 `central`）
- 看板权限与 `central` 相同（含 `warnings`）

### employee（店员）

- 仅可见本人 Assignment与 `target_user_id === employeeId` 的通知
- 不可催办他人；不可访问看板聚合接口（`GET /dashboard/*`）

### executive（高管）

- **只读经营向能力：** `dashboard/overview|heatmap|store-rank|trend`；**不可** `warnings`、`store-detail`
- **Executive Chat** 全系接口；**不**参与任务编辑、派发、催办、门店/员工列表维护
- `GET /tasks` 与 `GET /assignments` 列表为空；`GET /tasks/:id` 被 `requireTaskAccess` 拒绝
- 通知列表接口无 SQL 级过滤（与 central类似）；未读数恒为 0

---

## 后端权限校验实现（参考）

### JWT Middleware（`middleware/auth.js`）

```javascript
function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return next(createError(401, '未提供认证 Token', 'AUTH_001'));
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id:         payload.id,
      username:   payload.username,
      role:       payload.role,
      storeId:    payload.storeId ?? null,
      employeeId: payload.employeeId ?? null,
    };
    next();
  } catch (e) {
    next(createError(401, 'Token 无效或已过期', 'AUTH_002'));
  }
}
```

### Role Middleware（`middleware/auth.js`）

```javascript
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return next(createError(403, '权限不足', 'AUTH_003'));
    }
    next();
  };
}

// 示例
router.post('/tasks/:id/dispatch', authenticate, requireRole(['central', 'admin']), dispatchTask);
```

### 任务可见性（`middleware/permissions.js`）

```javascript
function requireTaskAccess(req, res, next) {
  const { role, employeeId } = req.user;
  const { id: taskId } = req.params;

  if (role === 'central' || role === 'admin') return next();

  if (role === 'employee') {
    const row = db.get(
      'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1',
      [taskId, employeeId]
    );
    if (!row) return next(createError(403, '无权查看此任务', 'AUTH_003'));
    return next();
  }

  return next(createError(403, '权限不足', 'AUTH_003'));
}
```

### Assignment 操作者（`routes/assignments.js` 内联）

```javascript
function requireAssignmentActor(req, assignment) {
  const { role, employeeId } = req.user;
  if (role === 'central' || role === 'admin') return;
  if (role === 'employee' && assignment.user_id === employeeId) return;
  throw createError(403, '只能操作本人任务', 'AUTH_003');
}
```

---

## JWT Payload 结构（登录签发）

```json
{
  "id": 2,
  "username": "emp_E001",
  "role": "employee",
  "storeId": "S001",
  "employeeId": "E001",
  "iat": 1711267200,
  "exp": 1711872000
}
```

`executive` / `central` / `admin` 账号通常 `employeeId` 为 `null`。**有效期:** 7 天（`expiresIn: '7d'`）。

---

## 数据过滤规则汇总（与实现对齐）

### GET /api/v1/tasks

- `central` / `admin`：`SELECT * FROM tasks`（无 WHERE）
- `employee`：`tasks` INNER JOIN `task_assignments`，`ta.user_id = employeeId`
- 其他角色（含 `executive`）：返回 `[]`

### GET /api/v1/assignments

- `central` / `admin`：无固定 user过滤（可加 query 筛选）
- `employee`：`ta.user_id = employeeId`
- 其他角色（含 `executive`）：**提前返回空分页**（不进入 SQL 列表查询）

---

## 修订记录

| 版本 | 日期 | 摘要 |
|------|------|------|
| 1.3.0 | 2026-04-13 | 增加 `executive` 角色；对齐任务创建（仅 central）、催办（仅 central）、看板子集、通知/未读行为；补充 Executive Chat；移除不存在的 `tasks/:id/summary`；修正员工列表路径与示例代码 |
| 1.2.0 | 2026-03-27 | 前一版矩阵与片段 |
