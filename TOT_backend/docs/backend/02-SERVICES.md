# 后端服务层实现指南

**版本:** 1.0.0 | **基于:** `docs/specs/` 全套文档
**图例:** ✅ 已实现并符合 Spec | ⚠️ 部分实现 / 需修改 | ❌ 未实现

---

## 服务文件总览

```
server/services/
  dispatchService.js      ← 任务下发（⚠️ 与 Spec 仍有差距）
  taskService.js          ← 任务 CRUD（⚠️ 需持续对齐）
  taskSummaryService.js   ← 看板聚合（⚠️ 响应 shape 需持续校准）
  stateSync.js            ← WebSocket 广播（✅ 已接入角色裁剪）
  nudgeService.js         ← 催办服务（✅ 已创建）
  notificationService.js  ← 通知服务（✅ 已创建）
  assignmentService.js    ← 平台完成逻辑 + 进度计算（✅ 已创建）
```

---

## 1. dispatchService.js ⚠️

**文件：** `server/services/dispatchService.js`

### 当前问题

| 问题 | 当前代码 | 目标 |
|------|---------|------|
| status 检查 | `status !== 'draft'` ✅ | 保持一致 |
| 字段名 | `user_id` / `user_role` ✅ | 保持一致 |
| 无 RTM 筛选 | 只处理 `store_scope: 'all'` 或 JSON 数组 | 需支持 `rtm_filter` |
| 无幂等保护 | `INSERT OR IGNORE` ✅ | 保持一致 |
| 无通知写入 | 已写入 `notification_events` ✅ | 保持一致 |
| 无 WS 广播 | 已广播 `task_dispatched` ✅ | 保持一致 |

### 目标实现

```javascript
static dispatchTask(taskId, wss) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw { code: 'TASK_002', status: 404 };
  if (task.status !== 'draft') throw { code: 'TASK_003', status: 409 };

  // 1. RTM 筛选或 storeScope
  const rtmFilter = task.rtm_filter ? JSON.parse(task.rtm_filter) : [];
  const storeIds = this._resolveTargetStores(rtmFilter, task.store_scope);
  if (storeIds.length === 0) throw { code: 'RTM_001', status: 400 };

  // 2. 过滤目标用户
  const targets = this._resolveTargetUsers(storeIds, task.target_role);

  // 3. 批量 INSERT OR IGNORE task_assignments
  const now = new Date().toISOString();
  const insertAssignment = db.prepare(`
    INSERT OR IGNORE INTO task_assignments
      (id, task_id, user_id, user_role, store_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `);

  // 4. 批量 INSERT notification_events
  const insertNotif = db.prepare(`
    INSERT OR IGNORE INTO notification_events
      (id, task_id, assignment_id, target_user_id, target_role,
       event_type, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, 'task_assigned', ?, ?)
  `);

  const insertMany = db.transaction((targets) => {
    let count = 0;
    for (const t of targets) {
      const aId = this._generateId('asgn_');
      insertAssignment.run(aId, taskId, t.userId, t.userRole, t.storeId, now, now);
      insertNotif.run(
        this._generateId('ne_'), taskId, aId, t.userId, t.userRole,
        `task_assigned:${taskId}:${t.userId}`, now
      );
      count++;
    }
    return count;
  });

  const assignmentCount = insertMany(targets);

  // 5. 更新任务状态
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
    .run('dispatched', now, taskId);

  // 6. WebSocket 广播
  this._broadcast(wss, { type: 'task_dispatched', taskId, assignmentCount });

  return { taskId, taskStatus: 'dispatched', assignmentCount, failedCount: 0, failedUsers: [] };
}

// RTM 筛选逻辑（见 07-RTM-FILTER.md）
static _resolveTargetStores(rtmFilter, storeScope) {
  if (rtmFilter && rtmFilter.length > 0) {
    const conditions = rtmFilter.map(f => {
      const parts = ['LOWER(s.rtm) = LOWER(?)'];
      if (f.format) parts.push('LOWER(s.format) = LOWER(?)');
      return `(${parts.join(' AND ')})`;
    });
    const params = [];
    for (const f of rtmFilter) {
      params.push(f.rtm);
      if (f.format) params.push(f.format);
    }
    const sql = `SELECT id FROM stores s WHERE ${conditions.join(' OR ')}`;
    return db.prepare(sql).all(...params).map(r => r.id);
  }
  if (storeScope === 'all') {
    return db.prepare('SELECT id FROM stores').all().map(r => r.id);
  }
  return JSON.parse(storeScope || '[]');
}
```

### Gap 清单

- [x] status 检查改为 `'draft'`
- [x] 字段名改为 `user_id` / `user_role`
- [x] 实现 `_resolveTargetStores`（RTM 筛选）
- [x] 改用 `INSERT OR IGNORE`（加 UNIQUE 约束后）
- [x] 在事务中批量写 `notification_events`
- [x] 事务完成后 WebSocket 广播
- [x] `StateSync` 单例注入已完成（`StateSync.setWss(wss)`）

---

## 2. taskService.js ⚠️

**文件：** `server/services/taskService.js`

### 当前问题

- `createTask()` 已接收 `title`/`ddlAt`/`platforms`/`rtmFilter`
- `getTaskList()` 已按 `role` 做过滤
- `getTaskDetail()` 已完成字段映射（蛇形→驼峰）
- 仍需持续校准：边界场景与错误码覆盖率

### 目标：createTask

```javascript
static createTask({ title, description, platforms, targetRole, rtmFilter, storeScope, ddlAt, createdBy }) {
  const id = this._generateId('task_');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tasks (id, title, description, platforms, status, target_role,
                       rtm_filter, store_scope, ddl_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, description || '',
    JSON.stringify(platforms),
    targetRole,
    rtmFilter ? JSON.stringify(rtmFilter) : null,
    storeScope || 'all',
    ddlAt, createdBy, now, now
  );
  return this.getTaskDetail(id);
}
```

### Gap 清单

- [x] `createTask` 参数对齐新字段名
- [x] `getTaskList` 接收 `user` 参数，按角色过滤（参考 08-PERMISSION-MODEL.md）
- [x] 所有返回字段驼峰化对齐 Spec（`ddlAt`/`createdAt` 等）

---

## 3. taskSummaryService.js ⚠️

**文件：** `server/services/taskSummaryService.js`

### 当前问题

`getTaskSummary()` 存在但响应结构与 Spec 差距较大：
- 缺少 `kpi`（pushCount / employeeReadCount / storeManagerReadCount / taskOpenRate）
- 缺少 `byDealer`（经销商维度）
- 缺少 `byRegion`（地区维度）
- 缺少 `alertList`（预警列表）
- 缺少 `timeline`
- `completionRate` 单位不统一

### 目标：getTaskSummary（对齐 06-DASHBOARD-KPI.md）

```javascript
static getTaskSummary(taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return null;

  // 整体完成率（见 06-DASHBOARD-KPI.md）
  const overall = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending'     THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
      SUM(CASE WHEN status = 'completed'   THEN 1 ELSE 0 END) AS completed,
      ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 0) AS completionRate,
      ROUND(AVG(progress), 0) AS avgProgress
    FROM task_assignments WHERE task_id = ?
  `).get(taskId);

  // KPI（见 06-DASHBOARD-KPI.md）
  const pushCount = db.prepare(`
    SELECT COUNT(DISTINCT target_user_id) AS n FROM notification_events
    WHERE task_id = ? AND event_type = 'task_assigned'
  `).get(taskId).n;

  const empReadCount = db.prepare(`
    SELECT COUNT(DISTINCT rr.user_id) AS n FROM read_receipts rr
    JOIN notification_events ne ON rr.event_id = ne.id
    WHERE ne.task_id = ? AND ne.target_role = 'employee'
  `).get(taskId).n;

  const mgReadCount = db.prepare(`
    SELECT COUNT(DISTINCT rr.user_id) AS n FROM read_receipts rr
    JOIN notification_events ne ON rr.event_id = ne.id
    WHERE ne.task_id = ? AND ne.target_role = 'store_manager'
  `).get(taskId).n;

  const openCount = db.prepare(`
    SELECT COUNT(DISTINCT rr.user_id) AS n FROM read_receipts rr
    JOIN notification_events ne ON rr.event_id = ne.id
    WHERE ne.task_id = ? AND rr.source = 'task_detail_open'
  `).get(taskId).n;

  const total = overall.total || 1;

  // byStore（见 06-DASHBOARD-KPI.md）
  const byStore = db.prepare(`
    SELECT s.id AS storeId, s.name AS storeName, s.region, s.dealer_name AS dealerName,
           COUNT(ta.id) AS total,
           SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completionRate,
           ROUND(AVG(ta.progress), 0) AS avgProgress
    FROM task_assignments ta JOIN stores s ON ta.store_id = s.id
    WHERE ta.task_id = ?
    GROUP BY ta.store_id ORDER BY completionRate DESC
  `).all(taskId).map(s => ({
    ...s,
    alertLevel: s.completionRate < 50 ? 'red' : s.completionRate < 80 ? 'yellow' : 'normal'
  }));

  // byRegion
  const byRegion = db.prepare(`
    SELECT s.region,
           COUNT(ta.id) AS total,
           SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 0) AS completionRate,
           ROUND(AVG(ta.progress), 0) AS avgProgress
    FROM task_assignments ta JOIN stores s ON ta.store_id = s.id
    WHERE ta.task_id = ? GROUP BY s.region ORDER BY completionRate DESC
  `).all(taskId).map(r => ({
    ...r,
    alertLevel: r.completionRate < 50 ? 'red' : r.completionRate < 80 ? 'yellow' : 'normal'
  }));

  // alertList（P1/P2）
  const alertList = byStore
    .filter(s => s.completionRate < 80)
    .map(s => ({
      level: s.completionRate < 50 ? 'P1' : 'P2',
      storeId: s.storeId,
      storeName: s.storeName,
      region: s.region,
      completionRate: s.completionRate,
      avgProgress: s.avgProgress,
      aiSuggestion: s.completionRate < 30
        ? '情况紧急，建议立即电话跟进并发起红色催办'
        : s.completionRate < 50
          ? '建议店长对未完成员工发起红色催办'
          : '建议通过系统发送黄色催办提醒'
    }));

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    ddlAt: task.ddl_at,
    updatedAt: task.updated_at,
    kpi: {
      pushCount,
      employeeReadCount: empReadCount,
      storeManagerReadCount: mgReadCount,
      taskOpenRate: Math.round((openCount / total) * 100)
    },
    overall,
    byRegion,
    byStore,
    alertList
  };
}
```

### Gap 清单

- [ ] 重写 `getTaskSummary` 对齐上方实现
- [ ] 补充 `byDealer` 维度（见 06-DASHBOARD-KPI.md 经销商维度 SQL）
- [ ] 补充 `topStores` / `bottomStores`（使用 CTE，见 06-DASHBOARD-KPI.md）
- [ ] 补充 `timeline` 字段（dispatched_at / first_started_at 等）

---

## 4. stateSync.js ⚠️

**文件：** `server/services/stateSync.js`

### 当前状态

`stateSync.js` 已实现为新模型：`setWss()` 注入 + `broadcast(type, payload)` + `_shouldReceive()` 角色裁剪。

### 目标

重写为面向新 Spec 的 WebSocket 广播服务：

```javascript
class StateSync {
  static _wss = null;

  static setWss(wss) {
    this._wss = wss;
  }

  // 按角色裁剪并广播（见 04-API-SPEC.md §7）
  static broadcast(eventType, payload) {
    if (!this._wss) return;
    const message = JSON.stringify({ type: eventType, ...payload, timestamp: new Date().toISOString() });
    this._wss.clients.forEach(client => {
      if (client.readyState !== 1) return;
      // 权限裁剪：按 client.user 过滤（需在连接时存入 user）
      if (this._shouldReceive(client.user, eventType, payload)) {
        client.send(message);
      }
    });
  }

  static _shouldReceive(user, eventType, payload) {
    if (!user) return false;
    if (user.role === 'central' || user.role === 'admin') return true;
    if (user.role === 'store_manager') {
      return !payload.storeId || payload.storeId === user.storeId;
    }
    if (user.role === 'employee') {
      return !payload.userId || payload.userId === user.employeeId;
    }
    return false;
  }
}
```

**连接时存入 user（在 index.js）：**

```javascript
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  try {
    ws.user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.user = null;
  }
  // 推送 init 事件
  ws.send(JSON.stringify({ type: 'init', timestamp: new Date().toISOString() }));
});
```

### Gap 清单

- [x] StateSync 为纯广播模型
- [x] index.js WebSocket 连接时解析 token，写入 `ws.user`
- [x] `_shouldReceive` 角色裁剪
- [~] 所有路由中 `broadcast` 调用持续补齐（核心链路已接入）

---

## 5. nudgeService.js（新增）

**文件：** `server/services/nudgeService.js`（已创建）

### 目标实现

```javascript
static sendNudge(taskId, { targetType, targetId, severity }, initiator) {
  // 1. 解析目标用户列表
  const targets = this._resolveNudgeTargets(taskId, targetType, targetId);
  if (targets.length === 0) throw { code: 'NUDGE_001', status: 400 };

  const now = new Date().toISOString();
  const notifIds = [];

  const insertNotif = db.prepare(`
    INSERT INTO notification_events
      (id, task_id, target_user_id, target_role, event_type, severity,
       initiator_id, initiator_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertNudge = db.prepare(`
    INSERT INTO nudge_records
      (id, task_id, target_type, target_id, initiator_id, initiator_role,
       severity, notification_event_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const t of targets) {
      const nId = generateId('ne_');
      const eventType = severity === 'red' ? 'nudge_red' : 'nudge_yellow';
      insertNotif.run(nId, taskId, t.userId, t.userRole, eventType, severity,
                      initiator.id, initiator.role, now);
      notifIds.push(nId);
      db.prepare('UPDATE task_assignments SET nudge_count = nudge_count + 1, updated_at = ? WHERE task_id = ? AND user_id = ?')
        .run(now, taskId, t.userId);
    }
    insertNudge.run(
      generateId('nudge_'), taskId, targetType, targetId,
      initiator.id, initiator.role, severity, JSON.stringify(notifIds), now
    );
  })();

  return { notifiedCount: targets.length, notifIds };
}
```

### Gap 清单

- [x] `nudgeService.js` 已创建
- [~] `_resolveNudgeTargets` 与权限边界持续校准
- [~] 事务链路（notif + nudge_record + nudge_count）持续回归测试
- [~] 调用方广播 `nudge_sent` 持续校准

---

## 6. notificationService.js（新增）

**文件：** `server/services/notificationService.js`（已创建）

### 目标实现

```javascript
// 获取用户通知列表
static getNotifications(userId, { unread, taskId }) {
  let sql = `
    SELECT ne.id AS eventId, ne.task_id AS taskId, t.title AS taskTitle,
           ne.assignment_id AS assignmentId, ne.event_type AS eventType,
           ne.severity, ne.created_at AS createdAt,
           CASE WHEN rr.id IS NOT NULL THEN 1 ELSE 0 END AS isRead,
           ta.status AS assignmentStatus
    FROM notification_events ne
    JOIN tasks t ON ne.task_id = t.id
    LEFT JOIN read_receipts rr ON rr.event_id = ne.id AND rr.user_id = ?
    LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
    WHERE ne.target_user_id = ?
  `;
  const params = [userId, userId];
  if (taskId) { sql += ' AND ne.task_id = ?'; params.push(taskId); }
  if (unread === 'true') { sql += ' AND rr.id IS NULL'; }
  sql += ' ORDER BY ne.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  const unreadCount = rows.filter(r => !r.isRead).length;
  return { unreadCount, data: rows };
}

// 标记已读
static markRead(eventId, userId, source) {
  const id = generateId('rr_');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO read_receipts (id, event_id, user_id, read_at, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, eventId, userId, now, source);
  return { eventId, readAt: now };
}
```

### Gap 清单

- [x] `notificationService.js` 已创建
- [~] `getNotifications` 字段映射持续校准
- [~] `markRead` 幂等与权限路径持续回归

---

## 7. assignmentService.js（新增）

**文件：** `server/services/assignmentService.js`（已创建）

**职责：** 处理 Assignment 状态转换和平台完成逻辑，是 `POST .../start` 和 `POST .../platforms/:p/complete` 路由的核心依赖。

### 7.1 进度计算（必读：03-PLATFORM-COMPLETION.md）

```javascript
/**
 * 计算 Assignment 进度（见 docs/specs/03-PLATFORM-COMPLETION.md）
 * @param {object} assignment - task_assignments 行
 * @param {string[]} taskPlatforms - task.platforms 解析后的数组，如 ['mypal','smartsell']
 * @returns {number} 0-100 整数百分比
 */
static calculateProgress(assignment, taskPlatforms) {
  const total = taskPlatforms.length;
  if (total === 0) return 0; // 防御性：规格要求至少1个平台，不应触发

  const platformMap = {
    mypal:            assignment.mypal_completed,
    smartsell:        assignment.smartsell_completed,
    ai_demo:          assignment.ai_demo_completed,
    live_broadcast:   assignment.live_broadcast_completed
  };

  const completedCount = taskPlatforms.filter(p => platformMap[p] === 1).length;
  return Math.round((completedCount / total) * 100);
}
```

### 7.2 开始任务

```javascript
static startAssignment(assignmentId, userId) {
  const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(assignmentId);
  if (!assignment) throw { code: 'ASSIGN_001', status: 404 };

  // 幂等：已是 in_progress 直接返回
  if (assignment.status === 'in_progress') {
    return { assignmentId, status: 'in_progress', startedAt: assignment.started_at };
  }

  if (assignment.status !== 'pending') throw { code: 'ASSIGN_002', status: 400 };

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE task_assignments
      SET status = 'in_progress', started_at = ?, received_at = COALESCE(received_at, ?), updated_at = ?
      WHERE id = ?
    `).run(now, now, now, assignmentId);

    // 写入 ReadReceipt（source: task_detail_open，用于 KPI 已读统计）
    const eventRow = db.prepare(`
      SELECT id FROM notification_events
      WHERE task_id = ? AND target_user_id = ? AND event_type = 'task_assigned'
      LIMIT 1
    `).get(assignment.task_id, assignment.user_id);

    if (eventRow) {
      db.prepare(`
        INSERT OR IGNORE INTO read_receipts (id, event_id, user_id, read_at, source)
        VALUES (?, ?, ?, ?, 'task_detail_open')
      `).run(generateId('rr_'), eventRow.id, userId, now);
    }
  })();

  return { assignmentId, status: 'in_progress', startedAt: now };
}
```

> **received_at 写入规则（见 04-API-SPEC.md §POST /start）：**
> 使用 `COALESCE(received_at, ?)` 保证只写一次（首次 start 时写入，后续幂等调用不覆盖）。

### 7.3 标记平台完成

```javascript
static completePlatform(assignmentId, platform, userId) {
  const assignment = db.prepare(`
    SELECT ta.*, t.platforms FROM task_assignments ta
    JOIN tasks t ON ta.task_id = t.id
    WHERE ta.id = ?
  `).get(assignmentId);

  if (!assignment) throw { code: 'ASSIGN_001', status: 404 };
  if (assignment.status !== 'in_progress') throw { code: 'ASSIGN_002', status: 400 };

  const taskPlatforms = JSON.parse(assignment.platforms || '[]');
  if (!taskPlatforms.includes(platform)) throw { code: 'ASSIGN_003', status: 400 };

  const platformCol = {
    mypal: 'mypal_completed',
    smartsell: 'smartsell_completed',
    ai_demo: 'ai_demo_completed',
    live_broadcast: 'live_broadcast_completed'
  }[platform];

  // 幂等：已完成直接返回
  if (assignment[platformCol] === 1) {
    return this._buildPlatformResponse(assignment, taskPlatforms);
  }

  const now = new Date().toISOString();

  // 更新平台完成字段
  db.prepare(`UPDATE task_assignments SET ${platformCol} = 1, updated_at = ? WHERE id = ?`)
    .run(now, assignmentId);

  // 重新查询（含新完成状态）
  const updated = db.prepare(`
    SELECT ta.*, t.platforms FROM task_assignments ta
    JOIN tasks t ON ta.task_id = t.id WHERE ta.id = ?
  `).get(assignmentId);

  // 重新计算进度
  const newProgress = this.calculateProgress(updated, taskPlatforms);

  // 判断是否全部完成
  const isCompleted = newProgress === 100;
  const newStatus = isCompleted ? 'completed' : 'in_progress';
  const completedAt = isCompleted ? now : null;

  db.prepare(`
    UPDATE task_assignments
    SET progress = ?, status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
    WHERE id = ?
  `).run(newProgress, newStatus, completedAt, now, assignmentId);

  return {
    assignmentId,
    platform,
    progress: newProgress,
    assignmentStatus: newStatus,
    mypalCompleted:          updated.mypal_completed === 1,
    smartsellCompleted:      updated.smartsell_completed === 1,
    aiDemoCompleted:         updated.ai_demo_completed === 1,
    liveBroadcastCompleted:  updated.live_broadcast_completed === 1,
    completedAt
  };
}
```

> **注意字段转换：** 数据库蛇形（`mypal_completed`）→ API 驼峰（`mypalCompleted`），路由层必须做映射。

### Gap 清单

- [x] `assignmentService.js` 已创建
- [x] `POST /api/assignments/:id/start` 已接入服务
- [x] `POST /api/assignments/:id/platforms/:p/complete` 已接入服务
- [~] 路由层响应字段驼峰/蛇形一致性持续校准
- [~] 广播事件覆盖面持续补齐与回归

