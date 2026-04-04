// 'use strict';

// const express = require('express');
// const { nanoid } = require('nanoid');
// const { db } = require('../db');
// const { authenticate, requireRole } = require('../middleware/auth');
// const { requireTaskAccess } = require('../middleware/permissions');
// const { createError } = require('../middleware/errorHandler');
// const { broadcastToUsers } = require('../ws/manager');
// const mainAgent = require('../agent');
// const { evaluateAndTriggerAutoNudges } = require('../services/autoNudge'); // 保留

// const router = express.Router();

// // ─── POST /api/v1/tasks/:id/auto-nudge ──────────────────────────────────────────
// // 保留：自动催办功能
// router.post('/:id/auto-nudge', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
//   try {
//     const result = await evaluateAndTriggerAutoNudges(req.params.id);
    
//     if (!result.success) {
//       throw createError(400, result.reason || '触发自动催办失败', 'NUDGE_AUTO_001');
//     }

//     res.json({
//       code: 200,
//       message: 'success',
//       data: result,
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── POST /api/v1/tasks/ai-generate-description ───────────────────────────────
// // 两者都有，保留
// router.post('/ai-generate-description', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
//   try {
//     const { instruction, ddlAt, platforms } = req.body;
    
//     const result = await mainAgent.execute('generate_task_description_deepseek', {
//       instruction,
//       ddlAt,
//       platforms
//     });

//     res.json({
//       code: 200,
//       message: 'success',
//       data: result,
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── 辅助：DB 行 → API 对象（snake_case → camelCase + 类型转换）────────────
// function formatTask(row) {
//   if (!row) return null;
//   return {
//     id:               row.id,
//     title:            row.title,
//     description:      row.description ?? null,
//     hasMypal:         row.has_mypal === 1,
//     hasSmartSell:     row.has_smartsell === 1,
//     hasAiDemo:        row.has_ai_demo === 1,
//     hasLiveBroadcast: row.has_live_broadcast === 1,
//     status:           row.status,
//     rtmFilter:        row.rtm_filter ? JSON.parse(row.rtm_filter) : null,
//     storeScope:       row.store_scope === 'all' ? 'all' : (row.store_scope ? JSON.parse(row.store_scope) : []),
//     autoNudgeRules:   row.auto_nudge_rules ? JSON.parse(row.auto_nudge_rules) : null, // 保留
//     ddlAt:            row.ddl_at,
//     createdBy:        row.created_by,
//     createdAt:        row.created_at,
//     updatedAt:        row.updated_at,
//   };
// }

// // ─── GET /api/v1/tasks ────────────────────────────────────────────────────────
// router.get('/', authenticate, (req, res, next) => {
//   try {
//     let rows;
//     const { role, storeId, employeeId } = req.user;

//     if (role === 'central' || role === 'admin') {
//       rows = db.all('SELECT * FROM tasks ORDER BY created_at DESC');
//     } else if (role === 'employee') {
//       rows = db.all(
//         `SELECT DISTINCT t.* FROM tasks t
//          INNER JOIN task_assignments ta ON ta.task_id = t.id
//          WHERE ta.user_id = ?
//          ORDER BY t.created_at DESC`,
//         [employeeId]
//       );
//     } else {
//       rows = [];
//     }

//     res.json({
//       code: 200,
//       message: 'success',
//       data: rows.map(formatTask),
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── GET /api/v1/tasks/:id ────────────────────────────────────────────────────
// router.get('/:id', authenticate, requireTaskAccess, (req, res, next) => {
//   try {
//     const row = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
//     if (!row) throw createError(404, '任务不存在', 'TASK_002');

//     res.json({
//       code: 200,
//       message: 'success',
//       data: formatTask(row),
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── POST /api/v1/tasks ───────────────────────────────────────────────────────
// router.post('/', authenticate, requireRole('central'), (req, res, next) => {
//   try {
//     const {
//       title, description,
//       hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast,
//       rtmFilter, storeScope, autoNudgeRules, ddlAt,  // 保留 autoNudgeRules
//     } = req.body;

//     if (!title)      throw createError(400, 'title 不能为空', 'TASK_005');
//     if (!ddlAt)      throw createError(400, 'ddlAt 不能为空', 'TASK_005');

//     const platforms = [hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast].map(v => v ? 1 : 0);
//     if (platforms.every(v => v === 0)) {
//       throw createError(400, '至少选择一个学习平台', 'TASK_001');
//     }

//     const id = nanoid();
//     const now = new Date().toISOString();
//     const rtmFilterStr = rtmFilter ? JSON.stringify(rtmFilter) : null;
//     const storeScopeStr = (!storeScope || storeScope === 'all') ? 'all' : JSON.stringify(storeScope);
//     const autoNudgeRulesStr = autoNudgeRules ? JSON.stringify(autoNudgeRules) : null; // 保留

//     db.run(
//       `INSERT INTO tasks
//         (id, title, description, has_mypal, has_smartsell, has_ai_demo, has_live_broadcast,
//          status, rtm_filter, store_scope, auto_nudge_rules, ddl_at, created_by, created_at, updated_at)
//        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
//       [id, title, description ?? null, platforms[0], platforms[1], platforms[2], platforms[3],
//        rtmFilterStr, storeScopeStr, autoNudgeRulesStr, ddlAt, req.user.username, now, now]
//     );

//     const row = db.get('SELECT * FROM tasks WHERE id = ?', [id]);
//     res.status(201).json({
//       code: 201,
//       message: 'success',
//       data: formatTask(row),
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── PATCH /api/v1/tasks/:id ──────────────────────────────────────────────────
// router.patch('/:id', authenticate, requireRole('central'), (req, res, next) => {
//   try {
//     const task = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
//     if (!task) throw createError(404, '任务不存在', 'TASK_002');

//     const {
//       title, description,
//       hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast,
//       rtmFilter, storeScope, autoNudgeRules, ddlAt,  // 保留 autoNudgeRules
//     } = req.body;

//     // dispatched 后只允许改 ddl_at
//     if (task.status === 'dispatched') {
//       const forbiddenChanged =
//         title !== undefined || description !== undefined ||
//         hasMypal !== undefined || hasSmartSell !== undefined ||
//         hasAiDemo !== undefined || hasLiveBroadcast !== undefined ||
//         rtmFilter !== undefined || storeScope !== undefined || autoNudgeRules !== undefined; // 保留

//       if (forbiddenChanged) {
//         throw createError(400, '已下发任务只允许修改截止时间', 'TASK_004');
//       }
//       if (!ddlAt) throw createError(400, 'ddlAt 不能为空', 'TASK_005');
//       db.run('UPDATE tasks SET ddl_at = ?, updated_at = ? WHERE id = ?',
//         [ddlAt, new Date().toISOString(), task.id]);
//     } else {
//       // draft 状态，允许修改所有字段
//       const platforms = [
//         hasMypal     !== undefined ? (hasMypal     ? 1 : 0) : task.has_mypal,
//         hasSmartSell !== undefined ? (hasSmartSell ? 1 : 0) : task.has_smartsell,
//         hasAiDemo    !== undefined ? (hasAiDemo    ? 1 : 0) : task.has_ai_demo,
//         hasLiveBroadcast !== undefined ? (hasLiveBroadcast ? 1 : 0) : task.has_live_broadcast,
//       ];
//       if (platforms.every(v => v === 0)) {
//         throw createError(400, '至少选择一个学习平台', 'TASK_001');
//       }

//       const rtmFilterStr = rtmFilter !== undefined
//         ? (rtmFilter ? JSON.stringify(rtmFilter) : null)
//         : task.rtm_filter;
//       const storeScopeStr = storeScope !== undefined
//         ? ((!storeScope || storeScope === 'all') ? 'all' : JSON.stringify(storeScope))
//         : task.store_scope;
//       const autoNudgeRulesStr = autoNudgeRules !== undefined  // 保留
//         ? (autoNudgeRules ? JSON.stringify(autoNudgeRules) : null)
//         : task.auto_nudge_rules;

//       db.run(
//         `UPDATE tasks SET
//            title = ?, description = ?,
//            has_mypal = ?, has_smartsell = ?, has_ai_demo = ?, has_live_broadcast = ?,
//            rtm_filter = ?, store_scope = ?, auto_nudge_rules = ?, ddl_at = ?,
//            updated_at = ?
//          WHERE id = ?`,
//         [
//           title      ?? task.title,
//           description !== undefined ? description : task.description,
//           platforms[0], platforms[1], platforms[2], platforms[3],
//           rtmFilterStr,
//           storeScopeStr,
//           autoNudgeRulesStr,  // 保留
//           ddlAt ?? task.ddl_at,
//           new Date().toISOString(),
//           task.id,
//         ]
//       );
//     }

//     const updated = db.get('SELECT * FROM tasks WHERE id = ?', [task.id]);

//     if (task.status === 'dispatched') {
//       const targets = db.all(
//         'SELECT DISTINCT user_id, store_id FROM task_assignments WHERE task_id = ?',
//         [task.id]
//       );
//       const now = new Date().toISOString();
//       for (const t of targets) {
//         db.run(
//           `INSERT OR IGNORE INTO notification_events
//             (id, task_id, assignment_id, target_user_id, store_id, event_type, created_at)
//            VALUES (?, ?, NULL, ?, ?, 'task_updated', ?)`,
//           [nanoid(), task.id, t.user_id, t.store_id, now]
//         );
//       }
//       broadcastToUsers(targets.map(t => t.user_id), {
//         event: 'task_updated',
//         data: { taskId: task.id, ddlAt: updated.ddl_at },
//       });
//     }

//     res.json({
//       code: 200,
//       message: 'success',
//       data: formatTask(updated),
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── 辅助函数：parseTaskArray, getMatchedStoreIds, getTargetUsers ─────────────
// // 保持不变（用旧版的，因为新版 getTargetUsers 用的是 db.all 而不是 db.prepare）
// function parseTaskArray(raw, fieldName) {
//   if (!raw) return [];
//   let parsed = raw;
//   if (typeof raw === 'string') {
//     try {
//       parsed = JSON.parse(raw);
//     } catch (e) {
//       throw createError(400, `${fieldName} JSON 非法`, 'TASK_005');
//     }
//   }
//   if (!Array.isArray(parsed)) throw createError(400, `${fieldName} 必须为数组`, 'TASK_005');
//   return parsed;
// }

// function getMatchedStoreIds(task) {
//   const rtmFilter = parseTaskArray(task.rtm_filter, 'rtmFilter');

//   if (rtmFilter.length > 0) {
//     const conditions = [];
//     const params = [];
//     for (const item of rtmFilter) {
//       if (!item || !item.rtm) throw createError(400, 'rtmFilter 条目缺少 rtm', 'TASK_005');
//       conditions.push(
//         item.format
//           ? '(LOWER(s.rtm) = LOWER(?) AND LOWER(s.format) = LOWER(?))'
//           : '(LOWER(s.rtm) = LOWER(?))'
//       );
//       params.push(item.rtm);
//       if (item.format) params.push(item.format);
//     }
//     const rows = db.all(
//       `SELECT DISTINCT s.id FROM stores s WHERE ${conditions.join(' OR ')}`,
//       params
//     );
//     return rows.map((r) => r.id);
//   }

//   if (task.store_scope === 'all') {
//     return db.all('SELECT id FROM stores').map((r) => r.id);
//   }

//   const scope = parseTaskArray(task.store_scope, 'storeScope');
//   if (scope.length === 0) return [];
//   const placeholders = scope.map(() => '?').join(', ');
//   const rows = db.all(`SELECT id FROM stores WHERE id IN (${placeholders})`, scope);
//   return rows.map((r) => r.id);
// }

// function getTargetUsers(storeIds) {
//   if (!storeIds || storeIds.length === 0) return [];
//   const placeholders = storeIds.map(() => '?').join(',');
//   const sql = `SELECT id AS user_id, store_id
//         FROM employees
//         WHERE store_id IN (${placeholders})`;
//   return db.all(sql, storeIds);  // 保持旧版的 db.all
// }

// // ─── POST /api/v1/tasks/:id/dispatch ──────────────────────────────────────────
// router.post('/:id/dispatch', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
//   // 保持旧版的实现（完整的事务和通知逻辑）
//   try {
//     const task = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
//     if (!task) throw createError(404, '任务不存在', 'TASK_002');
//     if (task.status === 'dispatched') {
//       throw createError(409, '任务已下发，禁止重复下发', 'TASK_003');
//     }

//     const matchedStoreIds = getMatchedStoreIds(task);
//     if (matchedStoreIds.length === 0) {
//       throw createError(400, '当前筛选无门店命中，请调整筛选条件', 'RTM_001');
//     }

//     const targetUsers = getTargetUsers(matchedStoreIds);
//     if (targetUsers.length === 0) {
//       throw createError(400, '筛选结果无目标员工', 'TASK_006');
//     }

//     const now = new Date().toISOString();
//     let assignmentCount = 0;
//     let notificationCount = 0;

//     db.transaction(() => {
//       for (const u of targetUsers) {
//         const assignmentId = nanoid();
//         const insertAssignment = db.run(
//           `INSERT OR IGNORE INTO task_assignments
//             (id, task_id, user_id, store_id, status, progress, nudge_count, created_at, updated_at)
//            VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
//           [assignmentId, task.id, u.user_id, u.store_id, now, now]
//         );
//         if (insertAssignment.changes > 0) assignmentCount += 1;

//         const assignment = db.get(
//           'SELECT id FROM task_assignments WHERE task_id = ? AND user_id = ?',
//           [task.id, u.user_id]
//         );
//         const dedupeKey = `task:${task.id}:user:${u.user_id}`;
//         const insertEvent = db.run(
//           `INSERT OR IGNORE INTO notification_events
//             (id, task_id, assignment_id, target_user_id, store_id, event_type, dedupe_key, created_at)
//            VALUES (?, ?, ?, ?, ?, 'task_assigned', ?, ?)`,
//           [nanoid(), task.id, assignment.id, u.user_id, u.store_id, dedupeKey, now]
//         );
//         if (insertEvent.changes > 0) notificationCount += 1;
//       }

//       db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [
//         'dispatched',
//         now,
//         task.id,
//       ]);
//     });

//     const updated = db.get('SELECT * FROM tasks WHERE id = ?', [task.id]);

//     broadcastToUsers(targetUsers.map(u => u.user_id), {
//       event: 'task_assigned',
//       data: {
//         taskId: task.id,
//         taskTitle: task.title,
//         ddlAt: task.ddl_at,
//       },
//     });

//     res.json({
//       code: 200,
//       message: '任务下发成功',
//       data: {
//         task: formatTask(updated),
//         matchedStoreCount: matchedStoreIds.length,
//         targetUserCount: targetUsers.length,
//         assignmentCreated: assignmentCount,
//         notificationCreated: notificationCount,
//       },
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// // ─── DELETE /api/v1/tasks/:id ──────────────────────────────────────────
// // 保留：新版的删除功能
// router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
//   try {
//     const taskId = req.params.id;
//     const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
//     if (!task) throw createError(404, '任务不存在', 'TASK_002');

//     db.transaction(() => {
//       db.run('DELETE FROM notification_events WHERE task_id = ?', [taskId]);
//       db.run('DELETE FROM nudge_records WHERE task_id = ?', [taskId]);
//       db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId]);
//       db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
//     });

//     res.json({
//       code: 200,
//       message: 'success',
//       data: null,
//       requestId: req.requestId,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// module.exports = router;

'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireTaskAccess } = require('../middleware/permissions');
const { createError } = require('../middleware/errorHandler');
const { broadcastToUsers } = require('../ws/manager');
const mainAgent = require('../agent');
const { evaluateAndTriggerAutoNudges } = require('../services/autoNudge'); // 保留

const router = express.Router();

// ─── POST /api/v1/tasks/:id/auto-nudge ──────────────────────────────────────────
// 保留：自动催办功能
router.post('/:id/auto-nudge', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const result = await evaluateAndTriggerAutoNudges(req.params.id);
    
    if (!result.success) {
      throw createError(400, result.reason || '触发自动催办失败', 'NUDGE_AUTO_001');
    }

    res.json({
      code: 200,
      message: 'success',
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks/ai-generate-description ───────────────────────────────
// 两者都有，保留
router.post('/ai-generate-description', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { instruction, ddlAt, platforms } = req.body;
    
    const result = await mainAgent.execute('generate_task_description_deepseek', {
      instruction,
      ddlAt,
      platforms
    });

    res.json({
      code: 200,
      message: 'success',
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 辅助：DB 行 → API 对象（snake_case → camelCase + 类型转换）────────────
function formatTask(row) {
  if (!row) return null;
  return {
    id:               row.id,
    title:            row.title,
    description:      row.description ?? null,
    hasMypal:         row.has_mypal === 1,
    hasSmartSell:     row.has_smartsell === 1,
    hasAiDemo:        row.has_ai_demo === 1,
    hasLiveBroadcast: row.has_live_broadcast === 1,
    status:           row.status,
    rtmFilter:        row.rtm_filter ? JSON.parse(row.rtm_filter) : null,
    storeScope:       row.store_scope === 'all' ? 'all' : (row.store_scope ? JSON.parse(row.store_scope) : []),
    autoNudgeRules:   row.auto_nudge_rules ? JSON.parse(row.auto_nudge_rules) : null, // 保留
    mypalTaskWeek:    row.mypal_task_week ?? null,
    mypalProductName: row.mypal_product_name ?? null,
    ddlAt:            row.ddl_at,
    createdBy:        row.created_by,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

// ─── GET /api/v1/tasks ────────────────────────────────────────────────────────
router.get('/', authenticate, (req, res, next) => {
  try {
    let rows;
    const { role, storeId, employeeId } = req.user;

    if (role === 'central' || role === 'admin') {
      rows = db.all('SELECT * FROM tasks ORDER BY created_at DESC');
    } else if (role === 'employee') {
      rows = db.all(
        `SELECT DISTINCT t.* FROM tasks t
         INNER JOIN task_assignments ta ON ta.task_id = t.id
         WHERE ta.user_id = ?
         ORDER BY t.created_at DESC`,
        [employeeId]
      );
    } else {
      rows = [];
    }

    res.json({
      code: 200,
      message: 'success',
      data: rows.map(formatTask),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/tasks/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, requireTaskAccess, (req, res, next) => {
  try {
    const row = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) throw createError(404, '任务不存在', 'TASK_002');

    res.json({
      code: 200,
      message: 'success',
      data: formatTask(row),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/tasks ───────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('central'), (req, res, next) => {
  try {
    const {
      title, description,
      hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast,
      rtmFilter, storeScope, autoNudgeRules, ddlAt,  // 保留 autoNudgeRules
      mypalTaskWeek, mypalProductName,
    } = req.body;

    if (!title)      throw createError(400, 'title 不能为空', 'TASK_005');
    if (!ddlAt)      throw createError(400, 'ddlAt 不能为空', 'TASK_005');

    const platforms = [hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast].map(v => v ? 1 : 0);
    if (platforms.every(v => v === 0)) {
      throw createError(400, '至少选择一个学习平台', 'TASK_001');
    }
    if (platforms[0] === 1) {
      const w = mypalTaskWeek != null ? String(mypalTaskWeek).trim() : '';
      if (!w) throw createError(400, '启用 MyPal 时必须填写 mypalTaskWeek（任务周，如 FY26Q2W1）', 'TASK_007');
    }

    const mypalWeekStr =
      platforms[0] === 1 && mypalTaskWeek != null ? String(mypalTaskWeek).trim() : null;
    const mypalProductStr =
      mypalProductName != null && String(mypalProductName).trim()
        ? String(mypalProductName).trim()
        : null;

    const id = nanoid();
    const now = new Date().toISOString();
    const rtmFilterStr = rtmFilter ? JSON.stringify(rtmFilter) : null;
    const storeScopeStr = (!storeScope || storeScope === 'all') ? 'all' : JSON.stringify(storeScope);
    const autoNudgeRulesStr = autoNudgeRules ? JSON.stringify(autoNudgeRules) : null; // 保留

    db.run(
      `INSERT INTO tasks
        (id, title, description, has_mypal, has_smartsell, has_ai_demo, has_live_broadcast,
         status, rtm_filter, store_scope, auto_nudge_rules, mypal_task_week, mypal_product_name,
         ddl_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description ?? null, platforms[0], platforms[1], platforms[2], platforms[3],
       rtmFilterStr, storeScopeStr, autoNudgeRulesStr, mypalWeekStr, mypalProductStr,
       ddlAt, req.user.username, now, now]
    );

    const row = db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.status(201).json({
      code: 201,
      message: 'success',
      data: formatTask(row),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/tasks/:id ──────────────────────────────────────────────────
router.patch('/:id', authenticate, requireRole('central'), (req, res, next) => {
  try {
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) throw createError(404, '任务不存在', 'TASK_002');

    const {
      title, description,
      hasMypal, hasSmartSell, hasAiDemo, hasLiveBroadcast,
      rtmFilter, storeScope, autoNudgeRules, ddlAt,  // 保留 autoNudgeRules
      mypalTaskWeek, mypalProductName,
    } = req.body;

    // dispatched 后只允许改 ddl_at
    if (task.status === 'dispatched') {
      const forbiddenChanged =
        title !== undefined || description !== undefined ||
        hasMypal !== undefined || hasSmartSell !== undefined ||
        hasAiDemo !== undefined || hasLiveBroadcast !== undefined ||
        rtmFilter !== undefined || storeScope !== undefined || autoNudgeRules !== undefined ||
        mypalTaskWeek !== undefined || mypalProductName !== undefined;

      if (forbiddenChanged) {
        throw createError(400, '已下发任务只允许修改截止时间', 'TASK_004');
      }
      if (!ddlAt) throw createError(400, 'ddlAt 不能为空', 'TASK_005');
      db.run('UPDATE tasks SET ddl_at = ?, updated_at = ? WHERE id = ?',
        [ddlAt, new Date().toISOString(), task.id]);
    } else {
      // draft 状态，允许修改所有字段
      const platforms = [
        hasMypal     !== undefined ? (hasMypal     ? 1 : 0) : task.has_mypal,
        hasSmartSell !== undefined ? (hasSmartSell ? 1 : 0) : task.has_smartsell,
        hasAiDemo    !== undefined ? (hasAiDemo    ? 1 : 0) : task.has_ai_demo,
        hasLiveBroadcast !== undefined ? (hasLiveBroadcast ? 1 : 0) : task.has_live_broadcast,
      ];
      if (platforms.every(v => v === 0)) {
        throw createError(400, '至少选择一个学习平台', 'TASK_001');
      }

      const rtmFilterStr = rtmFilter !== undefined
        ? (rtmFilter ? JSON.stringify(rtmFilter) : null)
        : task.rtm_filter;
      const storeScopeStr = storeScope !== undefined
        ? ((!storeScope || storeScope === 'all') ? 'all' : JSON.stringify(storeScope))
        : task.store_scope;
      const autoNudgeRulesStr = autoNudgeRules !== undefined  // 保留
        ? (autoNudgeRules ? JSON.stringify(autoNudgeRules) : null)
        : task.auto_nudge_rules;

      const mypalWeekResolved =
        mypalTaskWeek !== undefined
          ? (mypalTaskWeek != null && String(mypalTaskWeek).trim() ? String(mypalTaskWeek).trim() : null)
          : task.mypal_task_week;
      const mypalProductResolved =
        mypalProductName !== undefined
          ? (mypalProductName != null && String(mypalProductName).trim()
        ? String(mypalProductName).trim()
        : null)
          : task.mypal_product_name;

      if (platforms[0] === 1) {
        const w = mypalWeekResolved != null ? String(mypalWeekResolved).trim() : '';
        if (!w) throw createError(400, '启用 MyPal 时必须填写 mypalTaskWeek', 'TASK_007');
      }

      db.run(
        `UPDATE tasks SET
           title = ?, description = ?,
           has_mypal = ?, has_smartsell = ?, has_ai_demo = ?, has_live_broadcast = ?,
           rtm_filter = ?, store_scope = ?, auto_nudge_rules = ?,
           mypal_task_week = ?, mypal_product_name = ?, ddl_at = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          title      ?? task.title,
          description !== undefined ? description : task.description,
          platforms[0], platforms[1], platforms[2], platforms[3],
          rtmFilterStr,
          storeScopeStr,
          autoNudgeRulesStr,
          platforms[0] === 1 ? mypalWeekResolved : null,
          platforms[0] === 1 ? mypalProductResolved : null,
          ddlAt ?? task.ddl_at,
          new Date().toISOString(),
          task.id,
        ]
      );
    }

    const updated = db.get('SELECT * FROM tasks WHERE id = ?', [task.id]);

    if (task.status === 'dispatched') {
      const targets = db.all(
        'SELECT DISTINCT user_id, store_id FROM task_assignments WHERE task_id = ?',
        [task.id]
      );
      const now = new Date().toISOString();
      for (const t of targets) {
        db.run(
          `INSERT OR IGNORE INTO notification_events
            (id, task_id, assignment_id, target_user_id, store_id, event_type, created_at)
           VALUES (?, ?, NULL, ?, ?, 'task_updated', ?)`,
          [nanoid(), task.id, t.user_id, t.store_id, now]
        );
      }
      broadcastToUsers(targets.map(t => t.user_id), {
        event: 'task_updated',
        data: { taskId: task.id, ddlAt: updated.ddl_at },
      });
    }

    res.json({
      code: 200,
      message: 'success',
      data: formatTask(updated),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 辅助函数：parseTaskArray, getMatchedStoreIds, getTargetUsers ─────────────
// 保持不变（用旧版的，因为新版 getTargetUsers 用的是 db.all 而不是 db.prepare）
// ─── 辅助函数：parseTaskArray, getMatchedStoreIds, getTargetUsers ─────────────
// 保持不变（用旧版的，因为新版 getTargetUsers 用的是 db.all 而不是 db.prepare）
function parseTaskArray(raw, fieldName) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw createError(400, `${fieldName} JSON 非法`, 'TASK_005');
    }
  }
  if (!Array.isArray(parsed)) throw createError(400, `${fieldName} 必须为数组`, 'TASK_005');
  return parsed;
}

function getMatchedStoreIds(task) {
  const rtmFilter = parseTaskArray(task.rtm_filter, 'rtmFilter');

  if (rtmFilter.length > 0) {
    const conditions = [];
    const params = [];
    for (const item of rtmFilter) {
      if (!item || !item.rtm) throw createError(400, 'rtmFilter 条目缺少 rtm', 'TASK_005');
      conditions.push(
        item.format
          ? '(LOWER(s.rtm) = LOWER(?) AND LOWER(s.format) = LOWER(?))'
          : '(LOWER(s.rtm) = LOWER(?))'
      );
      params.push(item.rtm);
      if (item.format) params.push(item.format);
    }
    const rows = db.all(
      `SELECT DISTINCT s.id FROM stores s WHERE ${conditions.join(' OR ')}`,
      params
    );
    return rows.map((r) => r.id);
  }

  if (task.store_scope === 'all') {
    return db.all('SELECT id FROM stores').map((r) => r.id);
  }

  const scope = parseTaskArray(task.store_scope, 'storeScope');
  if (scope.length === 0) return [];
  const placeholders = scope.map(() => '?').join(', ');
  const rows = db.all(`SELECT id FROM stores WHERE id IN (${placeholders})`, scope);
  return rows.map((r) => r.id);
}

function getTargetUsers(storeIds) {
  if (!storeIds || storeIds.length === 0) return [];
  const placeholders = storeIds.map(() => '?').join(',');
  const sql = `SELECT id AS user_id, store_id
        FROM employees
        WHERE store_id IN (${placeholders})`;
  return db.all(sql, storeIds);  // 保持旧版的 db.all
  return db.all(sql, storeIds);  // 保持旧版的 db.all
}

// ─── POST /api/v1/tasks/:id/dispatch ──────────────────────────────────────────
router.post('/:id/dispatch', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  // 保持旧版的实现（完整的事务和通知逻辑）
  // 保持旧版的实现（完整的事务和通知逻辑）
  try {
    const task = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) throw createError(404, '任务不存在', 'TASK_002');
    if (task.status === 'dispatched') {
      throw createError(409, '任务已下发，禁止重复下发', 'TASK_003');
    }

    const matchedStoreIds = getMatchedStoreIds(task);
    if (matchedStoreIds.length === 0) {
      throw createError(400, '当前筛选无门店命中，请调整筛选条件', 'RTM_001');
    }

    if (task.has_mypal === 1) {
      const w = task.mypal_task_week && String(task.mypal_task_week).trim();
      if (!w) {
        throw createError(400, '下发前请为 MyPal 任务配置 mypalTaskWeek（任务周，如 FY26Q2W1）', 'TASK_007');
      }
    }

    const targetUsers = getTargetUsers(matchedStoreIds);
    if (targetUsers.length === 0) {
      throw createError(400, '筛选结果无目标员工', 'TASK_006');
    }

    const now = new Date().toISOString();
    let assignmentCount = 0;
    let notificationCount = 0;

    db.transaction(() => {
      for (const u of targetUsers) {
        const assignmentId = nanoid();
        const insertAssignment = db.run(
          `INSERT OR IGNORE INTO task_assignments
            (id, task_id, user_id, store_id, status, progress, nudge_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
          [assignmentId, task.id, u.user_id, u.store_id, now, now]
        );
        if (insertAssignment.changes > 0) assignmentCount += 1;

        const assignment = db.get(
          'SELECT id FROM task_assignments WHERE task_id = ? AND user_id = ?',
          [task.id, u.user_id]
        );
        const dedupeKey = `task:${task.id}:user:${u.user_id}`;
        const insertEvent = db.run(
          `INSERT OR IGNORE INTO notification_events
            (id, task_id, assignment_id, target_user_id, store_id, event_type, dedupe_key, created_at)
           VALUES (?, ?, ?, ?, ?, 'task_assigned', ?, ?)`,
          [nanoid(), task.id, assignment.id, u.user_id, u.store_id, dedupeKey, now]
        );
        if (insertEvent.changes > 0) notificationCount += 1;
      }

      db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [
        'dispatched',
        now,
        task.id,
      ]);
    });

    const updated = db.get('SELECT * FROM tasks WHERE id = ?', [task.id]);

    broadcastToUsers(targetUsers.map(u => u.user_id), {
      event: 'task_assigned',
      data: {
        taskId: task.id,
        taskTitle: task.title,
        ddlAt: task.ddl_at,
      },
    });

    res.json({
      code: 200,
      message: '任务下发成功',
      data: {
        task: formatTask(updated),
        matchedStoreCount: matchedStoreIds.length,
        targetUserCount: targetUsers.length,
        assignmentCreated: assignmentCount,
        notificationCreated: notificationCount,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/tasks/:id ──────────────────────────────────────────
// 保留：新版的删除功能
router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const taskId = req.params.id;
    const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw createError(404, '任务不存在', 'TASK_002');

    db.transaction(() => {
      db.run('DELETE FROM notification_events WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM nudge_records WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    });

    res.json({
      code: 200,
      message: 'success',
      data: null,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/tasks/:id ──────────────────────────────────────────
// 保留：新版的删除功能
router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const taskId = req.params.id;
    const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw createError(404, '任务不存在', 'TASK_002');

    db.transaction(() => {
      db.run('DELETE FROM notification_events WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM nudge_records WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM task_assignments WHERE task_id = ?', [taskId]);
      db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
    });

    res.json({
      code: 200,
      message: 'success',
      data: null,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
