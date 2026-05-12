# TOT Backend 模块化与规范化方案

> 日期：2026-05-12 | 分支：Echat2.0 | 参与人：A B C（3名开发）

---

## 1. 背景与目标

### 1.1 现状

| 指标 | 数值 |
|------|------|
| 后端总代码量 | ~20,800 行 JS（排除 node_modules） |
| 源文件数 | ~90 个 |
| 最大单文件 | `services/chatService.js`（1,105行） |
| 数据库 | SQLite（better-sqlite3），计划大改 |

### 1.2 核心问题

- **SQL 散落**：`db.prepare()` / `db.run()` 分散在 **21 个文件**中
- **Route 里写 SQL**：`routes/tasks.js` 42处、`routes/assignments.js` 38处直接操作数据库
- **无 Service 层**：业务逻辑和数据库访问混在一起
- **无模块边界**：`services/` 29 个文件平铺，`routes/` 14 个文件平铺

### 1.3 目标

1. **所有数据库操作封装为 crud 纯函数**，routes 和 services 中零 SQL
2. **三层架构**：Route（参数校验/响应格式化）→ Service（业务逻辑）→ Crud（数据访问）
3. **按管理员端页面功能划分模块**，每人独立负责前后端
4. Executive Chat 代码**本次不动**

### 1.4 排除范围

```
agent/                    # LangGraph 全图
chat_tools/               # 工具定义
prompts/                  # Prompt 文件
routes/chat.js            # Chat 路由
services/chatService.js, chatAgentRunner.js, chatSessionStateService.js
services/chatMemoryService.js, chatIntentService.js, chatAnswerService.js
services/chatAnalyticsService.js, chatToolsService.js
```

排除量：~8,850 行 | 待模块化：~12,000 行

---

## 2. 核心规范

### 2.1 三层架构（强制）

```
Route    → 参数校验 + 调 service + 格式化响应。零 SQL。
Service  → 业务逻辑：校验/编排/转换。零 SQL，调 crud。
Crud     → 纯函数，唯一的数据访问层。所有 SQL 集中在这里。
```

**硬性规则**：
- Route 和 Service 中禁止出现 `db.prepare()`、`db.run()`、`db.exec()` 或 SQL 字符串
- 模块间只能调对方模块的 **Service**，禁止直接调对方的 Crud
- 所有动态值使用 `?` 参数占位符，禁止 `${}` 拼接 SQL

### 2.2 Crud 文件粒度

**一个模块一个 crud 文件**，不按表拆分。

理由：
- 当前每个模块涉及 2-4 张表，SQL 量有限（最多的 A 模块也只有 tasks 42处 + assignments 38处）
- 合并在一起更内聚，避免 import 路径爆炸
- 将来某个 crud 文件超过 500 行时，再按表拆分，半小时的事

```
modules/task-publish/crud/taskCrud.js    # tasks + task_assignments + stores + employees 的全部 SQL
modules/dashboard/crud/dashboardCrud.js  # dashboard 聚合 + event + nudge 的全部 SQL
modules/admin/crud/userCrud.js           # users 表 SQL（关联 mypal）
```

### 2.3 Crud 函数规范

导出**纯函数**（不用 class），统一签名：

```javascript
// 每个 crud 文件导出以下标准函数：

// 创建 → 返回新建对象
function createX(data)

// 查询单个 → object | null
function getXById(id)

// 查询列表 → []
function getXList({ where, orderBy, limit, offset })

// 分页 → { rows, total, page, pageSize }
function getXPage({ page, pageSize, where, orderBy })

// 更新（只更新传入字段）→ updatedObject | null
function updateX(id, data)

// 删除 → boolean
function deleteX(id)

// 计数 → number
function countX(where)

// 原始查询 → array（仅复杂聚合场景使用）
function query(sql, params)
```

### 2.4 统一 API 响应格式

```json
// 成功
{ "code": 200, "message": "success", "data": {...}, "requestId": "..." }

// 列表
{ "code": 200, "data": { "list": [...], "pagination": { "page":1, "pageSize":20, "total":150 } } }

// 错误
{ "code": 400, "message": "具体错误", "errorCode": "TASK_001", "data": null }
```

---

## 3. 迁移示例（routes/tasks.js 改造）

### 迁移前

```javascript
// ❌ Route 中直接写 SQL
router.put('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ code: 404, message: 'task not found' });
  db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?')
    .run(req.body.title, new Date().toISOString(), req.params.id);
  res.json({ code: 200, data: { ...task, title: req.body.title } });
});
```

### 迁移后

```javascript
// Route 层 — 只做参数校验 + 调 service + 响应
router.put('/tasks/:id', (req, res) => {
  const result = taskService.updateTask(req.params.id, req.body);
  res.json({ code: 200, data: result });
});
```

```javascript
// Service 层 — 业务逻辑，零 SQL
function updateTask(id, data) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw new AppError('task not found', 404, 'TASK_NOT_FOUND');
  if (task.status === 'dispatched' && data.deadline === undefined) {
    throw new AppError('已下发的任务只能修改截止时间', 400, 'TASK_DISPATCHED');
  }
  return taskCrud.updateTask(id, { ...data, updatedAt: new Date().toISOString() });
}
```

```javascript
// Crud 层 — 纯数据访问，所有 SQL 集中在这里
function updateTask(id, data) {
  const db = getDb();
  const keys = Object.keys(data);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => data[k]);
  db.prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`).run(...values, id);
  return getTaskById(id);
}
```

---

## 4. 三人分工（按管理员端页面）

### 4.1 管理员端页面全景

| 路由 | 页面 | 功能 | 归属 |
|------|------|------|------|
| `/central/task/publish` | 任务发布 | 创建/编辑/下发培训任务 | **A** |
| `/central/board` | 实时看板 | 总部数据大屏 | **B** |
| `/system/menu` | 菜单权限 | 菜单管理（骨架代码） | **C** |
| `/system/role` | 角色权限 | 角色管理（骨架代码） | **C** |
| `/setting/account` | 个人设置 | 密码修改等 | **C** |
| `/setting/system` | 系统设置 | 系统配置 | **C** |
| C 新增页面 | 用户管理/门店管理等 | 新增管理功能 | **C** |

---

### 4.2 Developer A — 任务发布模块

**负责的管理页面**：`/central/task/publish`

#### 目录结构

```
modules/task-publish/
├── crud/
│   └── taskCrud.js             # tasks + task_assignments + stores + employees 的全部 SQL
├── services/
│   ├── taskService.js          # 任务模板管理、状态机
│   ├── assignmentService.js    # 下发、批量分配、进度（合并 assignmentBatch + assignmentProgress）
│   └── smartPublishService.js  # 智能下发规则
├── routes/
│   ├── taskRoutes.js           # /api/v1/tasks/*
│   ├── assignmentRoutes.js     # /api/v1/assignments/*
│   ├── storeRoutes.js          # /api/v1/stores/*
│   └── employeeRoutes.js       # /api/v1/employees/*
```

#### 前端归属

```
views/central/taskManage/index.vue        # 任务发布页
api/task/index.ts                         # 任务 API
api/assignment/index.ts                   # 下发 API
```

#### 来源文件映射

| 新文件 | 来源 | 行数 |
|--------|------|------|
| `crud/taskCrud.js` | 从 `routes/tasks.js`(42处SQL) + `routes/assignments.js`(38处SQL) + `routes/stores.js` + `routes/employees.js` 提取全部 SQL | ~250 |
| `services/taskService.js` | 从 `routes/tasks.js` 提取业务逻辑 | 新写 |
| `services/assignmentService.js` | 合并 `services/assignmentBatch.js` + `assignmentProgress.js` | ~200 |
| `services/smartPublishService.js` | `services/taskSmartPublishService.js` | 218 |
| `routes/taskRoutes.js` | `routes/tasks.js` 去 SQL | 726→~400 |
| `routes/assignmentRoutes.js` | `routes/assignments.js` 去 SQL | 679→~350 |
| `routes/storeRoutes.js` | `routes/stores.js` | ~60 |
| `routes/employeeRoutes.js` | `routes/employees.js` | 142 |

#### 拥有的表（写权限）

`tasks`、`task_assignments`、`stores`、`employees`、`mypal_learning_mock`

---

### 4.3 Developer B — 实时看板模块

**负责的管理页面**：`/central/board`

**Agent 部分本次不做**：`dashboardAgentService.js`、`dashboardAgentScheduler.js` 保持不动

#### 目录结构

```
modules/dashboard/
├── crud/
│   └── dashboardCrud.js        # 聚合查询 + notification_events + read_receipts + nudge_records
├── services/
│   ├── queryEngine.js          # 核心查询引擎（from dashboardQueryCore.js 去SQL）
│   ├── insightService.js       # 洞察数据（from dashboardInsightService.js 去SQL）
│   ├── notificationService.js  # 通知事件
│   ├── nudgeService.js         # Nudge 业务
│   └── analyzers/              # 漏斗/趋势/预警/RTM/区域/shared
├── routes/
│   ├── dashboardRoutes.js      # /api/v1/dashboard/overview|warnings|trend|heatmap
│   ├── eventRoutes.js          # /api/v1/events/*
│   └── nudgeRoutes.js          # /api/v1/nudges/*
```

#### 前端归属

```
views/central/newBoard/index.vue           # 实时看板页
api/dashboard/index.ts                     # Dashboard API
api/event/index.ts                         # 通知事件 API
```

#### 来源文件映射

| 新文件 | 来源 | 行数 |
|--------|------|------|
| `crud/dashboardCrud.js` | 从 `services/dashboardQueryCore.js`(18处SQL) + `dashboardInsightService.js`(28处SQL) + `routes/notifications.js` + `routes/nudge.js` + `autoNudge.js` 提取全部 SQL | ~300 |
| `services/queryEngine.js` | `services/dashboardQueryCore.js` 去 SQL | 792→~500 |
| `services/insightService.js` | `services/dashboardInsightService.js` 去 SQL | 759→~450 |
| `services/notificationService.js` | 从 `routes/notifications.js` 提取 | 新写 |
| `services/nudgeService.js` | 从 `routes/nudge.js` + `services/autoNudge.js` 提取 | 新写 |
| `services/analyzers/*` | `services/dashboardSubAgents/*`（7文件） | 762 |
| `routes/dashboardRoutes.js` | `routes/dashboard.js` + `dashboardInsights.js` | ~270 |
| `routes/eventRoutes.js` | `routes/notifications.js` 去 SQL | 284→~150 |
| `routes/nudgeRoutes.js` | `routes/nudge.js` 去 SQL | 285→~150 |

#### 排除的 Agent 部分

```
services/dashboardAgentService.js       # B 后续再做
routes/dashboardAgent.js
jobs/dashboardAgentScheduler.js
agent/skills/dashboardDiagnose.js
agent/tools/dashboardTools.js
```

#### 拥有的表（写权限）

`notification_events`、`read_receipts`、`nudge_records`、`dashboard_insights`

#### 对 A 的依赖（只读）

通过 A 的 `taskCrud.getTaskList()` / `taskCrud.getAssignments()` 读取任务数据

---

### 4.4 Developer C — 系统管理 + 新增页面 + 基础设施

**负责的管理页面**：`/system/*`、`/setting/*`、新开发的管理端页面

#### 目录结构

```
modules/admin/
├── crud/
│   └── userCrud.js             # users 表
├── services/
│   ├── authService.js          # 登录验证、JWT 签发
│   └── userService.js          # 用户/角色管理
├── routes/
│   ├── authRoutes.js           # /api/v1/auth/*
│   ├── userRoutes.js           # /api/v1/users/*（新增）
│   ├── roleRoutes.js           # /api/v1/roles/*（新增）
│   └── menuRoutes.js           # /api/v1/menus/*（新增）

modules/mypal/
├── crud/mypalCrud.js
├── services/mypalService.js    # 合并 client + link + sign + sync
└── routes/mypalRoutes.js       # 合并 mypal + mypalMock

modules/common/
├── db/
│   ├── connection.js           # 唯一 DB 连接（从 db/index.js 拆出）
│   ├── schema.sql
│   ├── seed.js
│   └── migrations/             # 为数据库大改准备
├── middleware/
│   ├── auth.js                 # JWT 中间件（产出 req.user）
│   ├── permissions.js
│   ├── errorHandler.js
│   └── requestId.js
├── utils/
│   ├── logger.js
│   ├── sse.js
│   ├── tracer.js
│   ├── redis.js
│   ├── dateUtils.js
│   └── ...
├── ws/
│   ├── manager.js
│   └── ttsRealtime.js

app.js                           # C 统一管理路由挂载
```

#### 前端归属

```
views/system/menu/                         # 菜单管理
views/system/role/                         # 角色管理
views/system/user/                         # 用户管理（新增）
views/login/index.vue                      # 登录页
api/system/user.ts                         # 用户 API
api/system/role.ts                         # 角色 API
api/system/menu.ts                         # 菜单 API
router/guards.ts                           # 路由守卫
store/modules/user.ts                      # 用户状态
```

#### 来源文件映射

| 新文件 | 来源 | 行数 |
|--------|------|------|
| `admin/crud/userCrud.js` | 从 `routes/auth.js` + `db/index.js` 提取 SQL | ~80 |
| `admin/services/authService.js` | 从 `routes/auth.js` 提取 | 新写 |
| `admin/services/userService.js` | 新写 | 新写 |
| `admin/routes/authRoutes.js` | `routes/auth.js` 去 SQL | 120→~60 |
| `admin/routes/userRoutes.js` | 新写 | 新写 |
| `admin/routes/roleRoutes.js` | 新写 | 新写 |
| `admin/routes/menuRoutes.js` | 新写 | 新写 |
| `mypal/crud/mypalCrud.js` | 从 `services/mypalSyncService.js` 提取 SQL | ~60 |
| `mypal/services/mypalService.js` | 合并 4 个 mypal service 文件 | ~560 |
| `mypal/routes/mypalRoutes.js` | 合并 `routes/mypal.js` + `mypalMock.js` | ~250 |
| `common/db/connection.js` | 从 `db/index.js` 拆出连接管理 | ~100 |
| `common/db/schema.sql` | `db/schema.sql` | ~200 |
| `common/db/seed.js` | `db/seed.js` | 695 |
| `common/middleware/*` | `middleware/*` | ~150 |
| `common/utils/*` | `utils/*`（10文件） | ~2,000 |
| `common/ws/*` | `ws/*` | ~360 |
| `app.js` | `app.js` | 188 |

#### 拥有的表（写权限）

`users`

---

## 5. 依赖关系

```
                   Developer C（基础设施 + 系统管理）
                   db连接 | 中间件 | utils | app.js
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
      Developer A              Developer B
      （任务发布）                （实时看板）
      taskCrud.js ──────────► dashboardCrud.js（只读）
```

### 协作界面

| 接口 | 提供者 | 消费者 | 说明 |
|------|--------|--------|------|
| `getDb()` | C | A, B | 数据库连接单例 |
| `middleware/auth.js` | C | A, B | `req.user` 结构 |
| `taskCrud.getTaskList()` | A | B | Dashboard 读任务数据（只读） |
| `taskCrud.getAssignmentList()` | A | B | Dashboard 读下发数据（只读） |
| `taskCrud.getStoreList()` | A | B, C | 读门店列表 |
| `taskCrud.getEmployeeList()` | A | B, C | 读员工列表 |
| `userCrud.getUserById()` | C | A, B | 读用户信息 |
| `app.js` 路由挂载 | C | A, B | A/B 产出 router，C 挂载 |
| `logger.js` | C | A, B | 统一日志 |

### 表权限总览

| 表 | 写 | 读 |
|-----|----|-----|
| `tasks` | A | A, B |
| `task_assignments` | A | A, B |
| `stores` | A | A, B, C |
| `employees` | A | A, B, C |
| `mypal_learning_mock` | A | A |
| `notification_events` | B | B |
| `read_receipts` | B | B |
| `nudge_records` | B | B |
| `dashboard_insights` | B | B |
| `users` | C | C, A, B |
| `chat_*` | — | 排除 |

---

## 6. 执行计划

### Phase 1：基础设施（Week 1）

| 谁 | 任务 | 交付物 |
|-----|------|------|
| C | 创建 `modules/` 目录骨架 | 目录结构 |
| C | 从 `db/index.js` 拆出 `common/db/connection.js`，保留 `db/index.js` 向后兼容 | `getDb()` 单例 |
| A | 写 `taskCrud.js` 样板（完整 SQL 迁移），作为其他模块参考 | 样板 + 规范对齐 |
| B | 列出 dashboard 侧需要的全部 SQL 查询，对照 A 的样板 | 查询清单 |
| C + A | 确定 crud 函数命名/签名，形成一页纸规范 | 规范文档 |

### Phase 2：SQL 下沉 + Service 编写（Week 2-3）

| 谁 | 任务 |
|-----|------|
| A | 完成 `taskCrud.js` 全部 SQL；编写 `taskService.js`、`assignmentService.js`；routes 去 SQL |
| B | 完成 `dashboardCrud.js` 全部 SQL；编写 Service 层；routes 去 SQL |
| C | 完成 `userCrud.js`、`mypalCrud.js`；编写 auth/user/mypal service；新增 C 的管理页面后端 API |

### Phase 3：整合与回归（Week 4）

| 谁 | 任务 |
|-----|------|
| C | `app.js` 改为 `modules/` 路径加载；旧目录加 `index.js` 做兼容重导出 |
| A | 任务发布全链路回归（创建→下发→店员完成） |
| B | 实时看板数据回归（概览/趋势/预警/通知 正确性） |
| C | 认证 + 权限回归 |

---

## 7. Git 分支

```
Echat2.0
  └── modular-base        # C 创建（Week 1）
        ├── modular-task   # A
        ├── modular-board  # B
        └── modular-admin  # C
```

C 先建 `modular-base`（骨架 + connection.js + 样板 crud），A/B/C 各从 base 切分支，最终合回 base，再 MR 到 Echat2.0。

---

## 8. 风险

| 风险 | 缓解措施 |
|------|----------|
| `db/index.js` 660行被大量引用，拆 connection.js 可能破环 | Phase 1 保留 `db/index.js` 重导出，逐步迁移 |
| `dashboardQueryCore.js` 792行 SQL 在迁移中可能引入查询 bug | B 先写测试锁定当前输出，SQL 原样移动 |
| `routes/tasks.js` 42处 SQL 与业务逻辑交织 | A 优先处理 tasks.js，验证模式可行后再推其他文件 |
| 多人改 import 路径导致合并冲突 | Phase 3 由 C 统一做路径切换 |
| Executive Chat 依赖 `db/index.js` | 保持 `db/index.js` 向后兼容 |

---

## 9. 附录：文件清单

### 待模块化（~50 个源文件，~12,000 行）

**→ A（10 个文件）**
```
routes/tasks.js (726)  routes/assignments.js (679)  routes/stores.js (~60)
routes/employees.js (142)  services/taskSmartPublishService.js (218)
services/assignmentBatch.js  services/assignmentProgress.js
middleware/auth.js (~100)  middleware/permissions.js (~50)
db/index.js（task/assignment/store/employee 相关 SQL）
```

**→ B（13 个文件）**
```
routes/dashboard.js (187)  routes/dashboardInsights.js (~80)  routes/notifications.js (284)
routes/nudge.js (285)  services/dashboardQueryCore.js (792)  services/dashboardInsightService.js (759)
services/executiveMetricsQueryService.js (235)  services/dashboardSubAgents/* (7文件, 762)
services/autoNudge.js (230)  services/autoNudgeRules.js (~120)
db/index.js（dashboard/event/nudge 相关 SQL）
```

**→ C（27 个文件）**
```
routes/auth.js (120)  routes/mypal.js (~80)  routes/mypalMock.js (175)
routes/asr.js (~80)  services/asrService.js (~100)  services/mypalClient.js (150)
services/mypalLink.js (~80)  services/mypalSign.js (~80)  services/mypalSyncService.js (249)
middleware/* (4文件)  db/index.js (660)  db/schema.sql  db/seed.js (695)
utils/* (10文件, ~2,000)  ws/* (2文件, ~360)  app.js (188)  scripts/* (15文件)
```

### 保持不变

```
agent/  chat_tools/  prompts/  routes/chat.js
services/chatService.js  chatAgentRunner.js  chatSessionStateService.js
chatMemoryService.js  chatIntentService.js  chatAnswerService.js
chatAnalyticsService.js  chatToolsService.js
dashboardAgentService.js  routes/dashboardAgent.js
jobs/dashboardAgentScheduler.js
```
