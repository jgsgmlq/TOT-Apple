# Phase 3: Read Data Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增后端 Read API 路由（stores/stats/alerts/tasks/employees），并将 `data.js` 改为异步 Adapter，使三端数据从 SQLite 动态加载，不再使用硬编码 Mock 数据。

**Architecture:** 后端新增 5 个路由文件（routes/stores.js、routes/stats.js、routes/alerts.js、routes/tasks.js、routes/employees.js），并在 index.js 注册；前端 data.js 保留所有硬编码的时间轴/Trade-in/情报数据，将 STORES/ALL_EMPLOYEES/ALERTS/TRAINING_TASK 四个数据集改为 API 获取；三个 HTML 的 `renderXxx()` 初始化调用改为等待 `AppData.init()` 完成后执行。

**Prerequisites:** Phase 1（SQLite + seed）和 Phase 2（JWT 鉴权）均已完成，服务器可用 `cd /Users/skyler/Desktop/MVP/server && node index.js` 正常启动。

**Tech Stack:** better-sqlite3（已安装），jsonwebtoken（已安装）

---

## Preflight: 检查前置条件

```bash
test -f /Users/skyler/Desktop/MVP/server/db.js && echo "db.js OK" || echo "ABORT: Phase 1 incomplete"
test -f /Users/skyler/Desktop/MVP/server/auth.js && echo "auth.js OK" || echo "ABORT: Phase 2 incomplete"
test -f /Users/skyler/Desktop/MVP/server/routes/login.js && echo "login.js OK" || echo "ABORT: Phase 2 incomplete"
test -f /Users/skyler/Desktop/MVP/front-end/js/auth.js && echo "front-end auth.js OK" || echo "ABORT: Phase 2 incomplete"
```

Expected: 四行均输出 `OK`。若有 `ABORT`，停止并先完成对应 Phase。

```bash
# 验证 auth.js 导出了 requireRole（employees.js 需要它）
cd /Users/skyler/Desktop/MVP/server && node -e "const a = require('./auth'); console.log('auth exports:', Object.keys(a))"
```

Expected: 输出包含 `requireRole`（例如 `[ 'authMiddleware', 'signToken', 'requireRole' ]`）。

```bash
# 验证 index.js 已注册 authMiddleware（Phase 2 完成标志）
grep -q "authMiddleware" /Users/skyler/Desktop/MVP/server/index.js && echo "authMiddleware registered OK" || echo "ABORT: authMiddleware not in index.js — complete Phase 2 first"
```

Expected: `authMiddleware registered OK`。

---

## Chunk 1: 后端修复与新路由

### Task 1: 修复 login.js — employee 用户 JWT 携带 storeId

**Files:**
- Modify: `server/routes/login.js`

**问题：** 员工用户（role=employee）的 `users.store_id` 为 NULL（employees 表有 store_id 而 users 表没有）。login.js 当前用 `user.store_id` 构建 JWT，导致员工 token 中 `storeId: null`，使 data.js 的 init() 无法知道调用哪个 store 的 employees API。

- [ ] **Step 1: 在签发 token 之前补充 storeId 查询**

在 `server/routes/login.js` 的 `// 查询显示名称` 代码块之前插入（在 `const valid = bcrypt.compareSync(...)` 验证通过之后）：

```javascript
  // 若 employee 角色，storeId 从 employees 表查取
  let resolvedStoreId = user.store_id || null;
  if (!resolvedStoreId && user.employee_id) {
    const empRow = db.prepare('SELECT store_id FROM employees WHERE id = ?').get(user.employee_id);
    if (empRow) resolvedStoreId = empRow.store_id;
  }
```

然后将 payload 中的 `storeId: user.store_id || null` 改为 `storeId: resolvedStoreId`:

```javascript
  const payload = {
    id: user.id,
    role: user.role,
    storeId: resolvedStoreId,
    employeeId: user.employee_id || null,
    name,
  };
```

- [ ] **Step 2: 验证员工登录返回的 token 含 storeId**

```bash
pkill -f "node index.js" 2>/dev/null || true; sleep 1; cd /Users/skyler/Desktop/MVP/server && nohup node index.js > /tmp/mvp-server.log 2>&1 & curl -s --retry 8 --retry-connrefused --retry-delay 1 http://localhost:8080/api/health
```

```bash
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"emp_E005","password":"Train2026!"}'
```

Expected: 响应中 `storeId` 为 `"S001"`（非 null），`employeeId` 为 `"E005"`，`role` 为 `"employee"`。

```bash
pkill -f "node index.js" 2>/dev/null || true
```

---

### Task 2: 创建 server/routes/stores.js

**Files:**
- Create: `server/routes/stores.js`

- [ ] **Step 1: 创建 stores.js**

```javascript
// server/routes/stores.js
// 职责：GET /api/stores（按 role 过滤）、GET /api/stores/:id/employees（含 computed 字段）

const express = require('express');
const db = require('../db');
const router = express.Router();

function formatStore(s) {
  return {
    id: s.id, name: s.name, region: s.region,
    rtm: s.rtm, city: s.city, rank: s.rank,
    riskLevel: s.risk_level,
  };
}

function formatEmployee(emp, store, jwtEmployeeId) {
  const allDone = emp.sc_modules >= 28 && emp.live_watched === 1
    && emp.mypal_days >= 1 && emp.ai_coach >= 6;
  const passTest = emp.sc_test >= 80;
  return {
    id: emp.id,
    storeId: emp.store_id,
    storeName: store ? store.name : '',
    name: emp.name,
    role: emp.role,
    isManager: emp.is_manager === 1,
    region: store ? store.region : '',
    rtm: store ? store.rtm : '',
    scModules: emp.sc_modules,
    scTest: emp.sc_test,
    liveWatched: emp.live_watched === 1,
    mypalDays: emp.mypal_days,
    aiCoach: emp.ai_coach,
    allDone,
    passTest,
    reached: emp.live_watched === 1 && emp.mypal_days >= 1,
    passed: allDone && passTest,
    riskLevel: emp.risk_level,
    lastActive: emp.last_active,
    isSelf: jwtEmployeeId ? emp.id === jwtEmployeeId : false,
  };
}

// GET /api/stores
// central/admin: 全量 50 家；store/employee: 仅自己 storeId 的门店（1条）
router.get('/stores', (req, res) => {
  const user = req.user;
  let rows;
  if (user.role === 'store' || user.role === 'employee') {
    rows = db.prepare('SELECT * FROM stores WHERE id = ? ORDER BY rank').all(user.storeId);
  } else {
    rows = db.prepare('SELECT * FROM stores ORDER BY rank').all();
  }
  res.json(rows.map(formatStore));
});

// GET /api/stores/:id/employees
// store/employee 只能查询自己 storeId 的员工
router.get('/stores/:id/employees', (req, res) => {
  const user = req.user;
  const storeId = req.params.id;

  if ((user.role === 'store' || user.role === 'employee') && user.storeId !== storeId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) return res.status(404).json({ error: 'Not found' });

  const emps = db.prepare('SELECT * FROM employees WHERE store_id = ? ORDER BY is_manager DESC, id').all(storeId);
  res.json(emps.map(e => formatEmployee(e, store, user.employeeId)));
});

module.exports = { router, formatEmployee, formatStore };
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const { router } = require('./routes/stores'); console.log('stores router OK:', typeof router)"
```

Expected: `stores router OK: function`

---

### Task 3: 创建 server/routes/stats.js

**Files:**
- Create: `server/routes/stats.js`

- [ ] **Step 1: 创建 stats.js**

```javascript
// server/routes/stats.js
// 职责：GET /api/stats — 从 employees 表实时聚合统计数据
// 返回结构与原 data.js calcStats() 完全一致

const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/stats', (req, res) => {
  const emps = db.prepare(
    'SELECT sc_modules, sc_test, live_watched, mypal_days, ai_coach, risk_level FROM employees'
  ).all();
  const total = emps.length;
  if (total === 0) {
    return res.json({ totalEmployees: 0, totalStores: 0 });
  }

  const passed = emps.filter(e => {
    const allDone = e.sc_modules >= 28 && e.live_watched === 1
      && e.mypal_days >= 1 && e.ai_coach >= 6;
    return allDone && e.sc_test >= 80;
  }).length;
  const reached = emps.filter(e => e.live_watched === 1 && e.mypal_days >= 1).length;
  const p1Count = emps.filter(e => e.risk_level === 'p1').length;
  const p2Count = emps.filter(e => e.risk_level === 'p2').length;
  const scAvg   = Math.round(emps.reduce((s, e) => s + e.sc_modules, 0) / total / 28 * 100);
  const liveAvg = Math.round(emps.filter(e => e.live_watched === 1).length / total * 100);
  const mypalAvg = Math.round(emps.filter(e => e.mypal_days >= 1).length / total * 100);
  const aiAvg   = Math.round(emps.reduce((s, e) => s + e.ai_coach, 0) / total / 6 * 100);

  const { c: totalStores } = db.prepare('SELECT COUNT(*) as c FROM stores').get();

  res.json({
    totalEmployees: total,
    totalStores,
    passRate:  Math.round(passed / total * 100),
    reachRate: Math.round(reached / total * 100),
    overallCompletion: Math.round((scAvg + liveAvg + mypalAvg + aiAvg) / 4),
    p1Count, p2Count,
    alertCount: p1Count + Math.floor(p2Count / 3),
    scCompletion: scAvg,
    liveCompletion: liveAvg,
    mypalCompletion: mypalAvg,
    aiCoachCompletion: aiAvg,
    intelReturnRate: 68, // MVP 阶段硬编码，intel_submissions 入库后可改为动态计算
    passed,
    reached,
  });
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/stats'); console.log('stats router OK:', typeof r)"
```

Expected: `stats router OK: function`

---

### Task 4: 创建 server/routes/alerts.js

**Files:**
- Create: `server/routes/alerts.js`

- [ ] **Step 1: 创建 alerts.js**

```javascript
// server/routes/alerts.js
// 职责：GET /api/alerts（role 过滤：central/admin 全量，store 仅自己门店）

const express = require('express');
const db = require('../db');
const router = express.Router();

function formatAlert(a) {
  const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(a.store_id);
  let employeeName;
  if (a.employee_id) {
    const emp = db.prepare('SELECT name FROM employees WHERE id = ?').get(a.employee_id);
    employeeName = emp ? emp.name : a.employee_id;
  } else {
    const { c } = db.prepare('SELECT COUNT(*) as c FROM employees WHERE store_id = ?').get(a.store_id);
    employeeName = `全员(${c}人)`;
  }

  let aiSuggestions;
  try { aiSuggestions = JSON.parse(a.suggestions_json); } catch { aiSuggestions = []; }
  let intervention;
  try { intervention = JSON.parse(a.intervention_json); } catch { intervention = {}; }

  return {
    id: a.id,
    level: a.level,
    storeId: a.store_id,
    storeName: store ? store.name : '',
    employeeId: a.employee_id || null,
    employeeName,
    trigger: a.trigger_desc,
    rootCause: a.root_cause,
    aiSuggestions,
    status: a.status,
    createdAt: a.created_at,
    acknowledgedBy: a.acknowledged_by || null,
    acknowledgedAt: a.acknowledged_at || null,
    intervention,
  };
}

router.get('/alerts', (req, res) => {
  const user = req.user;
  let rows;
  if (user.role === 'store') {
    rows = db.prepare('SELECT * FROM alerts WHERE store_id = ? ORDER BY created_at DESC').all(user.storeId);
  } else {
    rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
  }
  res.json(rows.map(formatAlert));
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/alerts'); console.log('alerts router OK:', typeof r)"
```

Expected: `alerts router OK: function`

---

### Task 5: 创建 server/routes/tasks.js

**Files:**
- Create: `server/routes/tasks.js`

- [ ] **Step 1: 创建 tasks.js**

```javascript
// server/routes/tasks.js
// 职责：GET /api/tasks（返回 active 任务列表）

const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/tasks', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC'
  ).all('active');
  res.json(rows.map(t => {
    let config;
    try { config = JSON.parse(t.config_json); } catch { config = {}; }
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      deadline: t.deadline,
      targetRole: t.target_role,
      storeScope: t.store_scope,
      createdBy: t.created_by,
      createdAt: t.created_at,
      config,
    };
  }));
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/tasks'); console.log('tasks router OK:', typeof r)"
```

Expected: `tasks router OK: function`

---

### Task 6: 创建 server/routes/employees.js

**Files:**
- Create: `server/routes/employees.js`

- [ ] **Step 1: 创建 employees.js**

```javascript
// server/routes/employees.js
// 职责：GET /api/employees（central/admin 全量，含过滤）、GET /api/employees/:id

const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');  // auth.js 必须导出 requireRole（Phase 2 实现）
const { formatEmployee } = require('./stores');
const router = express.Router();

// GET /api/employees — central/admin only；支持 ?storeId=S001&riskLevel=p1
router.get('/employees', requireRole('central', 'admin'), (req, res) => {
  const { storeId, riskLevel } = req.query;
  let query = `SELECT e.*, s.name AS s_name, s.region AS s_region, s.rtm AS s_rtm
    FROM employees e
    JOIN stores s ON e.store_id = s.id
    WHERE 1=1`;
  const params = [];
  if (storeId)    { query += ' AND e.store_id = ?';   params.push(storeId); }
  if (riskLevel)  { query += ' AND e.risk_level = ?';  params.push(riskLevel); }
  query += ' ORDER BY e.store_id, e.is_manager DESC, e.id';
  const rows = db.prepare(query).all(...params);
  res.json(rows.map(row => formatEmployee(
    row,
    { id: row.store_id, name: row.s_name, region: row.s_region, rtm: row.s_rtm },
    req.user.employeeId
  )));
});

// GET /api/employees/:id
// employee 只能查自己；store 只能查本店；central/admin 可查全部
router.get('/employees/:id', (req, res) => {
  const user = req.user;
  const empId = req.params.id;

  if (user.role === 'employee' && user.employeeId !== empId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const row = db.prepare(`
    SELECT e.*, s.name AS s_name, s.region AS s_region, s.rtm AS s_rtm
    FROM employees e
    JOIN stores s ON e.store_id = s.id
    WHERE e.id = ?
  `).get(empId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (user.role === 'store' && row.store_id !== user.storeId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(formatEmployee(
    row,
    { id: row.store_id, name: row.s_name, region: row.s_region, rtm: row.s_rtm },
    user.employeeId
  ));
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

注意：employees.js 导入 `./stores`，而 `./stores` 又导入 `../db`，因此此验证命令会打开 SQLite 数据库文件（database.db 需存在，即 Phase 1 已执行）。

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/employees'); console.log('employees router OK:', typeof r)"
```

Expected: `employees router OK: function`（若报 `Cannot find module '../db'`，则 Phase 1 未完成）

---

### Task 7: 在 index.js 注册新路由并验证

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 在 index.js 中 require 新路由**

在已有的 `const loginRouter = require('./routes/login');` 之后插入（不要替换任何已有 require）：

```javascript
const { router: storesRouter } = require('./routes/stores');
const statsRouter    = require('./routes/stats');
const alertsRouter   = require('./routes/alerts');
const tasksRouter    = require('./routes/tasks');
const employeesRouter = require('./routes/employees');
```

- [ ] **Step 2: 注册路由**

在已有的 `app.use('/api', loginRouter);` 之后插入（**必须在 `/api/health`、`/api/state`、`/api/events` 等已有 handler 之前**，且在已有的 `app.use(authMiddleware)` 之后）：

```javascript
// Phase 3 新增路由（authMiddleware 已在前面注册，这些路由均受保护）
app.use('/api', storesRouter);
app.use('/api', statsRouter);
app.use('/api', alertsRouter);
app.use('/api', tasksRouter);
app.use('/api', employeesRouter);
```

> **验证 authMiddleware 已注册：** 确认 index.js 中已有 `app.use(authMiddleware)` 这行（Phase 2 添加）。新路由挂在其后，`req.user` 会被自动填充。若 authMiddleware 未注册，所有路由的 `req.user` 将为 undefined，需先完成 Phase 2。

- [ ] **Step 3: 启动服务器并获取 central 的 token**

```bash
pkill -f "node index.js" 2>/dev/null || true; sleep 1; cd /Users/skyler/Desktop/MVP/server && nohup node index.js > /tmp/mvp-server.log 2>&1 & curl -s --retry 8 --retry-connrefused --retry-delay 1 http://localhost:8080/api/health
```

```bash
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' > /tmp/login_central.json
TOKEN_CENTRAL=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
echo "TOKEN obtained: ${TOKEN_CENTRAL:0:20}..."
```

- [ ] **Step 4: 验证 GET /api/stores**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/stores | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('stores count:', d.length, 'first:', d[0] && d[0].id)"
```

Expected: `stores count: 50 first: S001`（或按 rank 排序的第一家）

- [ ] **Step 5: 验证 GET /api/stores/S001/employees**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/stores/S001/employees | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('S001 employees count:', d.length, 'isSelf fields:', d.map(e=>e.isSelf))"
```

Expected: `S001 employees count: 6`（S001 有 6 名员工），所有 `isSelf: false`（central 用户无 employeeId）

- [ ] **Step 6: 验证 GET /api/stats**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/stats
```

Expected: 包含 `totalEmployees: 300`, `totalStores: 50`, `p1Count`（>=0）, `passed`（>=0）等字段。

- [ ] **Step 7: 验证 GET /api/alerts**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/alerts | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('alerts count:', d.length)"
```

Expected: `alerts count:` >= 3（seed 了至少3条告警）

- [ ] **Step 8: 验证 GET /api/tasks**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/tasks | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('tasks count:', d.length, 'name:', d[0] && d[0].name)"
```

Expected: `tasks count: 1 name: 2026年Q1新品发布训练营`（或类似）

- [ ] **Step 9: 验证 GET /api/employees（central 全量）**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/employees | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('employees count:', d.length)"
```

Expected: `employees count: 300`

- [ ] **Step 10: 验证 store role 的数据隔离（只见自己门店）**

```bash
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"store_S001","password":"Train2026!"}' > /tmp/login_store.json
TOKEN_S=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_store.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_S" http://localhost:8080/api/stores | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('store sees stores count:', d.length)"
```

Expected: `store sees stores count: 1`（store 角色只看到自己门店）

```bash
# store 访问 /api/employees 应返回 403（每次单独读取 token 文件）
TOKEN_S=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_store.json','utf8')).token)")
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_S" http://localhost:8080/api/employees
```

Expected: `403`

- [ ] **Step 11: 验证 employee role 的 isSelf 注入**

```bash
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"emp_E005","password":"Train2026!"}' > /tmp/login_emp.json
TOKEN_E=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_emp.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_E" http://localhost:8080/api/stores/S001/employees | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const self=d.find(e=>e.isSelf); console.log('isSelf employee:', self && self.id, self && self.name)"
```

Expected: `isSelf employee: E005 小王`

- [ ] **Step 12: 停止服务器**

```bash
pkill -f "node index.js" 2>/dev/null || true
```

---

## Chunk 2: 前端 Adapter 改造

### Task 8: 改造 front-end/js/data.js 为异步 Adapter

**Files:**
- Modify: `front-end/js/data.js`

**改造原则：**
- 移除：`const STORES = [...]`（50 家门店硬编码，lines 33-86）
- 移除：ALL_EMPLOYEES 自动生成代码（lines 87-163）
- 移除：`const TRAINING_TASK = {...}`（lines 207-237）
- 移除：`const ALERTS = [...]`（lines 253-259）
- 保留不变：所有时间常量、REGIONS、RTM_TYPES、INTEL_TASKS、INTEL_AGGREGATED、STORE_TIMELINE_S001、EMPLOYEE_TIMELINE_E005、所有 Trade-in 数据、CHATBOT_KB、所有工具函数
- 新增：`let` 声明动态变量 + `async function init()` + 更新 return 块

- [ ] **Step 1: 将 STORES 硬编码替换为空声明**

找到 `front-end/js/data.js` 中以下位置并替换：

```javascript
  // ─────────────────────────────────────────────
  //  50 家店铺
  // ─────────────────────────────────────────────
  const STORES = [
    { id: 'S001', ...
```

替换整个 STORES 数组（到 `];` 结束，约 lines 32-87，共 55 行）为：

```javascript
  // ─────────────────────────────────────────────
  //  50 家店铺（Phase 3: 改为 API 拉取，init() 后填充）
  // ─────────────────────────────────────────────
  let STORES = [];
```

- [ ] **Step 2: 将 ALL_EMPLOYEES 生成代码替换为空声明**

找到生成 ALL_EMPLOYEES 的代码段（从 `const ALL_EMPLOYEES = [];` 的 `// 自动生成` 注释到 S001 样本替换逻辑结束，约 lines 87-163）：

将整段（约 77 行的生成器代码，从 `const ALL_EMPLOYEES` 到 `sampleEmps.forEach(...)` 行）替换为：

```javascript
  // ─────────────────────────────────────────────
  //  员工数据（Phase 3: 改为 API 拉取，init() 后填充）
  // ─────────────────────────────────────────────
  let ALL_EMPLOYEES = [];
```

- [ ] **Step 3: 将 TRAINING_TASK 替换为空声明**

找到并替换（lines 204-237，从 `//  任务 & 情报配置` 注释到 TRAINING_TASK 对象结束的 `};` 行，**仅替换 TRAINING_TASK，保留 INTEL_TASKS 之后的代码**）：

将：
```javascript
  // ─────────────────────────────────────────────
  //  任务 & 情报配置
  // ─────────────────────────────────────────────
  const TRAINING_TASK = {
    id:'T001', ...（多行到 ];）
  };
```

替换为：
```javascript
  // ─────────────────────────────────────────────
  //  任务 & 情报配置
  // ─────────────────────────────────────────────
  // TRAINING_TASK（Phase 3: 改为 API 拉取）
  let TRAINING_TASK = {};
```

确认 `const INTEL_TASKS = [...]` 仍然存在并保持不变。

- [ ] **Step 4: 将 ALERTS 替换为空声明**

找到并替换（lines 253-259）：

将：
```javascript
  const ALERTS = [
    { id:'AL001', ...（5条告警到 ];）
  ];
```

替换为：
```javascript
  // ALERTS（Phase 3: 改为 API 拉取）
  let ALERTS = [];
```

确认 `const STORE_TIMELINE_S001 = [...]` 仍然存在并保持不变。

- [ ] **Step 5: 更新 calcStats() 并添加 init()**

找到整个 `//  汇总统计` 区域（原 lines 165-202，包含 `function calcStats()` 和 `function getStoreRanking()`）。

将整个区域替换为以下代码（**严格按此顺序：`_stats` 声明 → `init()` → `calcStats()` → `getStoreRanking()`**）：

```javascript
  // ─────────────────────────────────────────────
  //  汇总统计（Phase 3: 改为 API 返回）
  // ─────────────────────────────────────────────
  // 1. 先声明 _stats（init() 会填充它）
  let _stats = {};
```

然后紧接着添加 `init()` 函数（**在 `_stats` 声明之后，`calcStats()` 之前**）：

```javascript
  // ─────────────────────────────────────────────
  //  异步初始化（Phase 3 新增）：从 API 获取动态数据
  // ─────────────────────────────────────────────
  async function init() {
    const token = localStorage.getItem('mvp_token');
    const me    = JSON.parse(localStorage.getItem('mvp_user') || '{}');
    if (!token) throw new Error('Not authenticated');
    const h = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // 并行拉取 stores、stats、alerts、tasks
    const [storesData, statsData, alertsData, tasksData] = await Promise.all([
      fetch('/api/stores',  { headers: h }).then(r => { if (!r.ok) throw new Error('stores ' + r.status); return r.json(); }),
      fetch('/api/stats',   { headers: h }).then(r => { if (!r.ok) throw new Error('stats '  + r.status); return r.json(); }),
      fetch('/api/alerts',  { headers: h }).then(r => { if (!r.ok) throw new Error('alerts ' + r.status); return r.json(); }),
      fetch('/api/tasks',   { headers: h }).then(r => { if (!r.ok) throw new Error('tasks '  + r.status); return r.json(); }),
    ]);
    STORES         = storesData;
    _stats         = statsData;
    ALERTS         = alertsData;
    TRAINING_TASK  = tasksData[0] || {};

    // 员工数据：store/employee 拉自己门店；central/admin 拉全量
    const empUrl = me.storeId
      ? '/api/stores/' + me.storeId + '/employees'
      : '/api/employees';
    ALL_EMPLOYEES = await fetch(empUrl, { headers: h })
      .then(r => { if (!r.ok) throw new Error('employees ' + r.status); return r.json(); });
  }
```

紧接着 `init()` 之后添加 `calcStats()` 和 `getStoreRanking()`：

```javascript
  // 2. calcStats 返回 API 拉取的统计对象（不再客户端计算）
  function calcStats() {
    return _stats;
  }

  // 3. getStoreRanking 仍然客户端计算（基于 init() 填充的 STORES + ALL_EMPLOYEES）
  function getStoreRanking() {
    return STORES.map(store => {
      const emps     = ALL_EMPLOYEES.filter(e => e.storeId === store.id);
      const total    = emps.length;
      const passed   = emps.filter(e => e.passed).length;
      const p1Count  = emps.filter(e => e.riskLevel === 'p1').length;
      const scAvg    = total ? Math.round(emps.reduce((s,e) => s + e.scModules, 0) / total / 28 * 100) : 0;
      const liveRate = total ? Math.round(emps.filter(e => e.liveWatched).length / total * 100) : 0;
      const aiRate   = total ? Math.round(emps.reduce((s,e) => s + e.aiCoach, 0) / total / 6 * 100) : 0;
      return { ...store, emps, total, passed, passRate: total ? Math.round(passed/total*100) : 0, p1Count, scAvg, liveRate, aiRate };
    }).sort((a,b) => b.passRate - a.passRate);
  }
```

> **注意：** 原 `data.js` 中的 `getStoreRanking()` 实现（lines 191-202）可以直接复制过来，但要确认引用的 `STORES` 和 `ALL_EMPLOYEES` 现在是 `let` 变量（Phase 3 改造后），而非旧的 `const`。

- [ ] **Step 6: 更新 public API return 块**

找到 `return {` 开始（大约 line 462 原始）到 `};` 结束的 public API 返回块。

将以下两行的直接引用改为 getters：

```javascript
  return {
    NOW, TRAIN_START, TRAIN_END, REGIONS, RTM_TYPES,
    // Phase 3: STORES/ALL_EMPLOYEES/ALERTS/TRAINING_TASK 改为 getter（init() 后值会更新）
    get STORES()         { return STORES; },
    get ALL_EMPLOYEES()  { return ALL_EMPLOYEES; },
    get ALERTS()         { return ALERTS; },
    get TRAINING_TASK()  { return TRAINING_TASK; },
    // 以下均保持不变（硬编码数据直接暴露）
    INTEL_TASKS, INTEL_AGGREGATED, STORE_TIMELINE_S001, EMPLOYEE_TIMELINE_E005,
    TRADEIN_PROJECT, TRADEIN_PILOT_STORES, TRADEIN_INTEL_TASKS,
    TRADEIN_STORE_TIMELINE, TRADEIN_EMPLOYEE_TIMELINE, CHATBOT_KB,
    Q1_SCOPE, TRADEIN_SCOPE, TOTAL_LEARNERS, TOTAL_STORES, LEARNERS_PER_STORE,
    TRADEIN_TOTAL_LEARNERS, TRADEIN_TOTAL_STORES,
    // Phase 3 新增
    init,
    // 以下所有方法保持不变
    calcStats, getStoreRanking,
    getStore:        id  => STORES.find(s => s.id === id),
    getStoreEmployees: sid => ALL_EMPLOYEES.filter(e => e.storeId === sid),
    getEmployee:     id  => ALL_EMPLOYEES.find(e => e.id === id),
    getStoreAlerts:  sid => ALERTS.filter(a => a.storeId === sid),
    isPilotStore:    sid => TRADEIN_PILOT_STORES.includes(sid),
    getManagerByStore: sid => ALL_EMPLOYEES.find(e => e.storeId === sid && e.isManager),
    formatTime, formatTimeAgo, timeUntilDeadline,
  };
```

> **注意：** 确认原 return 块中的 `getStore`、`getStoreEmployees` 等方法已更新为使用 `STORES` 和 `ALL_EMPLOYEES`（而不是旧的 const 引用）——由于我们把 const 改成了 let，这些方法的引用会自动指向 let 变量的当前值，无需其他修改。

- [ ] **Step 7: 验证 mvp_user 存储格式（auth.js 保存的是解码后的 user 对象，含 storeId）**

`init()` 从 `localStorage['mvp_user']` 读取 `me.storeId`。确认 Phase 2 的 `front-end/js/auth.js` 中的 `saveAuth(token, user)` 是将 `user` 对象（含 `storeId` 字段）存入 `localStorage['mvp_user']`：

```bash
grep -n "saveAuth\|mvp_user\|storeId" /Users/skyler/Desktop/MVP/front-end/js/auth.js | head -20
```

Expected: 能看到 `localStorage.setItem(USER_KEY, JSON.stringify(user))` 且 `user` 就是 POST /api/login 返回的 `{ id, role, storeId, employeeId, name }` 对象。若不存在 storeId 字段，检查 login.js 的响应 payload 是否包含 storeId。

- [ ] **Step 8: 验证 data.js 语法**

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('/Users/skyler/Desktop/MVP/front-end/js/data.js', 'utf8');
const localStorage = { store:{}, getItem(k){return this.store[k]||null;}, setItem(k,v){this.store[k]=v;}, removeItem(k){delete this.store[k];} };
const window = {};
const fetch = async () => ({ ok: true, json: async () => [] });
const atob = (s) => Buffer.from(s,'base64').toString('binary');
eval(code);
console.log('AppData keys:', Object.keys(window.AppData).slice(0, 10).join(', '));
console.log('init is function:', typeof window.AppData.init === 'function');
console.log('calcStats is function:', typeof window.AppData.calcStats === 'function');
console.log('STORES is array:', Array.isArray(window.AppData.STORES));
"
```

Expected:
- `AppData keys:` 包含 `NOW`, `init`, `calcStats` 等
- `init is function: true`
- `calcStats is function: true`
- `STORES is array: true`（初始为空数组）

---

### Task 9: 更新三个 HTML 的 init 调用

**Files:**
- Modify: `front-end/central.html`
- Modify: `front-end/store.html`
- Modify: `front-end/employee.html`

**改造说明：** 找到每个 HTML 底部的 `// ─── INIT` 区域，将同步渲染调用改为等待 `AppData.init()` 完成后再渲染。LAN_API polling 调用保持在 init().then() 内。

- [ ] **Step 1: 修改 central.html 的 INIT 块**

找到 `central.html` 末尾的：
```javascript
// ─── INIT ─────────────────────────────────────
renderDashboard();
renderCreateTask();
if (window.LAN_API) {
  window.LAN_API.getState().then(function(d) { renderStoreEmployeeEvents(d.events); });
  window.LAN_API.startPolling(5000, function(d) { renderStoreEmployeeEvents(d.events); });
}
```

替换为：
```javascript
// ─── INIT ─────────────────────────────────────
window.AppData.init().then(function() {
  renderDashboard();
  renderCreateTask();
  if (window.LAN_API) {
    window.LAN_API.getState().then(function(d) { renderStoreEmployeeEvents(d.events); });
    window.LAN_API.startPolling(5000, function(d) { renderStoreEmployeeEvents(d.events); });
  }
}).catch(function(err) {
  console.error('[AppData.init] failed:', err);
  window.location.replace('login.html');
});
```

- [ ] **Step 2: 修改 store.html 的 INIT 块**

找到 `store.html` 末尾的：
```javascript
// ─── INIT ─────────────────────────────────────
renderTimeline();
initMyLearningBar();
checkManagerEscalation();
if (window.LAN_API) {
  window.LAN_API.getState().then(function(d) {
    renderLanEvents(d.events);
    renderTimeline();
  });
  window.LAN_API.startPolling(5000, function(d) {
    renderLanEvents(d.events);
    renderTimeline();
  });
}
```

替换为：
```javascript
// ─── INIT ─────────────────────────────────────
window.AppData.init().then(function() {
  renderTimeline();
  initMyLearningBar();
  checkManagerEscalation();
  if (window.LAN_API) {
    window.LAN_API.getState().then(function(d) {
      renderLanEvents(d.events);
      renderTimeline();
    });
    window.LAN_API.startPolling(5000, function(d) {
      renderLanEvents(d.events);
      renderTimeline();
    });
  }
}).catch(function(err) {
  console.error('[AppData.init] failed:', err);
  window.location.replace('login.html');
});
```

- [ ] **Step 3: 修改 employee.html 的 INIT 块**

找到 `employee.html` 末尾的：
```javascript
// ─── INIT ─────────────────────────────────────
const EMP_STORE_ID = 'S001';
const EMP_ROLE = 'employee';
renderTimeline();
if (window.LAN_API) {
  window.LAN_API.getState().then(function(d) {
    renderLanEvents(d.events);
    renderTimeline();
  });
  window.LAN_API.startPolling(5000, function(d) {
    renderLanEvents(d.events);
    renderTimeline();
  });
}
```

替换为：
```javascript
// ─── INIT ─────────────────────────────────────
const EMP_STORE_ID = 'S001';
const EMP_ROLE = 'employee';
window.AppData.init().then(function() {
  renderTimeline();
  if (window.LAN_API) {
    window.LAN_API.getState().then(function(d) {
      renderLanEvents(d.events);
      renderTimeline();
    });
    window.LAN_API.startPolling(5000, function(d) {
      renderLanEvents(d.events);
      renderTimeline();
    });
  }
}).catch(function(err) {
  console.error('[AppData.init] failed:', err);
  window.location.replace('login.html');
});
```

- [ ] **Step 4: 端到端验证**

```bash
pkill -f "node index.js" 2>/dev/null || true; sleep 1; cd /Users/skyler/Desktop/MVP/server && nohup node index.js > /tmp/mvp-server.log 2>&1 & curl -s --retry 8 --retry-connrefused --retry-delay 1 http://localhost:8080/api/health
```

```bash
# 验证三个 HTML 都包含 AppData.init
for page in central store employee; do
  count=$(curl -s "http://localhost:8080/${page}.html" | grep -c "AppData.init")
  echo "${page}.html AppData.init count: $count"
done
```

Expected: 每个页面输出 `AppData.init count: 1`

```bash
# 验证 central login + stats 端到端（单条命令避免 shell 变量丢失）
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' > /tmp/login_c3.json && \
TOKEN_C3=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_c3.json','utf8')).token)") && \
curl -s -H "Authorization: Bearer $TOKEN_C3" http://localhost:8080/api/stats | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('totalEmployees:', d.totalEmployees, 'totalStores:', d.totalStores)"
```

Expected: `totalEmployees: 300 totalStores: 50`

```bash
pkill -f "node index.js" 2>/dev/null || true
```

---

## Phase 3 完成验收标准

- [ ] `GET /api/stores` central 账号返回 50 家门店，store_S001 账号返回 1 家门店
- [ ] `GET /api/stores/S001/employees` central 账号返回 6 人，`isSelf` 均为 false
- [ ] `GET /api/stores/S001/employees` emp_E005 登录后，返回 6 人，其中 E005 的 `isSelf: true`
- [ ] `GET /api/stores/S002/employees` store_S001 账号访问返回 403（访问其他门店被拒绝）
- [ ] `GET /api/stats` 返回 `totalEmployees: 300`, `totalStores: 50` 及正确算出的 passRate/reachRate
- [ ] `GET /api/alerts` central 账号返回 >= 3 条告警，每条含 storeName 和 aiSuggestions
- [ ] `GET /api/tasks` 返回含 T001 的任务，包含 deadline 和 targetRole 字段
- [ ] `GET /api/employees` store 账号访问返回 403；central 账号返回 300 名员工
- [ ] `GET /api/employees?storeId=S001` 返回 6 名 S001 员工
- [ ] emp_E005 登录 token 中 `storeId: "S001"`（非 null）
- [ ] 浏览器用 central 账号登录后，central.html 正常渲染（数据来自 SQLite，刷新后数据一致）
- [ ] 浏览器用 store_S001 账号登录后，store.html 正常渲染，显示 S001 员工进度
- [ ] 浏览器用 emp_E005 账号登录后，employee.html 正常渲染
