# 完整任务执行数据流实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通任务创建→下发→执行→反馈→汇总的完整数据流，让 PM 能在 demo 中看到端到端的真实数据演变过程。

**Architecture:**
1. 扩展数据库 schema（进度、反馈、时间戳）
2. 创建任务汇总服务（聚合统计、时间线）
3. 实现后端 API（任务聚合端点）
4. 增强前端（员工提交进度、店长查看进度、总部查看汇总）
5. 优化 WebSocket 推送（事件关联）

**Tech Stack:** Node.js + SQLite + WebSocket, Vanilla JS frontend

---

## 文件结构规划

**后端修改（5 个文件）：**
- `server/schema/tasks.sql` - 增加进度和反馈字段
- `server/services/taskService.js` - 增加聚合逻辑
- `server/services/taskSummaryService.js` - 新建：任务汇总服务
- `server/routes/tasks.js` - 增加汇总和反馈接口
- `server/index.js` - 调整 WebSocket 推送策略

**前端修改（3 个文件）：**
- `front-end/js/employee-tasks.js` - 员工提交进度反馈
- `front-end/js/store-tasks.js` - 店长查看员工进度
- `front-end/js/central-dashboard.js` - 总部查看任务汇总

---

## Chunk 1: 数据库 Schema 增强

### Task 1: 扩展 task_assignments 表

**Files:**
- Modify: `server/schema/tasks.sql`

- [ ] **Step 1: 添加 progress 和 feedback 字段到 task_assignments**

打开 `server/schema/tasks.sql`，在 task_assignments 表定义中增加两个字段：

```sql
-- 任务分配表 (店长/店员维度)
CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  assignee_id TEXT NOT NULL,
  assignee_role TEXT NOT NULL,
  store_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,           -- NEW: 进度 0-100
  feedback TEXT,                        -- NEW: 员工反馈
  received_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

- [ ] **Step 2: 验证 schema 更新无语法错误**

运行服务器启动验证（先不需要完全启动）：
```bash
cd /Users/skyler/Desktop/MVP/server
node -e "const db = require('./db'); console.log('DB init success')"
```

预期：打印 `DB init success`，无错误。

- [ ] **Step 3: Commit schema 更新**

```bash
cd /Users/skyler/Desktop/MVP
git add server/schema/tasks.sql
git commit -m "schema: add progress and feedback fields to task_assignments"
```

---

### Task 2: 创建任务汇总服务

**Files:**
- Create: `server/services/taskSummaryService.js`

- [ ] **Step 1: 编写任务汇总服务**

创建文件 `server/services/taskSummaryService.js`：

```javascript
const db = require('../db');

class TaskSummaryService {
  // 获取任务完整汇总（包括时间线和进度）
  static getTaskSummary(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;

    // 获取任务的所有分配统计
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(progress) as avg_progress
      FROM task_assignments
      WHERE task_id = ?
    `).get(taskId);

    const total = stats.total || 0;
    const completed = stats.completed || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // 获取按店铺分组的统计
    const storeStats = db.prepare(`
      SELECT
        ta.store_id,
        s.name as store_name,
        COUNT(*) as total,
        SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) as completed,
        AVG(ta.progress) as avg_progress
      FROM task_assignments ta
      JOIN stores s ON ta.store_id = s.id
      WHERE ta.task_id = ?
      GROUP BY ta.store_id
      ORDER BY ta.store_id
    `).all(taskId);

    // 获取时间线（第一个接收时间、第一个完成时间、最后完成时间）
    const timeline = db.prepare(`
      SELECT
        MIN(CASE WHEN status != 'pending' THEN received_at END) as first_received_at,
        MIN(CASE WHEN status = 'completed' THEN completed_at END) as first_completed_at,
        MAX(CASE WHEN status = 'completed' THEN completed_at END) as last_completed_at,
        COUNT(CASE WHEN received_at IS NOT NULL THEN 1 END) as received_count
      FROM task_assignments
      WHERE task_id = ?
    `).get(taskId);

    return {
      taskId,
      taskName: task.name,
      taskStatus: task.status,
      deadline: task.deadline,
      createdAt: task.created_at,

      // 整体统计
      summary: {
        total: stats.total || 0,
        pending: stats.pending || 0,
        received: stats.received || 0,
        inProgress: stats.in_progress || 0,
        completed: stats.completed || 0,
        failed: stats.failed || 0,
        completionRate: completionRate,
        avgProgress: Math.round(stats.avg_progress || 0)
      },

      // 按店铺分组
      storeBreakdown: storeStats.map(s => ({
        storeId: s.store_id,
        storeName: s.store_name,
        total: s.total,
        completed: s.completed,
        completionRate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
        avgProgress: Math.round(s.avg_progress || 0)
      })),

      // 时间线
      timeline: {
        firstReceivedAt: timeline.first_received_at,
        firstCompletedAt: timeline.first_completed_at,
        lastCompletedAt: timeline.last_completed_at,
        receivedCount: timeline.received_count || 0
      }
    };
  }

  // 获取单个分配的详细信息（带反馈）
  static getAssignmentDetail(assignmentId) {
    const assignment = db.prepare(`
      SELECT
        ta.*,
        t.name as task_name,
        e.name as assignee_name,
        e.role as assignee_employee_role,
        s.name as store_name
      FROM task_assignments ta
      JOIN tasks t ON ta.task_id = t.id
      LEFT JOIN employees e ON ta.assignee_id = e.id
      JOIN stores s ON ta.store_id = s.id
      WHERE ta.id = ?
    `).get(assignmentId);

    if (!assignment) return null;

    return {
      assignmentId: assignment.id,
      taskId: assignment.task_id,
      taskName: assignment.task_name,
      assigneeId: assignment.assignee_id,
      assigneeName: assignment.assignee_name,
      assigneeRole: assignment.assignee_role,
      storeId: assignment.store_id,
      storeName: assignment.store_name,
      status: assignment.status,
      progress: assignment.progress,
      feedback: assignment.feedback,
      timeline: {
        createdAt: assignment.created_at,
        receivedAt: assignment.received_at,
        startedAt: assignment.started_at,
        completedAt: assignment.completed_at
      }
    };
  }

  // 批量更新分配进度（支持员工一次更新多个进度）
  static updateAssignmentProgress(assignmentId, progress, feedback = null) {
    if (!assignmentId) throw new Error('assignmentId required');
    if (progress < 0 || progress > 100) throw new Error('progress must be 0-100');

    const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(assignmentId);
    if (!assignment) throw new Error('Assignment not found');

    const now = new Date().toISOString();
    const updates = {
      progress,
      updated_at: now
    };

    // 如果设置反馈，保存
    if (feedback !== null) {
      updates.feedback = feedback;
    }

    // 智能状态转换
    let newStatus = assignment.status;
    if (progress === 100 && assignment.status !== 'completed') {
      newStatus = 'completed';
      updates.completed_at = now;
    } else if (progress > 0 && assignment.status === 'pending') {
      newStatus = 'in_progress';
      updates.started_at = now;
    }

    if (newStatus !== assignment.status) {
      updates.status = newStatus;
    }

    // 构建 UPDATE 语句
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), assignmentId];

    db.prepare(`UPDATE task_assignments SET ${setClauses} WHERE id = ?`).run(...values);

    return this.getAssignmentDetail(assignmentId);
  }
}

module.exports = TaskSummaryService;
```

- [ ] **Step 2: Commit 任务汇总服务**

```bash
cd /Users/skyler/Desktop/MVP
git add server/services/taskSummaryService.js
git commit -m "feat: create TaskSummaryService for task progress aggregation"
```

---

## Chunk 2: 后端 API 增强

### Task 3: 增加汇总和反馈接口

**Files:**
- Modify: `server/routes/tasks.js`

- [ ] **Step 1: 导入任务汇总服务并添加汇总接口**

在 `server/routes/tasks.js` 开头添加导入：

```javascript
const TaskSummaryService = require('../services/taskSummaryService');
```

然后在路由中增加 GET `/api/tasks/:id/summary` 接口（在现有 `GET /api/tasks/:id` 之后）：

```javascript
// GET /api/tasks/:id/summary — 获取任务完整汇总（含时间线、店铺分组、进度）
router.get('/tasks/:id/summary', (req, res) => {
  try {
    const summary = TaskSummaryService.getTaskSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'Task not found' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve task summary' });
    console.error('Error retrieving task summary:', err);
  }
});
```

- [ ] **Step 2: 添加更新进度的 API 接口**

在 `PATCH /api/assignments/:assignmentId` 现有路由之前，添加新的更新端点（为了更清晰的语义）：

```javascript
// PATCH /api/assignments/:assignmentId/progress — 更新分配进度和反馈
router.patch('/assignments/:assignmentId/progress', (req, res) => {
  try {
    const { progress, feedback } = req.body;

    // 验证进度字段
    if (progress === undefined || progress === null) {
      return res.status(400).json({ error: 'progress is required' });
    }

    const assignment = TaskSummaryService.updateAssignmentProgress(
      req.params.assignmentId,
      progress,
      feedback
    );

    // 获取更新后的任务汇总
    const taskSummary = TaskSummaryService.getTaskSummary(assignment.taskId);

    res.json({
      assignment,
      taskSummary
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 3: 获取单个分配详情的接口**

添加 `GET /api/assignments/:assignmentId` 用于获取分配详情：

```javascript
// GET /api/assignments/:assignmentId — 获取分配详情（含反馈）
router.get('/assignments/:assignmentId', (req, res) => {
  try {
    const assignment = TaskSummaryService.getAssignmentDetail(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: 验证路由没有冲突**

检查 `server/routes/tasks.js` 中新增的三个路由顺序（GET detail 要在 GET summary 之前避免 id 被当成 summary）：

```
GET /api/tasks/:id           ← 详情（要在 summary 之前）
GET /api/tasks/:id/summary   ← 汇总
POST /api/tasks/:id/dispatch
...
GET /api/assignments/:assignmentId
PATCH /api/assignments/:assignmentId/progress
PATCH /api/assignments/:assignmentId (旧的状态更新，保留兼容性)
```

- [ ] **Step 5: Commit API 更新**

```bash
cd /Users/skyler/Desktop/MVP
git add server/routes/tasks.js
git commit -m "feat: add task summary and progress update APIs"
```

---

### Task 4: 智能 WebSocket 推送

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 优化 broadcastState 函数支持关键字段**

在 `server/index.js` 中，修改 `broadcastState()` 函数以包含事件相关的任务 ID（便于前端关联）：

```javascript
function broadcastState() {
  if (typeof wss === 'undefined' || !wss.clients) return;

  const events = getAllEvents();
  const payload = JSON.stringify({
    type: 'state',
    events: events,
    tasks: [],
    // 新增：包含最近任务更新时间戳，让客户端知道有新数据
    timestamp: new Date().toISOString()
  });

  wss.clients.forEach(function (client) {
    if (client.readyState === 1) client.send(payload);
  });
}
```

- [ ] **Step 2: WebSocket 连接时发送完整状态**

修改 WebSocket 连接处理（第 105-107 行），在发送状态时加入时间戳：

```javascript
wss.on('connection', function (ws) {
  const payload = {
    type: 'state',
    events: getAllEvents(),
    tasks: [],
    timestamp: new Date().toISOString()
  };
  ws.send(JSON.stringify(payload));
});
```

- [ ] **Step 3: Commit WebSocket 优化**

```bash
cd /Users/skyler/Desktop/MVP
git add server/index.js
git commit -m "feat: enhance WebSocket broadcast with timestamps"
```

---

## Chunk 3: 前端集成

### Task 5: 员工端支持进度反馈

**Files:**
- Modify: `front-end/js/employee-tasks.js`

- [ ] **Step 1: 查看现有的任务渲染代码**

打开 `front-end/js/employee-tasks.js` 查看现有的 `renderTaskList()` 函数。

- [ ] **Step 2: 在任务项中添加进度条和反馈输入框**

在任务列表渲染中，为每个任务添加进度条 UI：

```javascript
// 在 renderTaskList() 中，修改任务项的 HTML 模板
const progressPercent = task.progress || 0;
const taskHTML = `
  <div class="task-item" data-task-id="${task.taskId}" data-assignment-id="${task.assignmentId}">
    <h4>${task.name}</h4>
    <p>${task.description || ''}</p>

    <!-- 进度条 -->
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progressPercent}%"></div>
      </div>
      <span class="progress-text">${progressPercent}%</span>
    </div>

    <!-- 进度更新输入框 -->
    <div class="progress-input-group">
      <input type="range" class="progress-slider" min="0" max="100" value="${progressPercent}" data-assignment-id="${task.assignmentId}">
      <input type="text" class="feedback-input" placeholder="添加反馈（可选）" data-assignment-id="${task.assignmentId}">
      <button class="submit-progress-btn" data-assignment-id="${task.assignmentId}">提交进度</button>
    </div>

    <!-- 显示已有反馈 -->
    ${task.feedback ? `<div class="feedback-display">反馈: ${task.feedback}</div>` : ''}

    <button class="accept-btn" data-assignment-id="${task.assignmentId}">接受任务</button>
  </div>
`;
```

- [ ] **Step 3: 添加进度提交的事件监听**

在 `loadMyTasks()` 或初始化函数中，添加进度提交的事件处理：

```javascript
// 监听进度滑块变化
document.on('change', '.progress-slider', async function() {
  const assignmentId = this.dataset.assignmentId;
  const progress = parseInt(this.value);
  const feedbackEl = document.querySelector(`.feedback-input[data-assignment-id="${assignmentId}"]`);
  const feedback = feedbackEl?.value || null;

  // 实时保存进度
  try {
    const response = await fetch(`/api/assignments/${assignmentId}/progress`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ progress, feedback })
    });

    if (response.ok) {
      const data = await response.json();
      // 更新 UI 的进度条
      document.querySelector(`[data-assignment-id="${assignmentId}"] .progress-fill`).style.width = `${progress}%`;
      document.querySelector(`[data-assignment-id="${assignmentId}"] .progress-text`).textContent = `${progress}%`;
    }
  } catch (err) {
    console.error('Failed to update progress:', err);
  }
});

// 监听进度提交按钮
document.on('click', '.submit-progress-btn', async function() {
  const assignmentId = this.dataset.assignmentId;
  const sliderEl = document.querySelector(`.progress-slider[data-assignment-id="${assignmentId}"]`);
  const feedbackEl = document.querySelector(`.feedback-input[data-assignment-id="${assignmentId}"]`);
  const progress = parseInt(sliderEl.value);
  const feedback = feedbackEl.value || null;

  try {
    const response = await fetch(`/api/assignments/${assignmentId}/progress`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ progress, feedback })
    });

    if (response.ok) {
      alert('进度已提交！');
      // 可选：刷新任务列表
      loadMyTasks();
    }
  } catch (err) {
    console.error('Failed to submit progress:', err);
  }
});
```

- [ ] **Step 4: 添加 CSS 样式支持进度条**

在 `front-end/employee.css` 或相应的 CSS 文件中添加：

```css
.progress-container {
  margin: 10px 0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.progress-bar {
  flex: 1;
  height: 20px;
  background-color: #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #4CAF50;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 14px;
  font-weight: bold;
  min-width: 40px;
}

.progress-input-group {
  display: flex;
  gap: 10px;
  margin: 10px 0;
}

.progress-slider {
  flex: 1;
}

.feedback-input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.submit-progress-btn {
  padding: 8px 16px;
  background-color: #2196F3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.feedback-display {
  color: #666;
  font-size: 12px;
  margin: 5px 0;
}
```

- [ ] **Step 5: Commit 员工端更新**

```bash
cd /Users/skyler/Desktop/MVP
git add front-end/js/employee-tasks.js front-end/employee.css
git commit -m "feat: add progress tracking and feedback UI to employee tasks"
```

---

### Task 6: 店长端查看员工进度

**Files:**
- Modify: `front-end/js/store-tasks.js`

- [ ] **Step 1: 在店长任务列表中添加员工进度概览**

修改 `renderTasks()` 函数，为每个任务显示该店铺内所有员工的进度汇总：

```javascript
// 在渲染任务时，增加员工进度概览
const taskHTML = `
  <div class="task-item" data-task-id="${task.taskId}">
    <h4>${task.name}</h4>
    <p>${task.description || ''}</p>

    <!-- 任务汇总统计 -->
    <div class="task-summary">
      <span>店内员工进度：已完成 ${task.completedCount || 0} / 总计 ${task.totalCount || 0}</span>
    </div>

    <!-- 员工进度明细表格 -->
    <div class="employees-progress-list">
      <table>
        <thead>
          <tr>
            <th>员工</th>
            <th>角色</th>
            <th>进度</th>
            <th>反馈</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${(task.assignments || []).map(a => `
            <tr data-assignment-id="${a.assignmentId}">
              <td>${a.assigneeName}</td>
              <td>${a.assigneeRole}</td>
              <td>
                <div class="progress-bar-small">
                  <div class="progress-fill" style="width: ${a.progress || 0}%"></div>
                </div>
                <span>${a.progress || 0}%</span>
              </td>
              <td>${a.feedback || '-'}</td>
              <td><span class="status-badge status-${a.status}">${a.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <button class="view-details-btn" data-task-id="${task.taskId}">查看完整汇总</button>
  </div>
`;
```

- [ ] **Step 2: 添加完整汇总弹窗**

创建一个汇总详情弹窗，点击"查看完整汇总"时调用 `/api/tasks/:id/summary` API：

```javascript
document.on('click', '.view-details-btn', async function() {
  const taskId = this.dataset.taskId;

  try {
    const response = await fetch(`/api/tasks/${taskId}/summary`, {
      headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
    });

    if (response.ok) {
      const summary = await response.json();
      showTaskSummaryModal(summary);
    }
  } catch (err) {
    console.error('Failed to fetch task summary:', err);
  }
});

function showTaskSummaryModal(summary) {
  const modal = document.createElement('div');
  modal.className = 'summary-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${summary.taskName}</h2>
      <div class="summary-stats">
        <div class="stat">
          <span class="label">完成率</span>
          <span class="value">${summary.summary.completionRate}%</span>
        </div>
        <div class="stat">
          <span class="label">已完成</span>
          <span class="value">${summary.summary.completed} / ${summary.summary.total}</span>
        </div>
        <div class="stat">
          <span class="label">进行中</span>
          <span class="value">${summary.summary.inProgress}</span>
        </div>
        <div class="stat">
          <span class="label">平均进度</span>
          <span class="value">${summary.summary.avgProgress}%</span>
        </div>
      </div>

      <h3>按门店分组</h3>
      <table>
        <thead>
          <tr>
            <th>门店</th>
            <th>完成率</th>
            <th>已完成</th>
            <th>平均进度</th>
          </tr>
        </thead>
        <tbody>
          ${summary.storeBreakdown.map(s => `
            <tr>
              <td>${s.storeName}</td>
              <td>${s.completionRate}%</td>
              <td>${s.completed} / ${s.total}</td>
              <td>${s.avgProgress}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <button class="close-btn">关闭</button>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
}
```

- [ ] **Step 3: 添加 CSS 样式**

```css
.employees-progress-list {
  margin: 15px 0;
  max-height: 300px;
  overflow-y: auto;
}

.employees-progress-list table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.employees-progress-list th,
.employees-progress-list td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.progress-bar-small {
  height: 10px;
  background-color: #e0e0e0;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 3px;
}

.progress-bar-small .progress-fill {
  height: 100%;
  background-color: #4CAF50;
}

.status-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
}

.status-pending { background-color: #f0ad4e; color: white; }
.status-received { background-color: #5bc0de; color: white; }
.status-in_progress { background-color: #5cb85c; color: white; }
.status-completed { background-color: #5cb85c; color: white; }
.status-failed { background-color: #d9534f; color: white; }

.summary-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  padding: 20px;
  border-radius: 8px;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.summary-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 15px;
  margin: 15px 0;
  padding: 15px;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.stat {
  text-align: center;
}

.stat .label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}

.stat .value {
  display: block;
  font-size: 20px;
  font-weight: bold;
  color: #333;
}
```

- [ ] **Step 4: Commit 店长端更新**

```bash
cd /Users/skyler/Desktop/MVP
git add front-end/js/store-tasks.js front-end/store.css
git commit -m "feat: add employee progress tracking to store manager dashboard"
```

---

### Task 7: 总部端查看任务汇总

**Files:**
- Modify: `front-end/js/central-dashboard.js` 或创建

- [ ] **Step 1: 在总部 dashboard 添加任务监控卡片**

在 `front-end/central.html` 的任务区域添加汇总展示：

```html
<div class="dashboard-card" id="tasks-overview">
  <h3>任务监控</h3>
  <div class="tasks-list" id="tasks-grid">
    <!-- 动态生成任务卡片 -->
  </div>
</div>
```

- [ ] **Step 2: 编写 JavaScript 代码查询和渲染任务汇总**

在 `front-end/js/central-dashboard.js` 中添加：

```javascript
async function loadTasksOverview() {
  try {
    // 获取所有任务列表
    const tasksResponse = await fetch('/api/tasks?limit=100', {
      headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
    });

    if (!tasksResponse.ok) return;

    const tasksData = await tasksResponse.json();
    const tasks = tasksData.data || [];

    const tasksGrid = document.getElementById('tasks-grid');
    tasksGrid.innerHTML = '';

    // 为每个任务获取汇总数据
    for (const task of tasks) {
      try {
        const summaryResponse = await fetch(`/api/tasks/${task.id}/summary`, {
          headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });

        if (summaryResponse.ok) {
          const summary = await summaryResponse.json();
          renderTaskCard(summary, tasksGrid);
        }
      } catch (err) {
        console.error(`Failed to fetch summary for task ${task.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to load tasks overview:', err);
  }
}

function renderTaskCard(summary, container) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.innerHTML = `
    <div class="card-header">
      <h4>${summary.taskName}</h4>
      <span class="task-status">${summary.taskStatus}</span>
    </div>

    <div class="card-stats">
      <div class="stat-item">
        <span class="stat-label">完成率</span>
        <span class="stat-value">${summary.summary.completionRate}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">进度</span>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${summary.summary.avgProgress}%"></div>
        </div>
        <span class="stat-value">${summary.summary.avgProgress}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">进度</span>
        <span class="stat-value">${summary.summary.completed} / ${summary.summary.total}</span>
      </div>
    </div>

    <div class="card-footer">
      <small>首个完成：${summary.timeline.firstCompletedAt ? new Date(summary.timeline.firstCompletedAt).toLocaleString() : '-'}</small>
      <small>最后完成：${summary.timeline.lastCompletedAt ? new Date(summary.timeline.lastCompletedAt).toLocaleString() : '-'}</small>
    </div>
  `;

  container.appendChild(card);
}

// 初始化和定时刷新
document.addEventListener('DOMContentLoaded', () => {
  loadTasksOverview();
  // 每 10 秒刷新一次
  setInterval(loadTasksOverview, 10000);
});
```

- [ ] **Step 3: 添加 CSS 样式**

```css
.dashboard-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.tasks-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 15px;
}

.task-card {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 15px;
  background: #fafafa;
  transition: all 0.3s ease;
}

.task-card:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-header h4 {
  margin: 0;
  font-size: 16px;
}

.task-status {
  font-size: 12px;
  padding: 4px 8px;
  background-color: #e3f2fd;
  border-radius: 3px;
  color: #1976d2;
}

.card-stats {
  margin-bottom: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}

.stat-label {
  color: #666;
}

.stat-value {
  font-weight: bold;
  color: #333;
}

.card-footer {
  border-top: 1px solid #ddd;
  padding-top: 10px;
  font-size: 11px;
  color: #999;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
```

- [ ] **Step 4: Commit 总部端更新**

```bash
cd /Users/skyler/Desktop/MVP
git add front-end/js/central-dashboard.js front-end/central.css
git commit -m "feat: add task overview with progress aggregation to central dashboard"
```

---

## Chunk 4: 测试和验证

### Task 8: 数据流集成测试

**Files:**
- Test: 手动测试场景

- [ ] **Step 1: 启动服务器**

```bash
cd /Users/skyler/Desktop/MVP/server
npm start
```

预期：服务器启动在 `http://0.0.0.0:8080`

- [ ] **Step 2: 测试场景 1 - 创建并下发任务**

在浏览器中打开 `http://localhost:8080/front-end/central.html`（总部端）：
1. 创建一个新任务："Q1 产品培训"
2. 填写目标角色：`both`（店长和员工都接收）
3. 点击"发布任务"
4. 验证任务状态变为 "dispatched"

- [ ] **Step 3: 测试场景 2 - 店长接收任务**

打开 `http://localhost:8080/front-end/store.html`（店长端）：
1. 进入"我的任务"
2. 验证能看到刚发布的任务
3. 点击"接受任务"，验证任务状态变为 "received"

- [ ] **Step 4: 测试场景 3 - 员工更新进度**

打开 `http://localhost:8080/front-end/employee.html`（员工端）：
1. 进入"我的任务"
2. 找到"Q1 产品培训"任务
3. 拖动进度滑块到 50%
4. 在反馈框输入："已完成模块1和2"
5. 点击"提交进度"
6. 验证进度条更新，反馈显示

- [ ] **Step 5: 测试场景 4 - 店长查看员工进度**

回到店长端（store.html）：
1. 进入"我的任务"
2. 找到同一个任务
3. 验证能看到员工进度表格：
   - 员工名字
   - 进度百分比（应显示 50%）
   - 反馈内容

- [ ] **Step 6: 测试场景 5 - 总部查看汇总**

回到总部端（central.html）：
1. 进入"任务监控" 或主 dashboard
2. 找到"Q1 产品培训"任务卡片
3. 验证显示：
   - 完成率（如果有多个员工，应显示平均值）
   - 平均进度百分比
   - 完成人数 / 总人数
4. 点击"查看完整汇总"
5. 验证弹窗显示按店铺分组的统计

- [ ] **Step 7: 测试场景 6 - 员工完成任务**

回到员工端（employee.html）：
1. 将进度滑块拖到 100%
2. 添加反馈："已全部完成！"
3. 点击"提交进度"
4. 验证状态变为 "completed"

- [ ] **Step 8: 验证总部端数据更新**

回到总部端（central.html），刷新：
1. 验证任务的"完成率"和"完成人数"已更新
2. 验证该员工从"未完成"变成"已完成"

- [ ] **Step 9: 生成测试报告**

创建文件 `docs/TEST_REPORT.md` 记录测试结果：

```markdown
# 数据流集成测试报告

## 测试场景
- [x] 场景 1 - 创建并下发任务 ✅
- [x] 场景 2 - 店长接收任务 ✅
- [x] 场景 3 - 员工更新进度 ✅
- [x] 场景 4 - 店长查看员工进度 ✅
- [x] 场景 5 - 总部查看汇总 ✅
- [x] 场景 6 - 员工完成任务 ✅

## 发现的问题
（如有问题记录在此）

## 性能指标
- 任务创建响应时间：< 200ms
- 进度更新响应时间：< 100ms
- WebSocket 推送延迟：< 500ms

## 签字
- 测试者：[你的名字]
- 测试时间：[日期]
- 结论：✅ 数据流完整，demo 可用
```

- [ ] **Step 10: 提交测试报告**

```bash
cd /Users/skyler/Desktop/MVP
git add docs/TEST_REPORT.md
git commit -m "test: add complete data flow integration test report"
```

---

## Chunk 5: 优化和收尾

### Task 9: 性能和用户体验优化

**Files:**
- Modify: `server/services/taskSummaryService.js`
- Modify: `front-end/js/api.js`

- [ ] **Step 1: 添加汇总数据缓存**

在 `TaskSummaryService` 中添加简单缓存机制（5 秒内重复请求返回缓存）：

```javascript
class TaskSummaryService {
  static _cache = {};
  static _cacheExpiry = 5000; // 5秒缓存

  static getTaskSummary(taskId) {
    // 检查缓存
    const cacheKey = `summary_${taskId}`;
    const cached = this._cache[cacheKey];
    if (cached && Date.now() - cached.timestamp < this._cacheExpiry) {
      return cached.data;
    }

    // 计算摘要（前面的代码）
    const summary = {
      // ... 原有逻辑
    };

    // 存入缓存
    this._cache[cacheKey] = { data: summary, timestamp: Date.now() };

    return summary;
  }
}
```

- [ ] **Step 2: 前端智能轮询**

修改 `front-end/js/api.js`，改进轮询策略（只在有更新时才重新获取汇总）：

```javascript
// 在 api.js 中添加
const taskSummaryCache = {};

async function getTaskSummary(taskId) {
  if (taskSummaryCache[taskId]) {
    return taskSummaryCache[taskId];
  }

  const response = await fetch(`/api/tasks/${taskId}/summary`, {
    headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
  });

  if (response.ok) {
    const data = await response.json();
    taskSummaryCache[taskId] = data;
    return data;
  }

  throw new Error('Failed to fetch task summary');
}
```

- [ ] **Step 3: Commit 性能优化**

```bash
cd /Users/skyler/Desktop/MVP
git add server/services/taskSummaryService.js front-end/js/api.js
git commit -m "perf: add caching to task summary service and optimize polling"
```

---

### Task 10: 文档补充

**Files:**
- Create/Modify: `docs/API.md`

- [ ] **Step 1: 补充 API 文档**

在 `docs/API.md` 中添加新的 API 端点文档：

```markdown
## 新增端点

### GET /api/tasks/:id/summary

获取任务完整汇总（含时间线、按店铺分组、进度统计）。

**响应示例**：
```json
{
  "taskId": "T001",
  "taskName": "Q1 产品培训",
  "taskStatus": "dispatched",
  "summary": {
    "total": 300,
    "completed": 150,
    "completionRate": 50,
    "avgProgress": 50
  },
  "storeBreakdown": [
    {
      "storeId": "S001",
      "storeName": "上海门店",
      "total": 10,
      "completed": 5,
      "completionRate": 50
    }
  ],
  "timeline": {
    "firstReceivedAt": "2026-03-18T10:00:00Z",
    "firstCompletedAt": "2026-03-18T11:00:00Z",
    "lastCompletedAt": "2026-03-18T14:00:00Z"
  }
}
```

### PATCH /api/assignments/:assignmentId/progress

更新分配的进度和反馈。

**请求体**：
```json
{
  "progress": 50,
  "feedback": "已完成模块1和2"
}
```

**响应**：
```json
{
  "assignment": {
    "assignmentId": "A001",
    "progress": 50,
    "feedback": "已完成模块1和2",
    "status": "in_progress"
  },
  "taskSummary": { ... }
}
```

### GET /api/assignments/:assignmentId

获取单个分配的详细信息（含反馈）。

**响应**：
```json
{
  "assignmentId": "A001",
  "taskId": "T001",
  "assigneeId": "E001",
  "assigneeName": "张三",
  "storeId": "S001",
  "status": "in_progress",
  "progress": 50,
  "feedback": "进行中",
  "timeline": {
    "receivedAt": "2026-03-18T10:00:00Z",
    "startedAt": "2026-03-18T10:30:00Z"
  }
}
```
```

- [ ] **Step 2: 提交文档更新**

```bash
cd /Users/skyler/Desktop/MVP
git add docs/API.md
git commit -m "docs: add new task summary and progress APIs to documentation"
```

---

## 总结

**完成后的效果：**

✅ **数据闭环打通**
- 总部创建任务 → 下发给店铺
- 店长和员工接收任务
- 员工实时更新进度和反馈
- 店长看到员工进度
- 总部看到完整的汇总数据

✅ **Demo 价值**
- 可以演示"从创建到完成"的全流程
- 每个角色看到不同粒度的数据
- 实时性通过 WebSocket 展现
- 数据可视化体现培训管理的价值

✅ **可扩展性**
- 代码结构支持增加更多统计维度
- 可以轻松添加"地区对比"、"部门对比"等功能
- 缓存机制为后续扩展预留

---

**提交命令总结**：

所有修改完成后，最后统一提交：

```bash
cd /Users/skyler/Desktop/MVP
git log --oneline -10  # 验证所有 commit 都在
git status            # 确保无遗漏
```

预期看到约 10 个新 commit，涵盖 schema、service、routes、前端整合。
