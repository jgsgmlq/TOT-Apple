# TOT Backend 编码规范

> 模块化重构期间强制执行。本文件是 `plans/2026-05-12-modularization-plan.md` §3 的补充。

---

## 1. 三层架构（硬性）

```
Route   → 参数校验 + 调 service + 格式化响应。零 SQL。
Service → 业务逻辑：校验/编排/转换。零 SQL，只调 crud。
Crud   → 纯函数，唯一的数据访问层。所有 SQL 集中在这里。
```

- Route 和 Service 中禁止出现 `db.prepare()`、`db.run()`、`db.exec()` 或 SQL 字符串
- 模块间只能调对方模块的 **Crud**，禁止调对方的 Service
- 动态值必须用 `?` 占位符，禁止 `${}` 拼接 SQL

---

## 2. 文件命名

```
kebab-case 用于目录：  task-publish/  dashboard/  admin/
camelCase  用于文件：  taskCrud.js  taskService.js  taskRoutes.js
```

每个模块统一三个子目录：`crud/`、`services/`、`routes/`

---

## 3. Crud 函数命名与签名

一个模块一个 crud 文件。导出纯函数，不用 class。超过 500 行再拆分。

```js
// 标准操作
function createX(data)                              // → 新建对象
function getXById(id)                               // → object | null
function getXList({ where, orderBy, limit, offset }) // → []
function getXPage({ page, pageSize, where, orderBy }) // → { rows, total, page, pageSize }
function updateX(id, data)                          // → updatedObject | null
function deleteX(id)                                // → boolean
function countX(where)                              // → number

// 聚合查询（仅 dashboardCrud 用）
function query(sql, params)                         // → array
```

函数内部通过 `getDb()` 获取数据库连接（从 `modules/common/db/connection.js` 引入）。

---

## 4. Service 函数命名

```js
// 动词 + 名词，描述业务动作
function publishTask(taskId)           // 发布任务
function calculateProgress(queueId)   // 计算进度
function resolveAudience(filter)      // 解析受众
function validatePermission(user, op) // 校验权限

// 忌：模糊动词（handle*, process*, do*）
```

Service 函数接收业务参数（非 req/res），返回业务结果。抛出的错误由 route 层 catch。

---

## 5. Route Handler 模式

```js
// routes/xxxRoutes.js
const { success, paginated } = require('../../common/responseHelper');

router.get('/api/v1/xxx', async (req, res, next) => {
  try {
    const { page, pageSize } = req.query;
    const result = await xxxService.listXxx({ page, pageSize });
    res.json(paginated(result.rows, { page, pageSize, total: result.total }));
  } catch (err) {
    next(err);  // → errorHandler
  }
});
```

- 参数校验在 route 层做（检查必填、类型、范围）
- 所有 handler 包裹 `try-catch`，错误通过 `next(err)` 交给 errorHandler
- 成功响应用 `responseHelper.js` 的 `success()` / `paginated()` / `fail()`

---

## 6. 统一响应格式

```json
// 成功:  { "code": 200, "message": "success", "data": {...}, "requestId": "..." }
// 列表:  { "code": 200, "data": { "list": [...], "pagination": {...} } }
// 错误:  { "code": 400, "message": "具体错误", "errorCode": "TASK_001", "data": null }
```

使用 `responseHelper.js` 的工具函数，不要手写 JSON。

---

## 7. 错误码规则

```
格式：  {模块前缀}_{三位数字}
模块：  TASK = 任务发布  DASH = 看板  ADMIN = 管理  AUTH = 认证  MYPAL = MyPal
范围：  001-099 参数/校验错误  100-199 业务逻辑错误  200-299 数据/DB 错误

示例：  TASK_001 任务标题为空   DASH_101 指标计算失败   ADMIN_201 账户不存在
```

在 `modules/common/errorCodes.js` 中集中定义常量，route 层引用。

---

## 8. 跨模块引用

```js
// ✅ 正确：只引对方模块的 crud
const { getTaskList } = require('../task-publish/crud/taskCrud');
const { getStoreList } = require('../admin/crud/storeCrud');

// ❌ 禁止：引对方的 service 或直接写 SQL
const { taskService } = require('../task-publish/services/taskService');
db.prepare('SELECT * FROM task_publish').all();
```


**例外：Dashboard 模块**允许在 `dashboardCrud.js` 中跨模块 JOIN 只读查询。约束：
- SQL 集中在一处（`modules/dashboard/crud/dashboardCrud.js`）
- 只做 SELECT，不写
- JOIN 涉及的表必须在表权限总览中 Dashboard 有读权限

---

## 9. 其他

- **不用 class**，导出纯函数和普通对象
- **每个路由文件自己注册 router**（`express.Router()`），`app.js` 只做 `app.use()`
- **不写 console.log**，用 `modules/common/utils/logger.js`
- **新代码不加注释说 WHAT**，命名已经说清楚了；只注释 WHY（非显而易见的决策）
