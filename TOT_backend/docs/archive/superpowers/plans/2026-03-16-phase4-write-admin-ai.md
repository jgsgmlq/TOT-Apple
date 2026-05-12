# Phase 4: Write Operations + Admin + AI Stubs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现所有写操作接口（任务发布、告警确认、情报/VOC/求助提交），新增 admin.html 管理后台（员工进度编辑、数据重置、重新 seed），新增 AI 代理接口 Mock（/api/ai/\*），并将前端 chatbot 改为调用 API。

**Architecture:** 后端新增 routes/intel.js（写操作）、routes/admin.js（管理后台）、routes/ai.js（AI mock），并更新 routes/tasks.js（POST）和 routes/alerts.js（POST ack）；前端新增 front-end/admin.html；现有三端中的写操作占位（showToast）改为真实 API 调用，chatbot 改为调 /api/ai/chat。

**Prerequisites:** Phase 1（SQLite）+ Phase 2（JWT 鉴权）+ Phase 3（读数据层）均已完成。

**Tech Stack:** better-sqlite3（已安装），jsonwebtoken（已安装）

---

## Preflight: 检查前置条件

```bash
test -f /Users/skyler/Desktop/MVP/server/db.js && echo "db.js OK" || echo "ABORT: Phase 1 incomplete"
test -f /Users/skyler/Desktop/MVP/server/auth.js && echo "auth.js OK" || echo "ABORT: Phase 2 incomplete"
test -f /Users/skyler/Desktop/MVP/server/routes/stores.js && echo "stores.js OK" || echo "ABORT: Phase 3 incomplete"
test -f /Users/skyler/Desktop/MVP/server/routes/employees.js && echo "employees.js OK" || echo "ABORT: Phase 3 incomplete"
grep -q "authMiddleware" /Users/skyler/Desktop/MVP/server/index.js && echo "authMiddleware registered OK" || echo "ABORT: Phase 2 not complete in index.js"
cd /Users/skyler/Desktop/MVP/server && node -e "const { formatEmployee } = require('./routes/stores'); console.log('formatEmployee is function:', typeof formatEmployee === 'function')"
```

Expected: 六行均输出 `OK` 或 `true`。若有 `ABORT`/`false`，停止并先完成对应 Phase。

最后一条验证 `routes/stores.js` 导出了 `formatEmployee(row, store, selfEmployeeId)`（Phase 3 要求）—— admin.js 的 Task 4 依赖此导出。

---

## Chunk 1: 后端写操作路由

### Task 1: 在 routes/tasks.js 增加 POST /api/tasks

**Files:**
- Modify: `server/routes/tasks.js`

- [ ] **Step 1: 在 tasks.js 末尾添加 POST /api/tasks**

在 `module.exports = router;` 之前添加：

```javascript
const { requireRole } = require('../auth');

// POST /api/tasks — central/admin 创建任务
router.post('/tasks', requireRole('central', 'admin'), (req, res) => {
  const { name, deadline, targetRole, storeScope, config } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = 'T' + String(Date.now()).slice(-6);
  const configJson = JSON.stringify(config || {});
  const createdBy = req.user.name || req.user.role;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO tasks (id, name, status, deadline, target_role, store_scope, created_by, config_json, created_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run(id, name, deadline || null, targetRole || 'all', storeScope || 'all', createdBy, configJson, createdAt);

  res.status(201).json({
    id, name, status: 'active',
    deadline: deadline || null,
    targetRole: targetRole || 'all',
    storeScope: storeScope || 'all',
    createdBy,
    createdAt,
    config: config || {},
  });
});
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/tasks'); console.log('tasks router OK:', typeof r)"
```

Expected: `tasks router OK: function`

---

### Task 2: 在 routes/alerts.js 增加 POST /api/alerts/:id/ack

**Files:**
- Modify: `server/routes/alerts.js`

- [ ] **Step 1: 在 alerts.js 末尾添加 POST /api/alerts/:id/ack**

在 `module.exports = router;` 之前添加：

```javascript
const { requireRole } = require('../auth');

// POST /api/alerts/:id/ack — store/admin 确认告警
router.post('/alerts/:id/ack', requireRole('store', 'admin'), (req, res) => {
  const user = req.user;
  const alertId = req.params.id;
  const { actionId, action } = req.body || {};

  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  if (!alert) return res.status(404).json({ error: 'Not found' });

  // store 角色只能 ack 自己门店的告警
  if (user.role === 'store' && alert.store_id !== user.storeId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const interventionJson = JSON.stringify({
    actionId: actionId || null,
    action: action || null,
    executedAt: new Date().toISOString(),
    result: '已执行',
  });

  db.prepare(`
    UPDATE alerts SET
      status = 'in_progress',
      acknowledged_by = ?,
      acknowledged_at = ?,
      intervention_json = ?
    WHERE id = ?
  `).run(String(user.id), new Date().toISOString(), interventionJson, alertId);

  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  const store = db.prepare('SELECT name FROM stores WHERE id = ?').get(updated.store_id);
  let employeeName;
  if (updated.employee_id) {
    const emp = db.prepare('SELECT name FROM employees WHERE id = ?').get(updated.employee_id);
    employeeName = emp ? emp.name : updated.employee_id;
  } else {
    const { c } = db.prepare('SELECT COUNT(*) as c FROM employees WHERE store_id = ?').get(updated.store_id);
    employeeName = `全员(${c}人)`;
  }

  let aiSuggestions; try { aiSuggestions = JSON.parse(updated.suggestions_json); } catch { aiSuggestions = []; }
  let intervention;  try { intervention  = JSON.parse(updated.intervention_json);  } catch { intervention  = {}; }

  res.json({ ok: true, alert: {
    id: updated.id, level: updated.level,
    storeId: updated.store_id, storeName: store ? store.name : '',
    employeeId: updated.employee_id || null, employeeName,
    trigger: updated.trigger_desc, rootCause: updated.root_cause,
    aiSuggestions, status: updated.status, createdAt: updated.created_at,
    acknowledgedBy: updated.acknowledged_by, acknowledgedAt: updated.acknowledged_at,
    intervention,
  }});
});
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/alerts'); console.log('alerts router OK:', typeof r)"
```

Expected: `alerts router OK: function`

---

### Task 3: 创建 server/routes/intel.js

**Files:**
- Create: `server/routes/intel.js`

- [ ] **Step 1: 创建 intel.js**

```javascript
// server/routes/intel.js
// 职责：POST /api/intel、POST /api/voc、POST /api/help

const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const router = express.Router();

// POST /api/intel — employee/admin 提交情报
router.post('/intel', requireRole('employee', 'admin'), (req, res) => {
  const user = req.user;
  const { taskId, content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content is required' });

  const result = db.prepare(`
    INSERT INTO intel_submissions (type, task_id, employee_id, store_id, content, submitted_at)
    VALUES ('intel', ?, ?, ?, ?, ?)
  `).run(taskId || null, user.employeeId || null, user.storeId || null, content, new Date().toISOString());

  res.status(201).json({ id: result.lastInsertRowid, type: 'intel', taskId: taskId || null, content });
});

// POST /api/voc — employee/admin 提交 VOC 速记
router.post('/voc', requireRole('employee', 'admin'), (req, res) => {
  const user = req.user;
  const { summary } = req.body || {};
  if (!summary) return res.status(400).json({ error: 'summary is required' });

  const result = db.prepare(`
    INSERT INTO intel_submissions (type, employee_id, store_id, content, submitted_at)
    VALUES ('voc', ?, ?, ?, ?)
  `).run(user.employeeId || null, user.storeId || null, summary, new Date().toISOString());

  res.status(201).json({ id: result.lastInsertRowid, type: 'voc', content: summary });
});

// POST /api/help — employee/admin 提交 Trade-in 求助
router.post('/help', requireRole('employee', 'admin'), (req, res) => {
  const user = req.user;
  const { issueType, description, urgent } = req.body || {};
  if (!issueType) return res.status(400).json({ error: 'issueType is required' });

  const content = JSON.stringify({ issueType, description: description || '' });
  const urgentVal = urgent ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO intel_submissions (type, employee_id, store_id, content, urgent, submitted_at)
    VALUES ('help', ?, ?, ?, ?, ?)
  `).run(user.employeeId || null, user.storeId || null, content, urgentVal, new Date().toISOString());

  res.status(201).json({ id: result.lastInsertRowid, type: 'help', content, urgent: urgentVal === 1 });
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/intel'); console.log('intel router OK:', typeof r)"
```

Expected: `intel router OK: function`

---

### Task 4: 创建 server/routes/admin.js

**Files:**
- Create: `server/routes/admin.js`

- [ ] **Step 1: 创建 admin.js**

```javascript
// server/routes/admin.js
// 职责：GET/PUT/POST/DELETE /api/admin/employees、POST /api/admin/stores/:id/reset、POST /api/admin/seed

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../auth');
const { formatEmployee } = require('./stores');
const router = express.Router();

const ADMIN_GUARD = requireRole('admin');

// GET /api/admin/employees — 支持 ?storeId=S001&riskLevel=p1
router.get('/admin/employees', ADMIN_GUARD, (req, res) => {
  const { storeId, riskLevel } = req.query;
  let query = `SELECT e.*, s.name AS s_name, s.region AS s_region, s.rtm AS s_rtm
    FROM employees e JOIN stores s ON e.store_id = s.id WHERE 1=1`;
  const params = [];
  if (storeId)   { query += ' AND e.store_id = ?';  params.push(storeId); }
  if (riskLevel) { query += ' AND e.risk_level = ?'; params.push(riskLevel); }
  query += ' ORDER BY e.store_id, e.is_manager DESC, e.id';
  const rows = db.prepare(query).all(...params);
  res.json(rows.map(row => formatEmployee(
    row,
    { id: row.store_id, name: row.s_name, region: row.s_region, rtm: row.s_rtm },
    null
  )));
});

// PUT /api/admin/employees/:id — 更新员工进度字段
router.put('/admin/employees/:id', ADMIN_GUARD, (req, res) => {
  const empId = req.params.id;
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  if (!emp) return res.status(404).json({ error: 'Not found' });

  const allowed = ['sc_modules','sc_test','live_watched','mypal_days','ai_coach','risk_level'];
  const updates = {};
  // Map camelCase request fields to snake_case DB columns
  const fieldMap = {
    scModules: 'sc_modules', scTest: 'sc_test',
    liveWatched: 'live_watched', mypalDays: 'mypal_days',
    aiCoach: 'ai_coach', riskLevel: 'risk_level',
  };
  const body = req.body || {};
  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) updates[snake] = body[camel];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), empId];
  db.prepare(`UPDATE employees SET ${setClauses} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT e.*, s.name AS s_name, s.region AS s_region, s.rtm AS s_rtm
    FROM employees e JOIN stores s ON e.store_id = s.id WHERE e.id = ?
  `).get(empId);
  res.json(formatEmployee(
    updated,
    { id: updated.store_id, name: updated.s_name, region: updated.s_region, rtm: updated.s_rtm },
    null
  ));
});

// POST /api/admin/employees — 新增员工（同时创建登录账号）
router.post('/admin/employees', ADMIN_GUARD, (req, res) => {
  const { storeId, name, role, isManager } = req.body || {};
  if (!storeId || !name || !role) {
    return res.status(400).json({ error: 'storeId, name, role are required' });
  }
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) return res.status(400).json({ error: 'Invalid storeId' });

  // 生成 employeeId：查当前最大数字
  const rows = db.prepare("SELECT id FROM employees WHERE id LIKE 'E%' ORDER BY id DESC").all();
  let maxN = 300;
  if (rows.length > 0) {
    const lastNum = parseInt(rows[0].id.replace('E', ''), 10);
    if (!isNaN(lastNum)) maxN = Math.max(maxN, lastNum);
  }
  const empId = 'E' + String(maxN + 1).padStart(3, '0');

  db.prepare(`
    INSERT INTO employees (id, store_id, name, role, is_manager) VALUES (?, ?, ?, ?, ?)
  `).run(empId, storeId, name, role, isManager ? 1 : 0);

  // 创建登录账号
  const username = 'emp_' + empId;
  const passwordHash = bcrypt.hashSync('Train2026!', 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, employee_id)
    VALUES (?, ?, 'employee', ?)
  `).run(username, passwordHash, empId);

  const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
  res.status(201).json(formatEmployee(
    created,
    { id: store.id, name: store.name, region: store.region, rtm: store.rtm },
    null
  ));
});

// DELETE /api/admin/employees/:id — 删除员工（同时删除登录账号）
router.delete('/admin/employees/:id', ADMIN_GUARD, (req, res) => {
  const empId = req.params.id;
  if (!db.prepare('SELECT id FROM employees WHERE id = ?').get(empId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  db.prepare('DELETE FROM users WHERE employee_id = ?').run(empId);
  db.prepare('DELETE FROM employees WHERE id = ?').run(empId);
  res.json({ ok: true });
});

// POST /api/admin/stores/:id/reset — 将门店员工进度重置为 seed 初始值
// 实现：将所有字段重置为与 seed 逻辑一致的固定分布（不是清零）
router.post('/admin/stores/:id/reset', ADMIN_GUARD, (req, res) => {
  const storeId = req.params.id;
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) return res.status(404).json({ error: 'Not found' });

  // 使用与 seed.js 相同的逻辑：按 risk_level 重置进度
  // S001 特殊处理：精细样本（E001-E006）
  const emps = db.prepare('SELECT id, is_manager FROM employees WHERE store_id = ? ORDER BY is_manager DESC, id').all(storeId);
  const PROGRESS_BY_RISK = {
    normal: { sc: [20,28], test: [78,95], live: 1, mypal: 2, ai: [4,6], risk: 'normal' },
    p2:     { sc: [12,20], test: [65,79], live: 1, mypal: 1, ai: [2,4], risk: 'p2' },
    p1:     { sc: [4,12],  test: [45,65], live: 0, mypal: 0, ai: [0,2], risk: 'p1' },
  };

  // S001 样本：恢复精细初始值
  const S001_SAMPLE = [
    { id:'E001', sc:28, test:92, live:1, mypal:2, ai:6, risk:'normal' },
    { id:'E002', sc:24, test:85, live:1, mypal:2, ai:5, risk:'normal' },
    { id:'E003', sc:20, test:78, live:1, mypal:1, ai:4, risk:'p2' },
    { id:'E004', sc:28, test:88, live:1, mypal:2, ai:6, risk:'normal' },
    { id:'E005', sc:8,  test:62, live:0, mypal:0, ai:1, risk:'p1' },
    { id:'E006', sc:16, test:74, live:1, mypal:1, ai:3, risk:'p2' },
  ];

  const resetOne = db.prepare(`UPDATE employees SET sc_modules=?, sc_test=?, live_watched=?, mypal_days=?, ai_coach=?, risk_level=? WHERE id=?`);

  db.transaction(() => {
    for (const emp of emps) {
      if (storeId === 'S001') {
        const sample = S001_SAMPLE.find(s => s.id === emp.id);
        if (sample) {
          resetOne.run(sample.sc, sample.test, sample.live, sample.mypal, sample.ai, sample.risk, emp.id);
          continue;
        }
      }
      // 其他门店：按员工序号决定 risk（简单分布：70% normal, 20% p2, 10% p1）
      const idx = emps.indexOf(emp);
      const riskKey = idx < emps.length * 0.1 ? 'p1' : idx < emps.length * 0.3 ? 'p2' : 'normal';
      const p = PROGRESS_BY_RISK[riskKey];
      const sc = p.sc[0] + Math.floor((p.sc[1] - p.sc[0]) / 2);
      const test = p.test[0] + Math.floor((p.test[1] - p.test[0]) / 2);
      const ai = p.ai[0] + Math.floor((p.ai[1] - p.ai[0]) / 2);
      resetOne.run(sc, test, p.live, p.mypal, ai, p.risk, emp.id);
    }
  })();

  res.json({ ok: true, resetCount: emps.length });
});

// POST /api/admin/seed — 清空并重新 seed 全部数据
router.post('/admin/seed', ADMIN_GUARD, (req, res) => {
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({ error: 'Send { "confirm": true } to execute' });
  }
  // 执行 seed.js 中的逻辑（重新 require 并调用）
  // seed.js 需导出一个 runSeed() 函数（见 Task 5）
  try {
    const { runSeed } = require('../seed');
    const counts = runSeed(db);
    res.json({ ok: true, ...counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/admin'); console.log('admin router OK:', typeof r)"
```

Expected: `admin router OK: function`

---

### Task 5: 更新 seed.js — 导出 runSeed(db) 函数

**Files:**
- Modify: `server/seed.js`

**目的：** `POST /api/admin/seed` 需要调用 seed 逻辑。当前 seed.js 结构为：

```javascript
// 第 1 行
const db = require('./db');
// 第 85 行
const runSeed = db.transaction(() => {
  // ...290 行所有 seed 逻辑...
  return counts;
});
// 第 291 行
runSeed();
```

`db.transaction()` 会将事务绑定到模块级的 `db` 实例，无法接受外部 `db` 参数。需要将其重构为普通函数，接受 `db` 参数并在内部调用 `db.transaction()`。

- [ ] **Step 1: 修改第 85 行 — 将事务常量改为函数**

将：
```javascript
const runSeed = db.transaction(() => {
```

改为：
```javascript
function runSeed(db) {
  return db.transaction(() => {
```

（注意：函数体内原本引用的 `db` 现在来自参数，无需改动内部代码）

- [ ] **Step 2: 修改倒数第 2 行 — 闭合函数**

将原来事务末尾的：
```javascript
});
```

改为（在 `return counts;` 之后）：
```javascript
  })();
}
```

说明：`})()` 立即调用事务函数（better-sqlite3 的 transaction wrapper 调用时才执行），外层 `}` 关闭 `runSeed` 函数。

- [ ] **Step 3: 替换第 291 行 — 改为条件执行 + 导出**

将：
```javascript
runSeed();
```

替换为：
```javascript
// 供 admin.js require 并调用
module.exports = { runSeed };

// 直接运行（node seed.js）时自动执行
if (require.main === module) {
  const counts = runSeed(db);
  console.log('Seed complete:', counts);
}
```

注意：直接运行时可复用顶部的模块级 `const db = require('./db')` 实例，无需重新创建 Database。

- [ ] **Step 4: 验证导出函数可 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const { runSeed } = require('./seed'); console.log('runSeed is function:', typeof runSeed)"
```

Expected: `runSeed is function: function`

---

### Task 6: 创建 server/routes/ai.js — AI Mock 接口

**Files:**
- Create: `server/routes/ai.js`

- [ ] **Step 1: 创建 ai.js**

```javascript
// server/routes/ai.js
// 职责：POST /api/ai/* — MVP 阶段返回 Mock 响应；接口结构与 Claude API 接入后保持一致

const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /api/ai/chat — 通用问答（MVP: 关键词匹配，后期换 Claude）
router.post('/ai/chat', (req, res) => {
  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required' });

  // MVP Mock：简单关键词匹配
  const KEYWORDS = [
    { keys: ['以旧换新','trade-in','换新'], answer: '以旧换新活动：旧机评估后最高可抵扣2000元，叠加首发优惠，当场出结果。推荐开场白：「您现在用什么手机？以旧换新活动今天换新非常划算！」' },
    { keys: ['测验','分数','通过'], answer: '测验标准：≥80分视为通过。建议先完成全部28个SC模块再参加测验，胜率更高。' },
    { keys: ['直播','回放'], answer: '3月10日10:30-11:30新品发布直播已结束，可点击「观看回放」补看，系统会自动记录完成状态。' },
    { keys: ['MyPAL','mypal'], answer: 'MyPAL是个性化学习路径工具，需完成至少1天学习方可达标。建议每天利用空闲时间完成碎片化学习。' },
    { keys: ['AI Coach','ai coach'], answer: 'AI Coach提供6个话术对话脚本，建议优先练习「以旧换新话术」和「价格异议处理」两个高频场景。' },
  ];

  const q = (query || '').toLowerCase();
  let answer = '这个问题我正在学习中。建议查看Sales Coach对应模块，或联系店长获取更多信息。';
  let source = '通用回复';
  let confidence = 0.4;

  for (const item of KEYWORDS) {
    if (item.keys.some(k => q.includes(k.toLowerCase()))) {
      answer = item.answer;
      source = 'RAG知识库';
      confidence = 0.92;
      break;
    }
  }

  res.json({ answer, confidence, source });
});

// POST /api/ai/intervention — 为告警生成干预建议（MVP Mock）
router.post('/ai/intervention', (req, res) => {
  const { alertId, employeeData } = req.body || {};
  res.json({
    suggestions: [
      { id: 'AS_gen_1', action: '发送个性化学习提醒（AI生成）', type: 'notify' },
      { id: 'AS_gen_2', action: '推送薄弱知识点强化包', type: 'push_content' },
      { id: 'AS_gen_3', action: '安排专属辅导员跟进', type: 'assign_mentor' },
    ],
  });
});

// POST /api/ai/intel-summary — 情报汇总（MVP Mock）
router.post('/ai/intel-summary', (req, res) => {
  res.json({
    insights: [
      '顾客对以旧换新折价最关注（占比46%）',
      '续航和价格是第二大关注点',
      '竞品比较问题集中在华东区',
    ],
    talkPoints: [
      '强调官方评估系统透明公正，当场出结果',
      '叠加首发礼包后实际到手价优势明显',
    ],
  });
});

// POST /api/ai/script — 话术生成（MVP Mock）
router.post('/ai/script', (req, res) => {
  const { scenario } = req.body || {};
  res.json({
    script: `【场景：${scenario || '通用话术'}】\n推荐开场：「您好，请问您现在用的是什么手机？我们有新品发布活动，今天换新非常划算！」\n如顾客有疑虑：「这完全可以理解，我帮您详细算一下实际到手价？」`,
  });
});

// POST /api/ai/study-plan — 学习计划生成（MVP Mock）
router.post('/ai/study-plan', (req, res) => {
  const { employeeId, progress } = req.body || {};
  res.json({
    plan: [
      { day: 1, tasks: ['SC模块1-7（基础产品知识）', 'AI Coach: 开场白练习'] },
      { day: 2, tasks: ['SC模块8-14（竞品对比）', 'MyPAL个性化路径'] },
      { day: 3, tasks: ['SC模块15-21（以旧换新话术）', 'AI Coach: 价格异议处理'] },
      { day: 4, tasks: ['SC模块22-28（成交技巧）', 'AI Coach: 以旧换新全流程'] },
      { day: 5, tasks: ['观看直播回放', 'AI Coach: 综合演练', '参加测验（目标≥80分）'] },
    ],
  });
});

module.exports = router;
```

- [ ] **Step 2: 验证模块可以 require**

```bash
cd /Users/skyler/Desktop/MVP/server && node -e "const r = require('./routes/ai'); console.log('ai router OK:', typeof r)"
```

Expected: `ai router OK: function`

---

### Task 7: 在 index.js 注册新路由并验证

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: require 新路由**

在已有的 `const employeesRouter = require('./routes/employees');` 之后插入（不替换已有 require）：

```javascript
const intelRouter  = require('./routes/intel');
const adminRouter  = require('./routes/admin');
const aiRouter     = require('./routes/ai');
```

- [ ] **Step 2: 注册路由**

在已有的 `app.use('/api', employeesRouter);` 之后插入：

```javascript
app.use('/api', intelRouter);
app.use('/api', adminRouter);
app.use('/api', aiRouter);
```

- [ ] **Step 3: 启动服务器并基本验证**

```bash
pkill -f "node index.js" 2>/dev/null || true; sleep 1; cd /Users/skyler/Desktop/MVP/server && nohup node index.js > /tmp/mvp-server.log 2>&1 & curl -s --retry 8 --retry-connrefused --retry-delay 1 http://localhost:8080/api/health
```

```bash
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}' > /tmp/login_p4_central.json
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_central.json','utf8')).token)")
echo "Central token: ${TOKEN_C:0:20}..."
```

- [ ] **Step 4: 验证 POST /api/tasks**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_central.json','utf8')).token)")
curl -s -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase4测试任务","deadline":"2026-03-20T18:00:00","targetRole":"all"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('created task id:', d.id, 'name:', d.name)"
```

Expected: `created task id: T...（6位数）name: Phase4测试任务`

- [ ] **Step 5: 验证 POST /api/alerts/:id/ack**

```bash
# 先获取告警 ID
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_central.json','utf8')).token)")
curl -s -H "Authorization: Bearer $TOKEN_C" http://localhost:8080/api/alerts > /tmp/alerts.json
ALERT_ID=$(node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/alerts.json','utf8')); process.stdout.write(d[0] && d[0].id || '')")
echo "First alert id: $ALERT_ID"
```

```bash
# store_S001 确认对应门店的告警（先登录 store）
curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"store_S001","password":"Train2026!"}' > /tmp/login_p4_store.json
TOKEN_S=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_store.json','utf8')).token)")
# 找 S001 的告警
ALERT_S001=$(node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/alerts.json','utf8')); const a=d.find(x=>x.storeId==='S001'); process.stdout.write(a?a.id:'')")
echo "S001 alert id: $ALERT_S001"
```

```bash
TOKEN_S=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_store.json','utf8')).token)")
ALERT_S001=$(node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/alerts.json','utf8')); const a=d.find(x=>x.storeId==='S001'); process.stdout.write(a?a.id:'')")
curl -s -X POST "http://localhost:8080/api/alerts/$ALERT_S001/ack" \
  -H "Authorization: Bearer $TOKEN_S" \
  -H "Content-Type: application/json" \
  -d '{"actionId":"AS004","action":"发送个性化学习提醒"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('ack ok:', d.ok, 'status:', d.alert && d.alert.status)"
```

Expected: `ack ok: true status: in_progress`

- [ ] **Step 6: 验证 AI chat endpoint**

```bash
TOKEN_C=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/tmp/login_p4_central.json','utf8')).token)")
curl -s -X POST http://localhost:8080/api/ai/chat \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{"query":"以旧换新怎么说"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('source:', d.source, 'confidence:', d.confidence)"
```

Expected: `source: RAG知识库 confidence: 0.92`

- [ ] **Step 7: 停止服务器**

```bash
pkill -f "node index.js" 2>/dev/null || true
```

---

## Chunk 2: 前端写操作接入

### Task 8: 更新 front-end/js/data.js — chatbot 改调 /api/ai/chat

**Files:**
- Modify: `front-end/js/data.js`

**目标：** 将 `chatbotQuery(query)` 函数从同步关键词匹配改为调用 `POST /api/ai/chat`，但保留原函数签名（调用方不变）。

- [ ] **Step 1: 将 chatbotQuery 改为 async（返回 Promise）**

找到 `function chatbotQuery(query)` 的实现（约 lines 428-436）：

```javascript
  function chatbotQuery(query) {
    const q = query.toLowerCase();
    for (const item of CHATBOT_KB) {
      if (item.keywords.some(k => q.includes(k.toLowerCase()))) {
        return { answer: item.answer, confidence: 0.92, source: 'RAG知识库' };
      }
    }
    return { answer: '这个问题我正在学习中...', confidence: 0.4, source: '通用回复' };
  }
```

替换为：

```javascript
  // chatbotQuery（Phase 4: 改为调用 /api/ai/chat API）
  // 返回 Promise<{ answer, confidence, source }>
  async function chatbotQuery(query) {
    const token = localStorage.getItem('mvp_token');
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error('ai/chat ' + res.status);
      return await res.json();
    } catch (e) {
      // fallback：本地关键词匹配
      const q = (query || '').toLowerCase();
      for (const item of CHATBOT_KB) {
        if (item.keywords.some(k => q.includes(k.toLowerCase()))) {
          return { answer: item.answer, confidence: 0.92, source: 'RAG知识库(本地)' };
        }
      }
      return { answer: '网络错误，请稍后再试。', confidence: 0, source: 'error' };
    }
  }
```

- [ ] **Step 2: 修改 employee.html — sendChat 中的同步调用（约 line 797）**

找到 `front-end/employee.html` 中的 `sendChat` 函数，将：
```javascript
  setTimeout(()=>{ const r=D.chatbotQuery(q); appendMsg(r.answer,'ai'); }, 250+Math.random()*500);
```

替换为：
```javascript
  setTimeout(()=>{ D.chatbotQuery(q).then(r => appendMsg(r.answer,'ai')); }, 250+Math.random()*500);
```

- [ ] **Step 3: 修改 employee.html — quickAsk 中的同步调用（约 line 799）**

找到 `front-end/employee.html` 中的 `quickAsk` 函数，将：
```javascript
function quickAsk(q) { appendMsg(q,'user'); setTimeout(()=>{ const r=D.chatbotQuery(q); appendMsg(r.answer,'ai'); }, 350); }
```

替换为：
```javascript
function quickAsk(q) { appendMsg(q,'user'); setTimeout(()=>{ D.chatbotQuery(q).then(r => appendMsg(r.answer,'ai')); }, 350); }
```

- [ ] **Step 4: 修改 store.html — sendChat 中的同步调用（约 lines 1075-1078）**

找到 `front-end/store.html` 中的 `sendChat` 函数，将其 setTimeout 内容从：
```javascript
  setTimeout(() => {
    const res = D.chatbotQuery(q);
    appendMsg(res.answer, 'ai');
  }, 300 + Math.random() * 400);
```

替换为：
```javascript
  setTimeout(() => {
    D.chatbotQuery(q).then(res => appendMsg(res.answer, 'ai'));
  }, 300 + Math.random() * 400);
```

- [ ] **Step 5: 修改 store.html — quickAsk 中的同步调用（约 lines 1083-1086）**

找到 `front-end/store.html` 中的 `quickAsk` 函数，将其 setTimeout 内容从：
```javascript
  setTimeout(() => {
    const res = D.chatbotQuery(q);
    appendMsg(res.answer, 'ai');
  }, 400);
```

替换为：
```javascript
  setTimeout(() => {
    D.chatbotQuery(q).then(res => appendMsg(res.answer, 'ai'));
  }, 400);
```

- [ ] **Step 6: 验证调用方已改为 .then()**

```bash
grep -n "chatbotQuery" /Users/skyler/Desktop/MVP/front-end/employee.html
grep -n "chatbotQuery" /Users/skyler/Desktop/MVP/front-end/store.html
```

Expected: 所有出现的 `chatbotQuery` 调用处均含 `.then(`，没有直接使用返回值的同步调用。

- [ ] **Step 7: 验证 data.js 语法**

```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('/Users/skyler/Desktop/MVP/front-end/js/data.js', 'utf8');
const localStorage = { store:{}, getItem(k){return null;}, setItem(k,v){}, removeItem(k){} };
const window = {};
const fetch = async () => ({ ok: true, json: async () => ({answer:'test',confidence:0.9,source:'mock'}) });
const atob = (s) => Buffer.from(s,'base64').toString('binary');
eval(code);
console.log('chatbotQuery is async function:', window.AppData.chatbotQuery.constructor.name === 'AsyncFunction');
"
```

Expected: `chatbotQuery is async function: true`

---

## Chunk 3: 前端 admin.html 管理后台

### Task 9: 创建 front-end/admin.html

**Files:**
- Create: `front-end/admin.html`

- [ ] **Step 1: 创建 admin.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理后台 — MVP 培训系统</title>
  <script src="js/auth.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; min-height: 100vh; }
    .header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
    .header h1 { font-size: 18px; font-weight: 700; }
    .header .sub { font-size: 13px; color: #64748b; }
    .logout-btn { margin-left: auto; background: #334155; border: none; color: #94a3b8; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .tabs { display: flex; gap: 0; border-bottom: 1px solid #334155; background: #1e293b; padding: 0 24px; }
    .tab { padding: 12px 20px; font-size: 14px; cursor: pointer; color: #64748b; border-bottom: 2px solid transparent; }
    .tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }
    .panel { display: none; padding: 24px; }
    .panel.active { display: block; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
    select, input[type=number], input[type=text] {
      background: #0f172a; border: 1px solid #334155; border-radius: 6px;
      color: #f1f5f9; padding: 8px 12px; font-size: 13px;
    }
    select { min-width: 200px; }
    input[type=number] { width: 80px; }
    input[type=text] { width: 160px; }
    .btn { background: #3b82f6; border: none; color: white; padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .btn-danger { background: #dc2626; }
    .btn-secondary { background: #334155; color: #94a3b8; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; color: #64748b; border-bottom: 1px solid #334155; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; vertical-align: middle; }
    tr:hover td { background: #1e293b20; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-p1 { background: rgba(239,68,68,.2); color: #f87171; }
    .badge-p2 { background: rgba(234,179,8,.2); color: #facc15; }
    .badge-normal { background: rgba(34,197,94,.2); color: #4ade80; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 12px 20px; border-radius: 8px; font-size: 13px; display: none; z-index: 9999; }
    .stats-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .stat-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 20px; flex: 1; min-width: 120px; }
    .stat-card .val { font-size: 24px; font-weight: 700; color: #3b82f6; }
    .stat-card .lbl { font-size: 12px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
<script>Auth.requireRole('admin');</script>

<div class="header">
  <div>
    <h1>⚙️ 管理后台</h1>
    <div class="sub" id="adminWelcome">加载中...</div>
  </div>
  <button class="logout-btn" onclick="Auth.logout()">退出登录</button>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('progress')">员工进度管理</div>
  <div class="tab" onclick="switchTab('employees')">员工管理</div>
  <div class="tab" onclick="switchTab('system')">系统操作</div>
</div>

<!-- Tab 1: 员工进度管理 -->
<div class="panel active" id="panel-progress">
  <div class="card">
    <h2>按门店编辑员工进度</h2>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
      <select id="storeSelect" onchange="loadProgressTable()">
        <option value="">-- 选择门店 --</option>
      </select>
      <button class="btn btn-secondary" onclick="resetStore()">重置本店进度为初始值</button>
    </div>
    <div id="progressTable">请先选择门店</div>
  </div>
</div>

<!-- Tab 2: 员工管理 -->
<div class="panel" id="panel-employees">
  <div class="card">
    <h2>员工列表</h2>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
      <select id="empStoreSelect" onchange="loadEmployeeTable()">
        <option value="">-- 选择门店 --</option>
      </select>
      <button class="btn" onclick="showAddEmployee()">+ 新增员工</button>
    </div>
    <div id="employeeTable">请先选择门店</div>
  </div>
  <div class="card" id="addEmpForm" style="display:none">
    <h2>新增员工</h2>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <input type="text" id="newEmpName" placeholder="姓名">
      <select id="newEmpRole">
        <option>店长</option><option>副店长</option><option>资深销售顾问</option><option>销售顾问</option>
      </select>
      <label><input type="checkbox" id="newEmpIsManager"> 店长权限</label>
      <button class="btn" onclick="addEmployee()">保存</button>
      <button class="btn btn-secondary" onclick="document.getElementById('addEmpForm').style.display='none'">取消</button>
    </div>
  </div>
</div>

<!-- Tab 3: 系统操作 -->
<div class="panel" id="panel-system">
  <div class="card">
    <h2>数据库统计</h2>
    <div class="stats-row" id="systemStats">加载中...</div>
  </div>
  <div class="card">
    <h2>危险操作</h2>
    <p style="color:#94a3b8;font-size:13px;margin-bottom:16px">以下操作不可逆，请谨慎执行。</p>
    <button class="btn btn-danger" onclick="confirmReseed()">🔄 重新 Seed 全部数据（清空并重建）</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const H = () => Auth.authHeaders();

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['progress','employees','system'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'system') loadSystemStats();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

// 初始化
async function init() {
  const user = Auth.getUser();
  document.getElementById('adminWelcome').textContent = `欢迎，${user ? user.name : 'admin'}`;
  // 填充门店下拉
  const stores = await fetch('/api/stores', { headers: H() }).then(r => r.json());
  const opts = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('storeSelect').innerHTML = '<option value="">-- 选择门店 --</option>' + opts;
  document.getElementById('empStoreSelect').innerHTML = '<option value="">-- 选择门店 --</option>' + opts;
}

// ── 进度管理 ──
async function loadProgressTable() {
  const sid = document.getElementById('storeSelect').value;
  if (!sid) return;
  const emps = await fetch(`/api/stores/${sid}/employees`, { headers: H() }).then(r => r.json());
  const rows = emps.map(e => `
    <tr>
      <td>${e.name}</td><td>${e.role}</td>
      <td><span class="badge badge-${e.riskLevel}">${e.riskLevel}</span></td>
      <td><input type="number" min="0" max="28" value="${e.scModules}" id="sc_${e.id}" style="width:60px"></td>
      <td><input type="number" min="0" max="100" value="${e.scTest}" id="test_${e.id}" style="width:60px"></td>
      <td><input type="checkbox" ${e.liveWatched ? 'checked' : ''} id="live_${e.id}"></td>
      <td><input type="number" min="0" max="2" value="${e.mypalDays}" id="mypal_${e.id}" style="width:50px"></td>
      <td><input type="number" min="0" max="6" value="${e.aiCoach}" id="ai_${e.id}" style="width:50px"></td>
      <td><button class="btn" onclick="saveProgress('${e.id}')">保存</button></td>
    </tr>
  `).join('');
  document.getElementById('progressTable').innerHTML = `
    <table>
      <tr><th>姓名</th><th>角色</th><th>风险</th><th>SC模块</th><th>SC测验</th><th>直播</th><th>MyPAL天</th><th>AI Coach</th><th>操作</th></tr>
      ${rows}
    </table>`;
}

async function saveProgress(empId) {
  const body = {
    scModules: parseInt(document.getElementById('sc_' + empId).value),
    scTest: parseInt(document.getElementById('test_' + empId).value),
    liveWatched: document.getElementById('live_' + empId).checked,
    mypalDays: parseInt(document.getElementById('mypal_' + empId).value),
    aiCoach: parseInt(document.getElementById('ai_' + empId).value),
  };
  const res = await fetch(`/api/admin/employees/${empId}`, {
    method: 'PUT', headers: H(), body: JSON.stringify(body),
  });
  if (res.ok) { showToast('✅ 已保存'); loadProgressTable(); }
  else showToast('❌ 保存失败: ' + (await res.json()).error);
}

async function resetStore() {
  const sid = document.getElementById('storeSelect').value;
  if (!sid) return showToast('请先选择门店');
  if (!confirm(`确认将 ${sid} 门店的员工进度重置为初始值？`)) return;
  const res = await fetch(`/api/admin/stores/${sid}/reset`, { method: 'POST', headers: H() });
  const d = await res.json();
  showToast(`✅ 已重置 ${d.resetCount} 名员工`);
  loadProgressTable();
}

// ── 员工管理 ──
async function loadEmployeeTable() {
  const sid = document.getElementById('empStoreSelect').value;
  if (!sid) return;
  const emps = await fetch(`/api/stores/${sid}/employees`, { headers: H() }).then(r => r.json());
  const rows = emps.map(e => `
    <tr>
      <td>${e.id}</td><td>${e.name}</td><td>${e.role}</td>
      <td>${e.isManager ? '✅' : ''}</td>
      <td><span class="badge badge-${e.riskLevel}">${e.riskLevel}</span></td>
      <td><button class="btn btn-danger" style="padding:4px 10px;font-size:12px" onclick="deleteEmployee('${e.id}','${e.name}')">删除</button></td>
    </tr>
  `).join('');
  document.getElementById('employeeTable').innerHTML = `
    <table>
      <tr><th>ID</th><th>姓名</th><th>角色</th><th>店长</th><th>风险</th><th>操作</th></tr>
      ${rows}
    </table>`;
}

function showAddEmployee() {
  document.getElementById('addEmpForm').style.display = 'block';
}

async function addEmployee() {
  const sid = document.getElementById('empStoreSelect').value;
  if (!sid) return showToast('请先选择门店');
  const name = document.getElementById('newEmpName').value.trim();
  const role = document.getElementById('newEmpRole').value;
  const isManager = document.getElementById('newEmpIsManager').checked;
  if (!name) return showToast('请输入姓名');
  const res = await fetch('/api/admin/employees', {
    method: 'POST', headers: H(),
    body: JSON.stringify({ storeId: sid, name, role, isManager }),
  });
  if (res.ok) {
    const d = await res.json();
    showToast(`✅ 已新增 ${d.name}（${d.id}），账号：emp_${d.id} / Train2026!`);
    document.getElementById('addEmpForm').style.display = 'none';
    loadEmployeeTable();
  } else {
    showToast('❌ 新增失败: ' + (await res.json()).error);
  }
}

async function deleteEmployee(empId, name) {
  if (!confirm(`确认删除 ${name}（${empId}）及其登录账号？`)) return;
  const res = await fetch(`/api/admin/employees/${empId}`, { method: 'DELETE', headers: H() });
  if (res.ok) { showToast(`✅ 已删除 ${name}`); loadEmployeeTable(); }
  else showToast('❌ 删除失败');
}

// ── 系统操作 ──
async function loadSystemStats() {
  const [stores, emps, tasks] = await Promise.all([
    fetch('/api/stores', { headers: H() }).then(r => r.json()),
    fetch('/api/admin/employees', { headers: H() }).then(r => r.json()),
    fetch('/api/tasks', { headers: H() }).then(r => r.json()),
  ]);
  document.getElementById('systemStats').innerHTML = `
    <div class="stat-card"><div class="val">${stores.length}</div><div class="lbl">门店数</div></div>
    <div class="stat-card"><div class="val">${emps.length}</div><div class="lbl">员工数</div></div>
    <div class="stat-card"><div class="val">${tasks.length}</div><div class="lbl">活跃任务数</div></div>
  `;
}

async function confirmReseed() {
  if (!confirm('⚠️ 此操作将清空所有门店、员工、用户和任务数据，并重新生成 seed 数据。\n所有账号密码将重置。\n确认继续？')) return;
  if (!confirm('最后确认：重新 Seed 全部数据？')) return;
  const res = await fetch('/api/admin/seed', {
    method: 'POST', headers: H(), body: JSON.stringify({ confirm: true }),
  });
  const d = await res.json();
  if (res.ok) showToast(`✅ Seed 完成：${d.stores} 家门店，${d.employees} 名员工，${d.users} 个账号`);
  else showToast('❌ Seed 失败: ' + d.error);
}

init();
</script>
</body>
</html>
```

- [ ] **Step 2: 验证 admin.html 可访问**

```bash
pkill -f "node index.js" 2>/dev/null || true; sleep 1; cd /Users/skyler/Desktop/MVP/server && nohup node index.js > /tmp/mvp-server.log 2>&1 & curl -s --retry 8 --retry-connrefused --retry-delay 1 http://localhost:8080/api/health
```

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/admin.html
```

Expected: `200`

- [ ] **Step 3: 验证 admin.html 包含 requireRole('admin')**

```bash
grep -c "requireRole.*admin" /Users/skyler/Desktop/MVP/front-end/admin.html
```

Expected: `1`

```bash
pkill -f "node index.js" 2>/dev/null || true
```

---

## Phase 4 完成验收标准

- [ ] `POST /api/tasks` central 账号创建任务，返回含 id 和 config 的任务对象（201）
- [ ] `POST /api/alerts/:id/ack` store_S001 账号确认 S001 告警，返回 `ok: true` 和更新后的告警
- [ ] `POST /api/alerts/:id/ack` store_S001 访问 S002 的告警返回 403
- [ ] `POST /api/intel` emp_E005 提交情报，返回 201 含 type: 'intel'
- [ ] `POST /api/voc` emp_E005 提交 VOC，返回 201 含 type: 'voc'
- [ ] `POST /api/help` emp_E005 提交求助，返回 201 含 type: 'help'
- [ ] `POST /api/ai/chat` 返回 answer/confidence/source 字段
- [ ] `PUT /api/admin/employees/:id` admin 账号更新员工进度，返回更新后对象
- [ ] `POST /api/admin/employees` admin 账号新增员工，返回 201，自动创建 emp_<id>/Train2026! 账号
- [ ] `DELETE /api/admin/employees/:id` admin 删除员工，关联用户账号同时删除
- [ ] `POST /api/admin/stores/:id/reset` admin 重置门店进度，返回 `{ ok: true, resetCount: N }`
- [ ] `POST /api/admin/seed` admin 发送 `{ confirm: true }` 触发全量重置，返回计数
- [ ] 浏览器用 admin/Admin2026! 登录后跳转 admin.html，页面正常显示门店列表
- [ ] admin.html 中选择门店后展示员工进度表格，可内联编辑并保存
- [ ] 浏览器 chatbot（employee.html 中）发送消息后调用 /api/ai/chat 接口
