# 模块架构规范

> 版本：1.0.0 | 日期：2026-05-13 | 分支：modular-base
> 本文档描述模块系统的架构规则。代码级规范见 [`CODING-STANDARDS.md`](../CODING-STANDARDS.md)。

---

## 1. 模块全景

```
                        ┌─────────────────────────┐
                        │      Express app.js      │
                        └────────────┬────────────┘
                                     │ app.use() 挂载各模块 router
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐
     │  task-publish   │   │    dashboard    │   │     admin       │
     │  (6表写)         │   │    (纯分析)      │   │  (10表写)        │
     │                 │   │                │   │                 │
     │ crud ───────────┼───┼─ 跨模块只读 ────┼───┼─ crud(读写)     │
     │ services        │   │ services        │   │ services        │
     │ routes          │   │ routes          │   │ routes          │
     └─────────────────┘   └────────────────┘   └────────┬────────┘
                                                          │
                                                 ┌────────┴────────┐
                                                 │     mypal       │
                                                 │  (1表写)         │
                                                 │                 │
                                                 │ crud            │
                                                 │ services        │
                                                 │ routes          │
                                                 └─────────────────┘

              ┌──────────────────────────────────────────────────┐
              │                    common                         │
              │  db/  middleware/  responseHelper  errorCodes     │
              │  utils/  ws/  crud/auditCrud                      │
              └──────────────────────────────────────────────────┘
```

### 1.1 目录结构

```
server/modules/
├── common/                    # 基础设施，所有模块共享
│   ├── db/connection.js       #   数据库单例 getDb()
│   ├── middleware/             #   auth, requestId, errorHandler, permissions
│   ├── crud/auditCrud.js      #   5 张审计日志表的统一访问
│   ├── utils/                 #   logger, tracer, ai, sseResponse 等
│   ├── ws/                    #   WebSocket manager + ttsRealtime
│   ├── responseHelper.js      #   success(), paginated(), fail()
│   └── errorCodes.js          #   集中错误码常量
├── dashboard/                 # A 域 — 看板分析
│   ├── crud/dashboardCrud.js
│   ├── services/              #   queryEngine, insightService, executiveMetricsService, analyzers/
│   └── routes/                #   dashboardRoutes, insightRoutes
├── task-publish/              # B 域 — 任务发布
│   ├── crud/taskCrud.js
│   ├── services/              #   taskService, audienceService, queueService, reminderService, campaignService
│   └── routes/                #   taskRoutes, queueRoutes, reminderRoutes, campaignRoutes
├── admin/                     # C 域 — 系统管理
│   ├── crud/                  #   accountCrud, storeCrud, learnerCrud, dictCrud
│   ├── services/              #   authService, accountService, storeService, learnerService, dictService
│   └── routes/                #   authRoutes, accountRoutes, storeRoutes, learnerRoutes, dictRoutes
└── mypal/                     # MyPal 学习进度对接
    ├── crud/mypalCrud.js
    ├── services/mypalService.js
    └── routes/mypalRoutes.js
```

### 1.2 表所有权

| 模块 | 拥有表（写权限） | 被读权限 |
|------|-----------------|---------|
| **task-publish** | task_publish, task_audience_rule, learner_task_queue, learner_task_reminder, task_reminder_log, campaign_activity | A |
| **admin** | account, reseller_headquarter, reseller_store, learner_account, dictionary | A, B |
| **mypal** | mypal_learning_progress_sync + 5 张 sync_audit_log | — |
| **dashboard** | 无（纯分析） | — |
| **common** | 5 张 audit_log（审计日志，所有模块共用） | — |

---

## 2. 三层契约

```
Request  →  Route         →  Service       →  Crud          →  DB
           ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
           │ 参数校验      │  │ 业务逻辑      │  │ SQL 查询      │
           │ 调 service    │  │ 编排/转换     │  │ 唯一数据访问   │
           │ 格式化响应     │  │ 调 crud       │  │ 纯函数        │
           │ 零 SQL        │  │ 零 SQL        │  │              │
           └─────────────┘  └─────────────┘  └─────────────┘
```

### 2.1 Route 层

**可以：**
- 从 `req` 提取参数（query, body, params）并校验
- 调 service 函数获取业务结果
- 用 `responseHelper.js` 的 `success()` / `paginated()` / `fail()` 格式化响应
- 用 `try-catch` + `next(err)` 传递错误

**不可以：**
- 写 SQL 或调 `getDb()`
- 直接调 crud（跳过 service）
- 包含业务逻辑（if-else 分支、状态判断等）

### 2.2 Service 层

**可以：**
- 实现业务逻辑：校验、编排、状态机、格式转换
- 调本模块的 crud 和跨模块的 crud
- 抛出业务错误（由 route 的 errorHandler 捕获）

**不可以：**
- 写 SQL 或调 `getDb()`
- 接收 `req` / `res` 对象（参数必须是纯业务数据）
- 调其他模块的 service

### 2.3 Crud 层

**可以：**
- 通过 `getDb()` 获取数据库连接
- 写参数化 SQL（`?` 占位符，禁止 `${}` 拼接）
- 跨模块被其他模块的 service 调用

**不可以：**
- 包含业务逻辑（校验、状态判断、格式转换）
- 调 service 或其他 crud
- 处理 HTTP 请求/响应

### 2.4 硬性规则

1. **Route 和 Service 零 SQL** — 禁止出现 `db.prepare()`、`db.run()`、`db.exec()` 或 SQL 字符串
2. **跨模块只调 Crud** — 禁止调对方模块的 Service，禁止直接操作对方模块的表
3. **参数化查询** — 所有动态值使用 `?` 占位符
4. **Dashboard 例外** — `dashboardCrud.js` 允许跨模块 JOIN 查询，但 SQL 集中在一个文件、只做 SELECT

---

## 3. 基础设施层

### 3.1 db/connection.js — 数据库单例

```js
const { getDb } = require('../common/db/connection');
```

- 懒初始化：首次调用 `getDb()` 时才连接
- 全局单例：所有模块共享同一个数据库连接
- 自动建表：首次初始化执行 `db/schema.sql`
- 自动迁移：`ensure*` / `migrate*` 系列函数处理已有库的增量升级
- WAL 模式 + 外键强制

### 3.2 middleware/ — 中间件链

| 文件 | 导出 | 用途 |
|------|------|------|
| `auth.js` | `authenticate`, `requireRole(role)`, `JWT_SECRET` | JWT 验证 + 角色检查 |
| `requestId.js` | `requestIdMiddleware` | 每个请求生成唯一 ID |
| `errorHandler.js` | `errorHandler`, `createError(status, msg, code)` | 统一错误捕获 + 响应 |
| `permissions.js` | `checkPermission(resource, action)` | 细粒度权限 |

中间件执行顺序（app.js）：
```
requestId → authenticate → 路由 handler → errorHandler
```

### 3.3 responseHelper.js

```js
const { success, paginated, fail } = require('../common/responseHelper');

success(data)            // → { code: 200, message: "success", data }
paginated(list, opts)    // → { code: 200, data: { list, pagination } }
fail(message, code, err) // → { code, message, data: null, errorCode }
```

### 3.4 errorCodes.js

```js
const E = require('../common/errorCodes');

// 规则：{模块前缀}_{三位数字}
// 001-099 参数/校验   100-199 业务逻辑   200-299 数据/DB
// 示例：E.AUTH_001 → { code: 401, message: '未提供认证 Token' }
```

### 3.5 utils/ — 工具集

| 文件 | 用途 |
|------|------|
| `logger.js` | 结构化日志（替换 console.log） |
| `tracer.js` | 请求追踪 |
| `ai.js` | DeepSeek API 调用 + withRetry |
| `sseResponse.js` | SSE 流式响应工具 |
| `ddlAt.js` | 截止时间解析 → SQLite UTC |
| `platforms.js` | 平台常量定义 |
| `redisAdapter.js` | Redis 可选缓存适配器 |

### 3.6 ws/ — WebSocket

| 文件 | 用途 |
|------|------|
| `manager.js` | 连接管理、角色裁剪广播、`broadcastToUsers` / `broadcastToDashboard` |
| `ttsRealtime.js` | 实时 TTS 推送 |

---

## 4. 模块间通信

### 4.1 规则

```
✅ 正确：调对方模块的 crud 纯函数
❌ 禁止：调对方模块的 service
❌ 禁止：直接 db.prepare() 操作对方的表
```

### 4.2 引用路径模式

```js
// B → C（task-publish 引 admin 的 crud）
const storeCrud = require('../admin/crud/storeCrud');
const learnerCrud = require('../admin/crud/learnerCrud');

// A → B（dashboard 引 task-publish 的 crud）
const taskCrud = require('../task-publish/crud/taskCrud');

// A → C（dashboard 引 admin 的 crud）
const { getStoreList } = require('../admin/crud/storeCrud');
const { getLearnerList } = require('../admin/crud/learnerCrud');

// 或直接在 dashboardCrud.js 中跨模块 JOIN（Dashboard 例外）
```

### 4.3 跨模块契约函数

B 提供给 A（只读）：
```
taskCrud.getTaskList({ week, statuses, limit, offset })
taskCrud.getTaskById(id)
taskCrud.getQueueList({ taskId, week, status, storeId, limit })
taskCrud.getReminderList({ week, level, storeId })
taskCrud.getReminderLogStats({ week, groupBy })
taskCrud.getCampaignList({ fiscalYear, quarterNo })
taskCrud.getAudienceRules(taskId)
```

C 提供给 A 和 B（只读）：
```
storeCrud.getStoreList({ region, format, dealer })
storeCrud.getHqList()
learnerCrud.getLearnerList({ storeId })
accountCrud.getAccountList({ role })
accountCrud.getAccountById(id)
```

---

## 5. 模块注册

### 5.1 模块路由文件模式

每个模块的 `routes/` 下的文件导出 `express.Router()`：

```js
// modules/admin/routes/authRoutes.js
const express = require('express');
const router = express.Router();

router.post('/login', (req, res, next) => { ... });
router.get('/me', authenticate, (req, res, next) => { ... });

module.exports = router;
```

### 5.2 app.js 注册

```js
// app.js 中按模块挂载路由
app.use('/api/v1/auth',     require('./modules/admin/routes/authRoutes'));
app.use('/api/v1/accounts', require('./modules/admin/routes/accountRoutes'));
app.use('/api/v1/stores',   require('./modules/admin/routes/storeRoutes'));
app.use('/api/v1/learners', require('./modules/admin/routes/learnerRoutes'));
app.use('/api/v1/tasks',    require('./modules/task-publish/routes/taskRoutes'));
app.use('/api/v1/queues',   require('./modules/task-publish/routes/queueRoutes'));
app.use('/api/v1/reminders',require('./modules/task-publish/routes/reminderRoutes'));
app.use('/api/v1/campaigns',require('./modules/task-publish/routes/campaignRoutes'));
app.use('/api/v1/dashboard',require('./modules/dashboard/routes/dashboardRoutes'));
app.use('/api/v1/mypal',    require('./modules/mypal/routes/mypalRoutes'));
```

### 5.3 中间件顺序

```
requestId → authenticate（公开路径跳过） → 路由 handler → errorHandler
```

---

## 6. 文件规模与拆分

| 层级 | 上限 | 超限处理 |
|------|------|---------|
| 任何文件 | 800 行 | 按职责拆分 |
| Crud 文件 | 500 行建议拆分 | 按表域拆分（如 `taskCrud.js` + `taskReminderCrud.js`） |
| Service 文件 | 500 行建议拆分 | 按业务流程拆分（如 `taskService.js` + `taskDispatchService.js`） |
| Route 文件 | 200 行建议拆分 | 按资源路径拆分 |

### 命名

```
目录： kebab-case    →  task-publish/  dashboard/  admin/
文件： camelCase     →  taskCrud.js  taskService.js  taskRoutes.js
```

---

## 7. 模块生命周期

### 新增模块步骤

1. **创建目录骨架**
   ```
   server/modules/<module-name>/
   ├── crud/
   ├── services/
   └── routes/
   ```

2. **写 Crud** — 按标准函数签名（createX, getXById, getXList, getXPage, updateX, deleteX）实现数据访问

3. **写 Service** — 实现业务逻辑，只调 crud。处理校验、编排、状态转换

4. **写 Route** — 参数校验 → 调 service → `responseHelper` 格式化 → `try-catch` + `next(err)`

5. **注册到 app.js** — 添加 `app.use()` 行

6. **错误码** — 如需新错误码，在 `common/errorCodes.js` 中定义

7. **旧文件改桩** — 将对应的旧文件改为 re-export 新模块的导出

### 旧代码迁移流程

```
1. SQL 提取到 crud        → 纯函数，调 getDb()
2. 业务逻辑提取到 service   → 调 crud，零 SQL
3. 路由重写为 route handler → 参数校验 + 调 service + 响应格式化
4. 旧文件改为桩             → 仅 re-export 新模块
```

---

## 8. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| AI 文档入口 | `../plans/index.md` | 单文件导航，按任务类型指引阅读路径 |
| 编码规范 | `../CODING-STANDARDS.md` | 函数命名、签名、响应格式 |
| 模块化方案 | `../plans/2026-05-12-modularization-plan.md` | 整体方案、模块划分、执行计划 |
| 进度追踪 | `../plans/2026-05-13-modularization-progress.md` | 完成度、Phase 2 待办 |
| Service 层文档 | `09-MODULE-SERVICES.md` | 新模块结构下的服务清单 |
| 看板模块审计 | `07-DASHBOARD-MODULE.md` | modules/dashboard/ 代码质量 |
