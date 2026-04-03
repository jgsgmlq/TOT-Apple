# 权限与可见性模型规格

**版本:** 1.2.0 | **PRD §6.5, §2.2** | **更新日期:** 2026-03-27

---

## Day2/Day3 实施状态

- ✅ 已落地：任务可见性中间件（`central/admin` 全量、`employee` 本人）
- ✅ 已落地：`POST /api/v1/tasks/:id/dispatch` 角色限制（`central/admin`）
- ✅ 已落地：Assignment 状态机 owner 校验（仅本人可操作，`AUTH_003`）
- ⏳ 待落地：通知读回执、催办权限（Day4）→ **见下方 Day4 实施状态**

---

## Day4 实施状态（已完成）

- ✅ 已落地：通知事件接口（`GET/POST /api/v1/events`，employee 仅本人可见，central/admin 不在通知接收方）
- ✅ 已落地：通知已读（`POST /api/v1/events/:id/read`，归属校验：`target_user_id === 当前用户`，错误码 `NOTIF_002`）
- ✅ 已落地：未读数（`GET /api/v1/events/unread-count`，employee 本人）
- ✅ 已落地：任务详情已读打点（`POST /api/v1/assignments/:id/viewed`，Assignment 归属校验）
- ✅ 已落地：催办发起（`POST /api/v1/nudges`，employee 无权否则 `AUTH_003`）
- ✅ 已落地：催办记录查询（`GET /api/v1/nudges`，central 全量）
- ✅ 已落地：WebSocket 鉴权（连接时验证 JWT，无 `employeeId` 的 central/admin 账号不建立 WS 连接）

## Day5 实施状态（已完成）

- ✅ 已落地：看板聚合接口（`GET /api/v1/dashboard/*`，仅 `central/admin` 可全量访问）

---

## 角色定义

| 角色 key | 说明 | username 规范 | 数量 |
|---------|------|-------------|------|
| `central` | 总部运营，全量权限 | `central` | 1 |
| `employee` | 店员，仅本人权限 | `emp_E{employeeId}`| 300 |
| `admin` | 系统管理员，数据维护 | `admin` | 1 |

---

## API 权限矩阵

| 接口 | central | employee | admin |
|------|:-------:|:--------:|:-----:|
| POST /api/login | ✓ | ✓ | ✓ |
| GET /api/me | ✓ | ✓ | ✓ |
| **任务** | | | |
| POST /api/v1/tasks | ✓ | ✗ | ✓ |
| GET /api/v1/tasks | ✓全部 | ✓本人相关 | ✓ |
| GET /api/v1/tasks/:id | ✓ | ✓本人相关 | ✓ |
| PATCH /api/v1/tasks/:id | ✓ | ✗ | ✓ |
| POST /api/v1/tasks/:id/dispatch | ✓ | ✗ | ✓ |
| GET /api/v1/tasks/:id/summary | ✓ | ✗ | ✓ |
| **Assignment** | | | |
| GET /api/v1/assignments | ✓全部 | ✓本人 | ✓ |
| GET /api/v1/assignments/:id | ✓ | ✓本人 | ✓ |
| PUT /api/v1/assignments/:id/status | ✓ | ✓本人 | ✓ |
| POST /api/v1/assignments/:id/viewed | ✗ | ✓本人 | ✓ |
| **通知** | | | |
| GET /api/v1/events/unread-count | ✗ | ✓本人 | ✓ |
| GET /api/v1/events | ✗ | ✓本人 | ✓ |
| POST /api/v1/events | ✓（内部） | ✗ | ✓ |
| POST /api/v1/events/:id/read | ✗ | ✓本人 | ✓ |
| **催办** | | | |
| POST /api/v1/nudges | ✓任意 | ✗ | ✓ |
| GET /api/v1/nudges | ✓全部 | ✗ | ✓ |
| **看板** | | | |
| GET /api/v1/dashboard/overview | ✓全量 | ✗ | ✓ |
| GET /api/v1/dashboard/heatmap | ✓全量 | ✗ | ✓ |
| GET /api/v1/dashboard/store-rank | ✓全量 | ✗ | ✓ |
| GET /api/v1/dashboard/warnings | ✓全量 | ✗ | ✓ |
| GET /api/v1/dashboard/store-detail | ✓全量 | ✗ | ✓ |
| **基础数据** | | | |
| GET /api/v1/stores | ✓全部 | ✗ | ✓ |
| GET /api/v1/stores/:id/employees | ✓全部 | ✗ | ✓ |
| GET /api/v1/employees/:id | ✓全部 | ✓仅本人 | ✓ |
| GET /api/health | ✓ | ✓ | ✓ |

---

## 数据可见性规则

### central（总部）

- 可见所有任务、所有 Assignment、全网统计数据
- 可对任意 employee / store / region 发起催办
- 可查看全体 employee 和 store 数据

### employee（店员）

- 只可见本人的 Assignment（`user_id === 本人 employeeId`）
- 只可见本人的通知
- 不可见其他人的进度
- 不可催办他人

---

## 后端权限校验实现

### JWT Middleware

```javascript
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Token 缺失', errorCode: 'AUTH_002' });
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, storeId, employeeId }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 无效或已过期', errorCode: 'AUTH_002' });
  }
}
```

### Role Middleware

```javascript
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足', errorCode: 'AUTH_003' });

    next();
  };
}

// 使用示例
router.post('/tasks', authenticate, requireRole('central', 'admin'), createTask);
router.post('/tasks/:id/dispatch', authenticate, requireRole('central', 'admin'), dispatchTask);
```

### Assignment 归属校验

```javascript
function requireAssignmentOwner(req, res, next) {
  const assignment = db
    .prepare('SELECT * FROM task_assignments WHERE id = ?')
    .get(req.params.id);

  if (!assignment) {
    return res.status(404).json({ error: 'Assignment 不存在', errorCode: 'ASSIGN_001' });
  }

  const user = req.user;

  if (user.role === 'employee') {
    // 员工只能操作自己的 assignment
    if (assignment.user_id !== user.employeeId) {
      return res.status(403).json({ error: '无权操作', errorCode: 'AUTH_003' });

  }

    // user_id 匹配本人 employeeId 时才允许 start/complete
    const isSelfAction = req.path.includes('/start') || req.path.includes('/platforms');
    if (isSelfAction && assignment.user_id !== user.employeeId) {
      return res.status(403).json({ error: '只能操作本人任务', errorCode: 'AUTH_003' });

  }

  req.assignment = assignment;
  next();
}
```

### 通知归属校验

```javascript
function requireNotificationOwner(req, res, next) {
  const event = db
    .prepare('SELECT * FROM notification_events WHERE id = ?')
    .get(req.params.eventId);

  if (!event) {
    return res.status(404).json({ error: '通知不存在', errorCode: 'NOTIF_001' });
  }

  const userId = req.user.employeeId || String(req.user.id);
  if (event.target_user_id !== userId) {
    return res.status(403).json({ error: '无权操作此通知', errorCode: 'NOTIF_002' });
  }

  req.notificationEvent = event;
  next();
}
```

### 催办权限校验

```javascript
function validateNudgePermission(req, res, next) {
  const { targetType, targetId } = req.body;
  const user = req.user;

  if (user.role === 'employee') {
    return res.status(403).json({ error: '无权发起催办', errorCode: 'AUTH_003' });
  }
  next();
}
```

---

## JWT Payload 结构

```json
{
  "id": 2,
  "username": "emp_E001",
  "storeId": "S001",
  "employeeId": "E001",
  "name": "张三",
  "iat": 1711267200,
  "exp": 1711872000
}
```

**有效期:** 7 天（`expiresIn: '7d'`）

---

## 数据过滤规则汇总

### GET /api/tasks（任务列表）

```javascript
function buildTaskFilter(user) {
  if (user.role === 'central' || user.role === 'admin') {
    return {}; // 无过滤
  }
  
  if (user.role === 'employee') {
    // 返回本人有 assignment 的任务
    return `
      WHERE t.id IN (
        SELECT DISTINCT task_id FROM task_assignments WHERE user_id = ?
      )
    `;
  }
}
```

### GET /api/assignments（Assignment 列表）

```javascript
/**
 * 返回 { sql, params } 使用参数化查询，避免 SQL 注入
 */
function buildAssignmentFilter(user, queryParams) {
  if (user.role === 'employee') {
    return { sql: 'WHERE ta.user_id = ?', params: [user.employeeId] };
  }
    // 默认返回本人自己的 assignments
    return { sql: 'WHERE ta.user_id = ?', params: [user.employeeId] };
  }
  if (user.role === 'central' || user.role === 'admin') {
    return { sql: '', params: [] }; // 无过滤
  }
}
```
