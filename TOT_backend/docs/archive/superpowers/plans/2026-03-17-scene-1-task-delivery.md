# 场景一：任务下发与执行 - 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现总部→店长/店员的完整任务下发链路，包括任务创建、推送、接收、执行、状态更新的全流程闭环。

**Architecture:**
- **后端核心**: 任务状态机 + 事件驱动推送 + WebSocket广播
- **前端体验**: 总部创建→实时看板+推送通知→店长管理+店员执行→状态同步
- **数据流向**: 单向下发(总部→店长/店员) + 双向回传(完成状态↔系统) + 全局同步(看板实时刷新)

**Tech Stack:**
- 后端: Node.js + Express + SQLite + WebSocket
- 前端: Vanilla JS + CSS3 + Chart.js
- 通信: REST API + WebSocket(推荐) / Polling(降级)

---

## 文件结构规划

```
server/
├── routes/
│   ├── tasks.js          [修改] 扩展任务API (分页/查询/下发)
│   └── push.js           [新建] 推送服务路由
├── services/
│   ├── taskService.js    [新建] 任务业务逻辑 (创建/下发/查询)
│   ├── pushService.js    [新建] 推送引擎 (消息构建+批量发送)
│   └── stateSync.js      [新建] 状态同步 (事件→广播)
└── schema/
    └── tasks.sql         [新建] 任务表 + 任务状态表 + 推送日志表

front-end/
├── js/
│   ├── api.js            [修改] 新增 postTask/getTaskList/updateTaskStatus
│   ├── central-tasks.js  [新建] 总部任务创建逻辑
│   ├── store-tasks.js    [新建] 店长任务接收&管理逻辑
│   ├── employee-tasks.js [新建] 店员任务执行逻辑
│   └── notifications.js  [新建] 推送通知UI管理
├── central.html          [修改] 添加任务创建panel内容
├── store.html            [修改] 添加任务列表&管理panel
├── employee.html         [修改] 添加任务详情&执行panel
└── css/
    └── tasks.css         [新建] 任务相关样式
```

---

## Chunk 1: 后端数据模型与任务API

### Task 1: 创建任务表和状态表

**Files:**
- Create: `server/schema/tasks.sql`
- Modify: `server/db.js`

- [ ] **Step 1: 编写任务表SQL schema**

```sql
-- 任务主表
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- pending(待下发) | dispatched(已下发) | completed(已完成) | cancelled(已取消)
  target_role TEXT,               -- 'all' | 'store_manager' | 'employee' | 'both'
  store_scope TEXT,               -- JSON: 'all' | ['store_1','store_2',...]
  deadline TEXT,                  -- ISO 8601
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  config_json TEXT,               -- 额外配置
  updated_at TEXT
);

-- 任务分配表 (店长/店员维度)
CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  assignee_id TEXT NOT NULL,      -- 店长ID或店员ID
  assignee_role TEXT NOT NULL,    -- 'store_manager' | 'employee'
  store_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending(待接收) | received(已接收) | in_progress(进行中) | completed(已完成) | failed(已失败)
  received_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 推送日志表 (追踪消息投递)
CREATE TABLE IF NOT EXISTS push_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  assignment_id TEXT,
  recipient_id TEXT NOT NULL,
  recipient_type TEXT,           -- 'store_manager' | 'employee'
  status TEXT DEFAULT 'pending',  -- pending(待发送) | sent(已发送) | failed(失败) | read(已读)
  channel TEXT DEFAULT 'websocket', -- 'websocket' | 'polling' | 'fallback'
  message_json TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  read_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

- [ ] **Step 2: 修改 db.js 以初始化新表**

读取 `server/db.js` 后添加schema初始化逻辑：

```javascript
// 在db.js的初始化部分加入
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'schema', 'tasks.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
const statements = schema.split(';').filter(s => s.trim());
statements.forEach(stmt => {
  try {
    db.exec(stmt);
  } catch (err) {
    console.warn('Schema statement already exists or error:', err.message);
  }
});
```

- [ ] **Step 3: 运行数据库初始化并验证表创建**

```bash
cd server && npm install
node -e "const db = require('./db'); console.log('✓ Schema initialized');"
```

Expected: ✓ Schema initialized (无error)

- [ ] **Step 4: 提交**

```bash
git add server/schema/tasks.sql server/db.js
git commit -m "feat: create task schema with assignments and push logs tables

- 添加任务主表 (tasks)
- 添加任务分配表 (task_assignments) 用于店长/店员维度追踪
- 添加推送日志表 (push_logs) 用于消息投递跟踪
- 初始化db.js以自动应用schema

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 扩展任务API - 创建任务接口

**Files:**
- Create: `server/services/taskService.js`
- Modify: `server/routes/tasks.js`
- Modify: `server/db.js`

- [ ] **Step 1: 编写任务业务逻辑服务**

Create `server/services/taskService.js`:

```javascript
const db = require('../db');

class TaskService {
  // 创建任务 (总部端)
  static createTask(data) {
    const {
      name,
      description,
      targetRole = 'both',      // 'store_manager' | 'employee' | 'both'
      storeScope = 'all',       // 'all' | JSON array
      deadline,
      createdBy,
      config = {}
    } = data;

    if (!name) throw new Error('Task name is required');

    const id = 'T' + String(Date.now()).slice(-6) + Math.random().toString(36).slice(2, 5);
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO tasks (
        id, name, description, status, target_role, store_scope,
        deadline, created_by, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id, name, description, targetRole,
      typeof storeScope === 'string' ? storeScope : JSON.stringify(storeScope),
      deadline || null,
      createdBy,
      JSON.stringify(config),
      now, now
    );

    return this.getTaskById(id);
  }

  // 获取单个任务
  static getTaskById(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;
    return this._formatTask(task);
  }

  // 获取所有任务 (分页+过滤)
  static getTaskList(filters = {}) {
    const { status = 'all', limit = 50, offset = 0 } = filters;

    let query = 'SELECT * FROM tasks';
    const params = [];

    if (status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const tasks = db.prepare(query).all(...params);
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM tasks ${status !== 'all' ? 'WHERE status = ?' : ''}`).get(...(status !== 'all' ? [status] : []));

    return {
      data: tasks.map(t => this._formatTask(t)),
      total: count.cnt,
      limit,
      offset
    };
  }

  // 获取任务对应的所有分配记录
  static getTaskAssignments(taskId) {
    const assignments = db.prepare(`
      SELECT * FROM task_assignments WHERE task_id = ? ORDER BY created_at
    `).all(taskId);
    return assignments;
  }

  // 内部格式化方法
  static _formatTask(task) {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      status: task.status,
      targetRole: task.target_role,
      storeScope: task.store_scope === 'all' ? 'all' : JSON.parse(task.store_scope || '[]'),
      deadline: task.deadline,
      createdBy: task.created_by,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      config: JSON.parse(task.config_json || '{}')
    };
  }
}

module.exports = TaskService;
```

- [ ] **Step 2: 修改 tasks.js 路由，集成TaskService**

```javascript
const express = require('express');
const { requireRole } = require('../auth');
const TaskService = require('../services/taskService');

const router = express.Router();

// GET /api/tasks — 获取任务列表
router.get('/tasks', (req, res) => {
  try {
    const { status = 'all', limit = 50, offset = 0 } = req.query;
    const result = TaskService.getTaskList({
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks — 创建任务 (总部端)
router.post('/tasks', requireRole('central', 'admin'), (req, res) => {
  try {
    const task = TaskService.createTask({
      name: req.body.name,
      description: req.body.description,
      targetRole: req.body.targetRole || 'both',
      storeScope: req.body.storeScope || 'all',
      deadline: req.body.deadline,
      createdBy: req.user.name || req.user.role,
      config: req.body.config || {}
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/tasks/:id — 获取单个任务详情
router.get('/tasks/:id', (req, res) => {
  try {
    const task = TaskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const assignments = TaskService.getTaskAssignments(req.params.id);
    res.json({ ...task, assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: 运行测试 - 创建任务**

```bash
curl -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{
    "name": "Q1新品培训",
    "description": "iPhone 17基础知识",
    "targetRole": "both",
    "storeScope": "all",
    "deadline": "2026-03-31T23:59:59Z"
  }'
```

Expected: HTTP 201 + Task object with id, status='pending'

- [ ] **Step 4: 运行测试 - 获取任务列表**

```bash
curl http://localhost:8080/api/tasks
```

Expected: HTTP 200 + { data: [...], total: 1, limit: 50, offset: 0 }

- [ ] **Step 5: 提交**

```bash
git add server/services/taskService.js server/routes/tasks.js
git commit -m "feat: add task creation and listing API

- 创建TaskService处理任务CRUD逻辑
- 扩展POST /api/tasks 创建任务接口
- 扩展GET /api/tasks 获取任务列表 (分页)
- 添加GET /api/tasks/:id 获取任务详情
- 所有任务初始状态为'pending'

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 实现任务下发与分配逻辑

**Files:**
- Create: `server/services/dispatchService.js`
- Modify: `server/services/taskService.js`

- [ ] **Step 1: 编写下发服务**

Create `server/services/dispatchService.js`:

```javascript
const db = require('../db');

class DispatchService {
  // 下发任务给指定店铺的店长/店员
  static dispatchTask(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'pending') throw new Error('Only pending tasks can be dispatched');

    // 获取目标店铺列表
    let storeIds = [];
    if (task.store_scope === 'all') {
      const stores = db.prepare('SELECT id FROM stores').all();
      storeIds = stores.map(s => s.id);
    } else {
      try {
        storeIds = JSON.parse(task.store_scope);
      } catch {
        storeIds = [];
      }
    }

    const now = new Date().toISOString();
    const insertAssignment = db.prepare(`
      INSERT INTO task_assignments (
        id, task_id, assignee_id, assignee_role, store_id,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    const roles = task.target_role === 'both'
      ? ['store_manager', 'employee']
      : [task.target_role];

    let assignmentCount = 0;

    // 为每个店铺×角色生成分配记录
    storeIds.forEach(storeId => {
      roles.forEach(role => {
        // 获取该店铺的该角色员工列表
        const field = role === 'store_manager' ? 'manager_id' : 'id';
        const employees = db.prepare(`
          SELECT id, name FROM employees
          WHERE store_id = ? AND role = ?
        `).all(storeId, role);

        employees.forEach(emp => {
          const assignmentId = 'A' + String(Date.now()).slice(-6) + Math.random().toString(36).slice(2, 5);
          insertAssignment.run(
            assignmentId,
            taskId,
            emp.id,
            role,
            storeId,
            now, now
          );
          assignmentCount++;
        });
      });
    });

    // 更新任务状态为已下发
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(
      'dispatched', now, taskId
    );

    return {
      taskId,
      assignmentCount,
      dispatchedAt: now
    };
  }

  // 获取指定角色的待接收任务
  static getPendingTasks(assigneeId, assigneeRole) {
    const tasks = db.prepare(`
      SELECT t.*, ta.id as assignment_id, ta.status as assignment_status
      FROM tasks t
      JOIN task_assignments ta ON t.id = ta.task_id
      WHERE ta.assignee_id = ? AND ta.assignee_role = ? AND ta.status = 'pending'
      ORDER BY t.deadline ASC
    `).all(assigneeId, assigneeRole);

    return tasks.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      deadline: t.deadline,
      assignmentId: t.assignment_id,
      storeId: t.store_id
    }));
  }
}

module.exports = DispatchService;
```

- [ ] **Step 2: 添加dispatch端点到tasks.js**

```javascript
// 在routes/tasks.js中添加
const DispatchService = require('../services/dispatchService');

// POST /api/tasks/:id/dispatch — 下发任务
router.post('/tasks/:id/dispatch', requireRole('central', 'admin'), (req, res) => {
  try {
    const result = DispatchService.dispatchTask(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/my-tasks — 获取当前用户的待接收任务
router.get('/my-tasks', (req, res) => {
  try {
    const assigneeId = req.user.id;
    const assigneeRole = req.user.role; // 'store_manager' or 'employee'
    const tasks = DispatchService.getPendingTasks(assigneeId, assigneeRole);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: 测试下发流程**

```bash
# 1. 创建任务
TASK_ID=$(curl -s -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","targetRole":"both","deadline":"2026-03-31"}' | jq -r '.id')

# 2. 下发任务
curl -X POST http://localhost:8080/api/tasks/$TASK_ID/dispatch \
  -H "Authorization: Bearer token"

# 3. 检查分配状态
curl http://localhost:8080/api/tasks/$TASK_ID
```

Expected: assignment_count > 0, task status changed to 'dispatched'

- [ ] **Step 4: 提交**

```bash
git add server/services/dispatchService.js server/routes/tasks.js
git commit -m "feat: add task dispatch and assignment logic

- 创建DispatchService处理任务下发
- 根据目标角色生成task_assignments记录
- 添加POST /api/tasks/:id/dispatch 下发任务
- 添加GET /api/my-tasks 获取当前用户待接收任务
- 实现店长/店员维度的任务列表查询

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Chunk 2: 前端总部端 - 任务创建表单

### Task 4: 实现总部端任务创建UI

**Files:**
- Create: `front-end/js/central-tasks.js`
- Modify: `front-end/central.html`
- Modify: `front-end/js/api.js`

- [ ] **Step 1: 扩展api.js，添加任务API调用**

在 `front-end/js/api.js` 中添加：

```javascript
// 任务相关API
window.TaskAPI = {
  // 创建任务
  createTask: function(data) {
    return fetch(API_BASE + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  // 获取任务列表
  getTaskList: function(filters = {}) {
    const params = new URLSearchParams(filters);
    return fetch(API_BASE + '/api/tasks?' + params)
      .then(r => r.json());
  },

  // 下发任务
  dispatchTask: function(taskId) {
    return fetch(API_BASE + '/api/tasks/' + taskId + '/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).then(r => r.json());
  },

  // 获取任务详情
  getTaskDetail: function(taskId) {
    return fetch(API_BASE + '/api/tasks/' + taskId)
      .then(r => r.json());
  }
};
```

- [ ] **Step 2: 创建central-tasks.js任务创建逻辑**

Create `front-end/js/central-tasks.js`:

```javascript
(function() {
  window.CentralTasks = {
    currentTask: null,

    init: function() {
      this.setupFormHandlers();
      this.loadTaskList();
    },

    setupFormHandlers: function() {
      const form = document.getElementById('taskCreateForm');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleCreateTask();
        });
      }
    },

    handleCreateTask: function() {
      const name = document.getElementById('taskName')?.value;
      const description = document.getElementById('taskDescription')?.value;
      const deadline = document.getElementById('taskDeadline')?.value;
      const targetRole = document.getElementById('taskTargetRole')?.value || 'both';
      const storeScope = document.getElementById('taskStoreScope')?.value || 'all';

      if (!name) {
        showToast('任务名称不能为空', 'error');
        return;
      }

      TaskAPI.createTask({
        name,
        description,
        deadline,
        targetRole,
        storeScope,
        config: {}
      }).then(task => {
        showToast('✓ 任务创建成功');
        this.resetForm();
        this.loadTaskList();
        this.showDispatchModal(task);
      }).catch(err => {
        showToast('✗ 创建失败: ' + err.message, 'error');
      });
    },

    showDispatchModal: function(task) {
      const modal = document.getElementById('dispatchModal');
      if (!modal) return;

      document.getElementById('dispatchTaskName').textContent = task.name;
      document.getElementById('dispatchTaskId').value = task.id;

      modal.classList.remove('modal-hidden');
      document.getElementById('confirmDispatchBtn').onclick = () => {
        this.handleDispatch(task.id);
      };
    },

    handleDispatch: function(taskId) {
      TaskAPI.dispatchTask(taskId).then(result => {
        showToast('✓ 任务已下发 (' + result.assignmentCount + '人)');
        document.getElementById('dispatchModal').classList.add('modal-hidden');
        this.loadTaskList();
      }).catch(err => {
        showToast('✗ 下发失败: ' + err.message, 'error');
      });
    },

    loadTaskList: function() {
      TaskAPI.getTaskList({ status: 'all', limit: 20 }).then(result => {
        this.renderTaskList(result.data);
      }).catch(err => {
        console.warn('Failed to load tasks:', err);
      });
    },

    renderTaskList: function(tasks) {
      const container = document.getElementById('taskListContainer');
      if (!container) return;

      container.innerHTML = tasks.map(t => `
        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-weight:600;font-size:14px">${t.name}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px">${t.description || '无描述'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:6px">
                创建人：${t.createdBy} · ${new Date(t.createdAt).toLocaleString()}
              </div>
            </div>
            <span class="badge ${t.status === 'pending' ? 'badge-blue' : t.status === 'dispatched' ? 'badge-ok' : 'badge-p2'}">
              ${t.status === 'pending' ? '待下发' : t.status === 'dispatched' ? '已下发' : '已完成'}
            </span>
          </div>
        </div>
      `).join('');
    },

    resetForm: function() {
      const form = document.getElementById('taskCreateForm');
      if (form) form.reset();
    }
  };

  // 页面加载时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.CentralTasks.init());
  } else {
    window.CentralTasks.init();
  }
})();
```

- [ ] **Step 3: 在central.html中添加任务创建panel**

在 `front-end/central.html` 中找到注释 `<!-- ════════════════ CREATE TASK ════════════════ -->`，替换内容为：

```html
<!-- ════════════════ CREATE TASK (CA-001) ════════════════ -->
<div class="panel" id="panel-create">
  <div class="flex-between mb-6">
    <div>
      <h1 style="font-size:22px;font-weight:700">布置学习任务</h1>
      <p style="font-size:13px;color:var(--muted);margin-top:2px"><span style="color:var(--accent);font-weight:600">CA-001</span> · 创建任务 · 双路下发至店长+店员</p>
    </div>
  </div>

  <!-- 任务创建表单 -->
  <div class="card" style="max-width:600px">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px">新建任务</h2>
    <form id="taskCreateForm">
      <div style="margin-bottom:16px">
        <label class="form-label">任务名称 *</label>
        <input type="text" id="taskName" class="form-input" placeholder="e.g. Q1新品iPhone 17培训" required>
      </div>

      <div style="margin-bottom:16px">
        <label class="form-label">任务描述</label>
        <textarea id="taskDescription" class="form-input" rows="3" placeholder="任务详细说明（可选）" style="resize:vertical"></textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label class="form-label">目标角色 *</label>
          <select id="taskTargetRole" class="form-input form-select">
            <option value="both">店长 + 店员</option>
            <option value="store_manager">仅店长</option>
            <option value="employee">仅店员</option>
          </select>
        </div>
        <div>
          <label class="form-label">店铺范围 *</label>
          <select id="taskStoreScope" class="form-input form-select">
            <option value="all">全部50家门店</option>
            <option value="custom">自定义选择</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <label class="form-label">截止时间 *</label>
        <input type="datetime-local" id="taskDeadline" class="form-input" required>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%">
        <i class="fas fa-check"></i> 创建任务
      </button>
    </form>
  </div>

  <!-- 最近任务列表 -->
  <div style="margin-top:24px">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:12px">最近任务</h2>
    <div id="taskListContainer" style="display:flex;flex-direction:column">
      <div style="text-align:center;color:var(--muted);padding:20px">加载中...</div>
    </div>
  </div>
</div>

<!-- 下发确认弹窗 -->
<div class="modal-overlay modal-hidden" id="dispatchModal">
  <div class="modal">
    <h2 style="font-size:18px;font-weight:600;margin-bottom:12px">确认下发任务</h2>
    <div style="background:var(--surface2);padding:12px;border-radius:8px;margin-bottom:16px">
      <div style="font-size:13px;color:var(--muted)">任务名称</div>
      <div id="dispatchTaskName" style="font-size:16px;font-weight:600;color:white;margin-top:4px"></div>
      <input type="hidden" id="dispatchTaskId">
    </div>
    <div style="color:var(--muted);font-size:13px;margin-bottom:16px">
      任务将被推送到所有符合条件的店长和店员，请确认后继续。
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('dispatchModal').classList.add('modal-hidden')" class="btn btn-ghost">取消</button>
      <button id="confirmDispatchBtn" class="btn btn-primary">
        <i class="fas fa-paper-plane"></i> 确认下发
      </button>
    </div>
  </div>
</div>

<script src="js/central-tasks.js"></script>
```

- [ ] **Step 4: 手动测试UI和创建流程**

1. 在浏览器打开 `http://localhost:8080/central.html`
2. 点击左侧导航 "布置学习任务"
3. 填写表单，点击"创建任务"
4. 确认弹窗，点击"确认下发"
5. 检查DevTools console 是否有错误

Expected: 表单成功提交，弹窗关闭，任务列表更新

- [ ] **Step 5: 提交**

```bash
git add front-end/js/central-tasks.js front-end/central.html front-end/js/api.js
git commit -m "feat: implement central task creation UI and API integration

- 扩展api.js添加TaskAPI (createTask/getTaskList/dispatchTask/getTaskDetail)
- 创建central-tasks.js处理任务创建逻辑
- 在central.html中添加任务创建panel和确认弹窗
- 支持任务名称、描述、目标角色、店铺范围、截止时间配置
- 下发后实时更新任务列表状态

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Chunk 3: 前端店长端 - 任务接收与管理

### Task 5: 实现店长端任务接收UI

**Files:**
- Create: `front-end/js/store-tasks.js`
- Modify: `front-end/store.html`

- [ ] **Step 1: 创建store-tasks.js店长端逻辑**

Create `front-end/js/store-tasks.js`:

```javascript
(function() {
  window.StoreTasks = {
    pendingTasks: [],
    completedTasks: [],

    init: function() {
      this.setupPolling();
      this.loadMyTasks();
      this.setupTabHandlers();
    },

    setupPolling: function() {
      // 使用WebSocket或polling监听任务更新
      window.API.onStateUpdate((state) => {
        if (state && state.type === 'task_update') {
          this.loadMyTasks();
        }
      });
    },

    loadMyTasks: function() {
      TaskAPI.getTaskList?.({ status: 'dispatched', limit: 50 }).then(result => {
        // 简化：所有已下发的任务都显示给店长
        this.pendingTasks = result.data.filter(t => !t.completed);
        this.completedTasks = result.data.filter(t => t.completed);
        this.renderTasks();
      }).catch(err => console.warn('Failed to load tasks:', err));
    },

    renderTasks: function() {
      const pendingContainer = document.getElementById('storeTasksPending');
      const completedContainer = document.getElementById('storeTasksCompleted');

      if (pendingContainer) {
        pendingContainer.innerHTML = this.pendingTasks.map(t => `
          <div class="card" style="margin-bottom:12px;cursor:pointer" onclick="StoreTasks.showTaskDetail('${t.id}')">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px">${t.name}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px">${t.description || ''}</div>
                <div style="font-size:11px;color:var(--yellow);margin-top:6px">
                  ⏰ 截止：${new Date(t.deadline).toLocaleString()}
                </div>
              </div>
              <span class="badge badge-blue">未开始</span>
            </div>
          </div>
        `).join('') || '<div style="text-align:center;color:var(--muted);padding:20px">暂无待办任务</div>';
      }

      if (completedContainer) {
        completedContainer.innerHTML = this.completedTasks.map(t => `
          <div class="card" style="margin-bottom:12px;opacity:0.7">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:14px">${t.name}</div>
              <span class="badge badge-ok">✓ 已完成</span>
            </div>
          </div>
        `).join('') || '<div style="text-align:center;color:var(--muted);padding:20px">暂无已完成任务</div>';
      }
    },

    showTaskDetail: function(taskId) {
      const task = this.pendingTasks.find(t => t.id === taskId);
      if (!task) return;

      const modal = document.getElementById('storeTaskDetailModal');
      if (!modal) return;

      document.getElementById('storeTaskDetailName').textContent = task.name;
      document.getElementById('storeTaskDetailDesc').textContent = task.description;
      document.getElementById('storeTaskDetailDeadline').textContent = new Date(task.deadline).toLocaleString();

      document.getElementById('storeTaskStartBtn').onclick = () => {
        this.startTask(taskId);
      };

      modal.classList.remove('modal-hidden');
    },

    startTask: function(taskId) {
      // 这里会在后续实现任务状态更新的API
      showToast('✓ 任务已开始');
      document.getElementById('storeTaskDetailModal').classList.add('modal-hidden');
      this.loadMyTasks();
    },

    setupTabHandlers: function() {
      document.getElementById('storePendingTab')?.addEventListener('click', () => {
        document.getElementById('storePendingContent').style.display = 'block';
        document.getElementById('storeCompletedContent').style.display = 'none';
      });

      document.getElementById('storeCompletedTab')?.addEventListener('click', () => {
        document.getElementById('storePendingContent').style.display = 'none';
        document.getElementById('storeCompletedContent').style.display = 'block';
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.StoreTasks.init());
  } else {
    window.StoreTasks.init();
  }
})();
```

- [ ] **Step 2: 在store.html中添加任务管理panel**

在 `front-end/store.html` 中添加（如果尚未存在）：

```html
<!-- ════════════════ MY TASKS ════════════════ -->
<div class="panel" id="panel-tasks">
  <div class="flex-between mb-6">
    <div>
      <h1 style="font-size:22px;font-weight:700">我的任务</h1>
      <p style="font-size:13px;color:var(--muted);margin-top:2px">管理团队任务进度 · 催促未完成员工</p>
    </div>
  </div>

  <!-- 标签页 -->
  <div class="tab-bar" style="margin-bottom:16px">
    <div id="storePendingTab" class="tab active" onclick="this.classList.add('active');document.getElementById('storeCompletedTab').classList.remove('active')">
      📋 待办 <span style="background:var(--red);color:white;border-radius:9999px;padding:1px 6px;font-size:10px;margin-left:4px" id="pendingCount">0</span>
    </div>
    <div id="storeCompletedTab" class="tab" onclick="this.classList.add('active');document.getElementById('storePendingTab').classList.remove('active')">
      ✓ 已完成
    </div>
  </div>

  <!-- 待办任务 -->
  <div id="storePendingContent">
    <div id="storeTasksPending" style="display:flex;flex-direction:column">
      <div style="text-align:center;color:var(--muted);padding:20px">加载中...</div>
    </div>
  </div>

  <!-- 已完成任务 -->
  <div id="storeCompletedContent" style="display:none">
    <div id="storeTasksCompleted" style="display:flex;flex-direction:column">
      <div style="text-align:center;color:var(--muted);padding:20px">暂无已完成任务</div>
    </div>
  </div>
</div>

<!-- 任务详情弹窗 -->
<div class="modal-overlay modal-hidden" id="storeTaskDetailModal">
  <div class="modal">
    <h2 id="storeTaskDetailName" style="font-size:18px;font-weight:600;margin-bottom:12px"></h2>
    <div style="margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:8px">
      <div id="storeTaskDetailDesc" style="font-size:13px;color:var(--muted);line-height:1.6"></div>
      <div style="margin-top:8px;font-size:12px;color:var(--yellow)">
        📍 截止时间：<span id="storeTaskDetailDeadline"></span>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('storeTaskDetailModal').classList.add('modal-hidden')" class="btn btn-ghost" style="flex:1">关闭</button>
      <button id="storeTaskStartBtn" class="btn btn-primary" style="flex:1">
        <i class="fas fa-play"></i> 开始任务
      </button>
    </div>
  </div>
</div>

<script src="js/store-tasks.js"></script>
```

- [ ] **Step 3: 手动测试店长端**

1. 打开 `http://localhost:8080/store.html`
2. 应能看到任务列表
3. 点击任务卡片，弹窗展示详情
4. 点击"开始任务"按钮

Expected: 无JS错误，任务列表正确加载和显示

- [ ] **Step 4: 提交**

```bash
git add front-end/js/store-tasks.js front-end/store.html
git commit -m "feat: implement store manager task reception and management UI

- 创建store-tasks.js处理店长端任务逻辑
- 实现任务列表加载和渲染
- 添加待办/已完成标签页切换
- 任务详情弹窗展示
- 任务开始按钮（为后续状态更新预留接口）

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Chunk 4: 前端店员端 - 任务执行

### Task 6: 实现店员端任务执行UI

**Files:**
- Create: `front-end/js/employee-tasks.js`
- Modify: `front-end/employee.html`

- [ ] **Step 1: 创建employee-tasks.js店员端逻辑**

Create `front-end/js/employee-tasks.js`:

```javascript
(function() {
  window.EmployeeTasks = {
    myTasks: [],
    currentTask: null,

    init: function() {
      this.loadMyTasks();
      this.setupPolling();
    },

    setupPolling: function() {
      window.API.onStateUpdate?.((state) => {
        if (state && state.type === 'task_update') {
          this.loadMyTasks();
        }
      });
    },

    loadMyTasks: function() {
      TaskAPI.getTaskList?.({ status: 'dispatched', limit: 50 }).then(result => {
        this.myTasks = result.data;
        this.renderTaskList();
      }).catch(err => console.warn('Failed to load tasks:', err));
    },

    renderTaskList: function() {
      const container = document.getElementById('employeeTaskList');
      if (!container) return;

      container.innerHTML = this.myTasks.map(t => `
        <div class="card" style="margin-bottom:12px;cursor:pointer;border-left:3px solid var(--accent)"
             onclick="EmployeeTasks.showTaskDetail('${t.id}')">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px">${t.name}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px">${t.description || '点击查看详情'}</div>
              <div style="font-size:11px;color:var(--yellow);margin-top:6px">
                ⏰ 截止：${new Date(t.deadline).toLocaleString()}
              </div>
            </div>
            <span class="badge badge-blue">待完成</span>
          </div>
        </div>
      `).join('') || '<div style="text-align:center;color:var(--muted);padding:40px">暂无任务分配</div>';
    },

    showTaskDetail: function(taskId) {
      this.currentTask = this.myTasks.find(t => t.id === taskId);
      if (!this.currentTask) return;

      const modal = document.getElementById('employeeTaskDetailModal');
      if (!modal) return;

      document.getElementById('empTaskDetailTitle').textContent = this.currentTask.name;
      document.getElementById('empTaskDetailContent').innerHTML = `
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">任务说明</div>
          <div style="font-size:13px;line-height:1.6;color:white">
            ${this.currentTask.description || '点击学习课程'}
          </div>
        </div>
        <div style="padding:12px;background:rgba(245,158,11,.1);border-radius:8px;margin-bottom:16px">
          <div style="font-size:12px;color:var(--yellow)">
            ⏰ 截止时间：${new Date(this.currentTask.deadline).toLocaleString()}
          </div>
        </div>
        <div style="padding:12px;background:var(--surface2);border-radius:8px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">学习进度</div>
          <div class="progress-bar" style="height:6px;margin-bottom:8px">
            <div class="progress-fill" style="width:0%;background:var(--accent)"></div>
          </div>
          <div style="font-size:11px;color:var(--muted)">0% · 点击开始学习</div>
        </div>
      `;

      document.getElementById('empTaskCompleteBtn').onclick = () => {
        this.markTaskComplete(taskId);
      };

      modal.classList.remove('modal-hidden');
    },

    markTaskComplete: function(taskId) {
      // 这里会在后续实现任务完成状态API
      showToast('✓ 任务已标记为完成');
      document.getElementById('employeeTaskDetailModal').classList.add('modal-hidden');
      this.loadMyTasks();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.EmployeeTasks.init());
  } else {
    window.EmployeeTasks.init();
  }
})();
```

- [ ] **Step 2: 在employee.html中添加任务执行panel**

```html
<!-- ════════════════ MY TASKS ════════════════ -->
<div class="panel" id="panel-tasks">
  <div class="flex-between mb-6">
    <div>
      <h1 style="font-size:22px;font-weight:700">我的学习任务</h1>
      <p style="font-size:13px;color:var(--muted);margin-top:2px">完成分配的培训任务 · 按时提交</p>
    </div>
  </div>

  <div id="employeeTaskList" style="display:flex;flex-direction:column">
    <div style="text-align:center;color:var(--muted);padding:40px">加载中...</div>
  </div>
</div>

<!-- 任务详情 & 执行弹窗 -->
<div class="modal-overlay modal-hidden" id="employeeTaskDetailModal">
  <div class="modal" style="width:720px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 id="empTaskDetailTitle" style="font-size:18px;font-weight:600"></h2>
      <span class="badge badge-blue">学习中</span>
    </div>

    <div style="background:var(--surface2);padding:16px;border-radius:8px;margin-bottom:20px;max-height:300px;overflow-y:auto">
      <div id="empTaskDetailContent"></div>
    </div>

    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('employeeTaskDetailModal').classList.add('modal-hidden')" class="btn btn-ghost" style="flex:1">
        关闭
      </button>
      <button id="empTaskCompleteBtn" class="btn btn-green" style="flex:1">
        <i class="fas fa-check"></i> 标记为完成
      </button>
    </div>
  </div>
</div>

<script src="js/employee-tasks.js"></script>
```

- [ ] **Step 3: 手动测试店员端**

1. 打开 `http://localhost:8080/employee.html`
2. 应能看到任务列表
3. 点击任务卡片，弹窗展示详情和学习进度
4. 点击"标记为完成"按钮

Expected: 无JS错误，任务列表正确加载和显示

- [ ] **Step 4: 提交**

```bash
git add front-end/js/employee-tasks.js front-end/employee.html
git commit -m "feat: implement employee task execution UI

- 创建employee-tasks.js处理店员端任务逻辑
- 实现任务列表加载和渲染
- 任务详情弹窗展示学习进度条
- 任务完成按钮（为后续状态更新预留接口）
- 支持实时任务更新通知

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Chunk 5: 状态同步与WebSocket广播

### Task 7: 实现任务状态更新API

**Files:**
- Create: `server/services/stateSync.js`
- Modify: `server/routes/tasks.js`
- Modify: `server/index.js`

- [ ] **Step 1: 创建状态同步服务**

Create `server/services/stateSync.js`:

```javascript
const db = require('../db');

class StateSync {
  // 更新任务分配状态
  static updateAssignmentStatus(assignmentId, newStatus) {
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE task_assignments
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, now, assignmentId);

    // 获取更新后的assignment信息
    const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(assignmentId);

    // 检查任务是否全部完成
    this._checkTaskCompletion(assignment.task_id);

    return assignment;
  }

  // 检查任务是否全部完成
  static _checkTaskCompletion(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return;

    const totalAssignments = db.prepare('SELECT COUNT(*) as cnt FROM task_assignments WHERE task_id = ?').get(taskId).cnt;
    const completedAssignments = db.prepare('SELECT COUNT(*) as cnt FROM task_assignments WHERE task_id = ? AND status = ?').get(taskId, 'completed').cnt;

    // 如果所有分配都完成了，更新任务状态
    if (totalAssignments > 0 && totalAssignments === completedAssignments) {
      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('completed', now, taskId);
    }
  }

  // 获取任务的完成状态统计
  static getTaskStats(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM task_assignments
      WHERE task_id = ?
    `).get(taskId);

    return {
      taskId,
      taskStatus: task.status,
      ...stats
    };
  }

  // 广播状态更新事件 (供WebSocket使用)
  static broadcastStateUpdate(data) {
    if (typeof window !== 'undefined' && window._broadcastCallback) {
      window._broadcastCallback({
        type: 'task_update',
        data,
        at: new Date().toISOString()
      });
    }
  }
}

module.exports = StateSync;
```

- [ ] **Step 2: 添加状态更新API到tasks.js**

在 `server/routes/tasks.js` 中添加：

```javascript
const StateSync = require('../services/stateSync');

// PATCH /api/assignments/:assignmentId — 更新任务分配状态
router.patch('/assignments/:assignmentId', (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const assignment = StateSync.updateAssignmentStatus(req.params.assignmentId, status);
    const stats = StateSync.getTaskStats(assignment.task_id);

    res.json({ assignment, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/stats — 获取任务完成统计
router.get('/tasks/:id/stats', (req, res) => {
  try {
    const stats = StateSync.getTaskStats(req.params.id);
    if (!stats) return res.status(404).json({ error: 'Task not found' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: 在server/index.js中添加WebSocket状态广播**

在WebSocket message处理中添加：

```javascript
// 在ws.onmessage处理部分添加
if (data && data.type === 'task_status_update') {
  const { assignmentId, status } = data;
  try {
    const StateSync = require('./services/stateSync');
    const result = StateSync.updateAssignmentStatus(assignmentId, status);
    const stats = StateSync.getTaskStats(result.task_id);

    // 广播给所有连接的客户端
    broadcastState();

    ws.send(JSON.stringify({
      type: 'task_update_response',
      success: true,
      data: { assignment: result, stats }
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'task_update_response',
      success: false,
      error: err.message
    }));
  }
}
```

- [ ] **Step 4: 扩展api.js支持状态更新**

在 `front-end/js/api.js` 中添加：

```javascript
window.TaskAPI.updateAssignmentStatus = function(assignmentId, status) {
  return fetch(API_BASE + '/api/assignments/' + assignmentId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  }).then(r => r.json());
};

window.TaskAPI.getTaskStats = function(taskId) {
  return fetch(API_BASE + '/api/tasks/' + taskId + '/stats')
    .then(r => r.json());
};
```

- [ ] **Step 5: 在store-tasks.js和employee-tasks.js中调用状态更新**

Update `front-end/js/store-tasks.js`:

```javascript
startTask: function(taskId) {
  const task = this.pendingTasks.find(t => t.id === taskId);
  if (!task || !task.assignmentId) return;

  TaskAPI.updateAssignmentStatus(task.assignmentId, 'in_progress').then(result => {
    showToast('✓ 任务已开始');
    this.loadMyTasks();
  }).catch(err => {
    showToast('✗ 更新失败: ' + err.message, 'error');
  });
}
```

Update `front-end/js/employee-tasks.js`:

```javascript
markTaskComplete: function(taskId) {
  const task = this.myTasks.find(t => t.id === taskId);
  if (!task) return;

  TaskAPI.updateAssignmentStatus(task.assignmentId, 'completed').then(result => {
    showToast('✓ 任务已完成');
    document.getElementById('employeeTaskDetailModal').classList.add('modal-hidden');
    this.loadMyTasks();
  }).catch(err => {
    showToast('✗ 更新失败: ' + err.message, 'error');
  });
}
```

- [ ] **Step 6: 测试完整的状态更新流程**

```bash
# 1. 创建并下发任务
TASK_ID=$(curl -s -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","targetRole":"both","deadline":"2026-03-31"}' | jq -r '.id')

curl -X POST http://localhost:8080/api/tasks/$TASK_ID/dispatch

# 2. 获取分配ID
ASSIGNMENT_ID=$(curl -s http://localhost:8080/api/tasks/$TASK_ID | jq -r '.assignments[0].id')

# 3. 更新状态为"in_progress"
curl -X PATCH http://localhost:8080/api/assignments/$ASSIGNMENT_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'

# 4. 更新状态为"completed"
curl -X PATCH http://localhost:8080/api/assignments/$ASSIGNMENT_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'

# 5. 检查任务统计
curl http://localhost:8080/api/tasks/$TASK_ID/stats
```

Expected: status更新成功，stats正确反映完成数量

- [ ] **Step 7: 提交**

```bash
git add server/services/stateSync.js server/routes/tasks.js server/index.js front-end/js/api.js front-end/js/store-tasks.js front-end/js/employee-tasks.js
git commit -m "feat: implement task status update and state synchronization

- 创建StateSync服务处理状态更新和完成度检查
- 添加PATCH /api/assignments/:assignmentId 更新分配状态
- 添加GET /api/tasks/:id/stats 获取任务完成统计
- WebSocket消息处理支持实时状态更新
- 前端集成状态更新API调用
- 任务全部完成时自动更新任务状态为'completed'

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## 总结与下一步

完成此计划后，你将有：

✅ **后端完整的任务管理链路：**
- 任务创建、下发、分配、状态更新
- 完成度统计和自动关闭

✅ **前端三端完整的交互流程：**
- 总部：创建→下发→看板
- 店长：接收→管理→催促预留
- 店员：接收→执行→完成

✅ **实时状态同步：**
- WebSocket主推送 + Polling降级
- 所有三端实时刷新

**后续计划（场景二、三、四）会基于此基础：**
1. 场景二：自动催办引擎（定时扫描 + LLM调用）
2. 场景三：预警和升级机制（阈值触发 + 多级路由）
3. 场景四：情报收集和分析（表单推送 + 数据聚类）
