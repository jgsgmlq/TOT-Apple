'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { broadcastToUser, broadcastToUsers } = require('../ws/manager');
const { batchCreateAssignments } = require('../services/assignmentBatch');

const router = express.Router();

function formatAssignment(row) {
  if (!row) return null;
  return {
    id:                    row.id,
    taskId:                row.task_id,
    userId:                row.user_id,
    storeId:               row.store_id,
    status:                row.status,
    mypalCompleted:        row.mypal_completed === 1,
    smartsellCompleted:    row.smartsell_completed === 1,
    aiDemoCompleted:       row.ai_demo_completed === 1,
    liveBroadcastCompleted:row.live_broadcast_completed === 1,
    progress:              row.progress,
    nudgeCount:            row.nudge_count,
    receivedAt:            row.received_at ?? null,
    startedAt:             row.started_at ?? null,
    completedAt:           row.completed_at ?? null,
    createdAt:             row.created_at,
    updatedAt:             row.updated_at,
  };
}

/** §3.1 列表项（含 assignmentId / taskAssignedEventId） */
function formatAssignmentListItem(row) {
  const f = formatAssignment(row);
  return {
    assignmentId: f.id,
    taskId: f.taskId,
    userId: f.userId,
    storeId: f.storeId,
    status: f.status,
    progress: f.progress,
    mypalCompleted: f.mypalCompleted,
    smartsellCompleted: f.smartsellCompleted,
    aiDemoCompleted: f.aiDemoCompleted,
    liveBroadcastCompleted: f.liveBroadcastCompleted,
    nudgeCount: f.nudgeCount,
    receivedAt: f.receivedAt,
    taskAssignedEventId: row.task_assigned_event_id ?? null,
    updatedAt: f.updatedAt,
    id: f.id,
  };
}

/** §3.2 详情（含 assignmentId / taskAssignedEventId） */
function formatAssignmentDetail(row) {
  const f = formatAssignment(row);
  return {
    assignmentId: f.id,
    taskId: f.taskId,
    userId: f.userId,
    storeId: f.storeId,
    status: f.status,
    progress: f.progress,
    mypalCompleted: f.mypalCompleted,
    smartsellCompleted: f.smartsellCompleted,
    aiDemoCompleted: f.aiDemoCompleted,
    liveBroadcastCompleted: f.liveBroadcastCompleted,
    nudgeCount: f.nudgeCount,
    receivedAt: f.receivedAt,
    startedAt: f.startedAt,
    completedAt: f.completedAt,
    taskAssignedEventId: row.task_assigned_event_id ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    id: f.id,
  };
}

function parseAssignmentPagination(query) {
  const pageNum = query.pageNum !== undefined ? parseInt(String(query.pageNum), 10) : 1;
  const pageSize = query.pageSize !== undefined ? parseInt(String(query.pageSize), 10) : 20;
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    throw createError(400, 'pageNum 非法', 'ASSIGN_018');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw createError(400, 'pageSize 非法（1–200）', 'ASSIGN_019');
  }
  return { pageNum, pageSize, offset: (pageNum - 1) * pageSize };
}

function requireAssignmentActor(req, assignment) {
  const { role, employeeId } = req.user;
  if (role === 'central' || role === 'admin') return;
  if (role === 'employee' && assignment.user_id === employeeId) return;
  throw createError(403, '只能操作本人任务', 'AUTH_003');
}

function mapPlatformToColumn(platform) {
  const key = String(platform || '').trim().toLowerCase();
  const dict = {
    mypal: 'mypal_completed',
    smartsell: 'smartsell_completed',
    'ai demo': 'ai_demo_completed',
    aidemo: 'ai_demo_completed',
    'live broadcast': 'live_broadcast_completed',
    livebroadcast: 'live_broadcast_completed',
  };
  return dict[key] || null;
}

function getConfiguredPlatformColumns(task) {
  const configured = [];
  if (task.has_mypal === 1) configured.push('mypal_completed');
  if (task.has_smartsell === 1) configured.push('smartsell_completed');
  if (task.has_ai_demo === 1) configured.push('ai_demo_completed');
  if (task.has_live_broadcast === 1) configured.push('live_broadcast_completed');
  return configured;
}

// ─── GET /api/v1/assignments ──────────────────────────────────────────────────
// §3.1：分页 + 筛选 + list/pagination；含 task_assigned 事件 ID

router.get('/', authenticate, (req, res, next) => {
  try {
    const { pageNum, pageSize, offset } = parseAssignmentPagination(req.query);
    const { role, employeeId, storeId } = req.user;
    const { taskId, status, employeeId: qEmp, storeId: qStore } = req.query;

    const where = [];
    const params = [];

    if (role === 'central' || role === 'admin') {
      where.push('1=1');
    } else if (role === 'employee') {
      where.push('ta.user_id = ?');
      params.push(employeeId);
    } else {
      return res.json({
        code: 200,
        message: 'success',
        data: {
          list: [],
          pagination: { pageNum, pageSize, total: 0, totalPages: 0 },
        },
        requestId: req.requestId,
      });
    }

    if (taskId) {
      where.push('ta.task_id = ?');
      params.push(taskId);
    }
    if (status) {
      if (!['pending', 'in_progress', 'completed'].includes(String(status))) {
        throw createError(400, 'status 非法', 'ASSIGN_020');
      }
      where.push('ta.status = ?');
      params.push(status);
    }

    if (role === 'central' || role === 'admin') {
      if (qEmp) {
        where.push('ta.user_id = ?');
        params.push(qEmp);
      }
      if (qStore) {
        where.push('ta.store_id = ?');
        params.push(qStore);
      }
      if (qEmp) {
        where.push('ta.user_id = ?');
        params.push(qEmp);
      }
    } else if (role === 'employee') {
      if (qEmp && qEmp !== employeeId) {
        throw createError(403, '无权查询他人分配记录', 'AUTH_003');
      }
    }

    const whereSql = where.join(' AND ');
    const eventSub = `(
      SELECT id FROM notification_events
      WHERE assignment_id = ta.id AND event_type = 'task_assigned'
      LIMIT 1
    )`;

    const countRow = db.get(
      `SELECT COUNT(*) AS total FROM task_assignments ta WHERE ${whereSql}`,
      params
    );
    const total = countRow ? countRow.total : 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    const rows = db.all(
      `SELECT ta.*, ${eventSub} AS task_assigned_event_id
       FROM task_assignments ta
       WHERE ${whereSql}
       ORDER BY ta.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      code: 200,
      message: 'success',
      data: {
        list: rows.map(formatAssignmentListItem),
        pagination: { pageNum, pageSize, total, totalPages },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assignments/batch-create ────────────────────────────────────
// §3.4：仅写 task_assignments（不含通知）；central/admin

router.post('/batch-create', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { taskId, targetUsers } = req.body || {};
    if (!taskId || !Array.isArray(targetUsers) || targetUsers.length === 0) {
      throw createError(400, 'taskId 与 targetUsers 必填且 targetUsers 非空', 'ASSIGN_021');
    }

    const result = batchCreateAssignments(db, taskId, targetUsers);

    res.json({
      code: 200,
      message: '批量生成成功',
      data: {
        successCount: result.successCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        failedUsers: result.failedUsers,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/assignments/:id ──────────────────────────────────────────────

router.get('/:id', authenticate, (req, res, next) => {
  try {
    const eventSub = `(
      SELECT id FROM notification_events
      WHERE assignment_id = ta.id AND event_type = 'task_assigned'
      LIMIT 1
    )`;
    const row = db.get(
      `SELECT ta.*, ${eventSub} AS task_assigned_event_id
       FROM task_assignments ta
       WHERE ta.id = ?`,
      [req.params.id]
    );
    if (!row) throw createError(404, 'Assignment 不存在', 'ASSIGN_001');

    const { role, employeeId } = req.user;
    if (role === 'employee' && row.user_id !== employeeId) {
      throw createError(403, '无权查看此 Assignment', 'AUTH_003');
    }

    res.json({
      code: 200,
      message: 'success',
      data: formatAssignmentDetail(row),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assignments ─────────────────────────────────────────────────
// central/admin 创建基础 assignment（不包含状态机与通知）
router.post('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { taskId, userId, storeId } = req.body;
    if (!taskId || !userId || !storeId) {
      throw createError(400, 'taskId/userId/storeId 不能为空', 'ASSIGN_002');
    }

    const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw createError(400, 'taskId 不存在', 'ASSIGN_004');

    const employee = db.get('SELECT id, store_id FROM employees WHERE id = ?', [userId]);
    if (!employee) throw createError(400, 'userId 不存在', 'ASSIGN_005');
    if (employee.store_id !== storeId) {
      throw createError(400, 'storeId 与 userId 不匹配', 'ASSIGN_006');
    }

    const exists = db.get('SELECT id FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, userId]);
    if (exists) throw createError(409, '该用户已存在 assignment', 'ASSIGN_007');

    const now = new Date().toISOString();
    const id = nanoid();
    db.run(
      `INSERT INTO task_assignments
        (id, task_id, user_id, store_id, status, progress, nudge_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
      [id, taskId, userId, storeId, now, now]
    );

    const row = db.get('SELECT * FROM task_assignments WHERE id = ?', [id]);
    res.status(201).json({
      code: 201,
      message: 'success',
      data: formatAssignment(row),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/v1/assignments/:id ────────────────────────────────────────────
// Dev1 基础更新：仅支持 nudgeCount（状态机字段由 Dev2 接管）
router.patch('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT * FROM task_assignments WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, 'Assignment 不存在', 'ASSIGN_001');

    const { nudgeCount } = req.body;
    if (nudgeCount === undefined) {
      throw createError(400, '仅支持更新 nudgeCount', 'ASSIGN_008');
    }
    if (!Number.isInteger(nudgeCount) || nudgeCount < 0) {
      throw createError(400, 'nudgeCount 必须为非负整数', 'ASSIGN_009');
    }

    db.run(
      'UPDATE task_assignments SET nudge_count = ?, updated_at = ? WHERE id = ?',
      [nudgeCount, new Date().toISOString(), existing.id]
    );

    const row = db.get('SELECT * FROM task_assignments WHERE id = ?', [existing.id]);
    res.json({
      code: 200,
      message: 'success',
      data: formatAssignment(row),
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/v1/assignments/:id ───────────────────────────────────────────
// central/admin 删除基础 assignment（仅 pending 可删）
router.delete('/:id', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const existing = db.get('SELECT * FROM task_assignments WHERE id = ?', [req.params.id]);
    if (!existing) throw createError(404, 'Assignment 不存在', 'ASSIGN_001');
    if (existing.status !== 'pending') {
      throw createError(409, '仅 pending 状态可删除', 'ASSIGN_010');
    }

    const notifRef = db.get(
      'SELECT COUNT(*) AS count FROM notification_events WHERE assignment_id = ?',
      [existing.id]
    );
    if (notifRef && notifRef.count > 0) {
      throw createError(409, 'Assignment 已关联通知记录，无法删除', 'ASSIGN_017');
    }

    db.run('DELETE FROM task_assignments WHERE id = ?', [existing.id]);
    res.json({
      code: 200,
      message: 'success',
      data: { deleted: true },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/v1/assignments/:id/status ───────────────────────────────────────
// start_task（pending→in_progress）、complete_platform、complete_task 进度计算、完成时 WS 广播
router.put('/:id/status', authenticate, (req, res, next) => {
  try {
    const { operationType, platform } = req.body || {};
    if (!operationType || !['start_task', 'complete_platform', 'complete_task'].includes(operationType)) {
      throw createError(400, 'operationType 非法', 'ASSIGN_011');
    }

    const assignment = db.get('SELECT * FROM task_assignments WHERE id = ?', [req.params.id]);
    if (!assignment) throw createError(404, 'Assignment 不存在', 'ASSIGN_001');
    requireAssignmentActor(req, assignment);

    const task = db.get(
      'SELECT id, has_mypal, has_smartsell, has_ai_demo, has_live_broadcast FROM tasks WHERE id = ?',
      [assignment.task_id]
    );
    if (!task) throw createError(404, '任务不存在', 'TASK_002');

    const now = new Date().toISOString();
    let resolvedNudgeCount = 0;

    db.transaction(() => {
      const current = db.get('SELECT * FROM task_assignments WHERE id = ?', [assignment.id]);
      const configuredColumns = getConfiguredPlatformColumns(task);

      if (operationType === 'start_task') {
        if (current.status !== 'pending') {
          throw createError(409, '当前状态不可开始任务', 'ASSIGN_013');
        }
        db.run(
          'UPDATE task_assignments SET status = ?, started_at = ?, updated_at = ? WHERE id = ?',
          ['in_progress', now, now, current.id]
        );
        return;
      }

      if (operationType === 'complete_task') {
        if (current.status === 'completed') {
          throw createError(409, '任务已完成，禁止重复操作', 'ASSIGN_014');
        }
        
        let updates = configuredColumns.map(col => `${col} = 1`).join(', ');
        if (updates) updates += ', ';
        
        db.run(
          `UPDATE task_assignments
           SET ${updates}progress = 100, status = 'completed', completed_at = ?, updated_at = ?
           WHERE id = ?`,
          [now, now, current.id]
        );

        const count = db.get(
          `SELECT COUNT(*) AS count
           FROM notification_events
           WHERE assignment_id = ?
             AND event_type IN ('nudge_yellow', 'nudge_red')`,
          [current.id]
        );
        resolvedNudgeCount = (count && count.count) || 0;
        return;
      }

      // complete_platform
      if (!platform) throw createError(400, 'complete_platform 必须传 platform', 'ASSIGN_012');
      if (current.status === 'pending') {
        throw createError(409, 'pending 状态下不可标记平台完成', 'ASSIGN_013');
      }
      if (current.status === 'completed') {
        throw createError(409, '任务已完成，禁止重复操作', 'ASSIGN_014');
      }

      const platformColumn = mapPlatformToColumn(platform);
      if (!platformColumn) {
        throw createError(400, 'platform 非法', 'ASSIGN_012');
      }

      if (!configuredColumns.includes(platformColumn)) {
        throw createError(400, '该任务未配置此平台', 'ASSIGN_015');
      }

      if (current[platformColumn] === 1) {
        throw createError(409, '该平台已标记完成', 'ASSIGN_016');
      }

      db.run(
        `UPDATE task_assignments
         SET ${platformColumn} = 1, updated_at = ?
         WHERE id = ?`,
        [now, current.id]
      );

      const updated = db.get('SELECT * FROM task_assignments WHERE id = ?', [current.id]);
      const totalConfigured = configuredColumns.length;
      const completedCount = configuredColumns.reduce((acc, col) => acc + (updated[col] === 1 ? 1 : 0), 0);
      const progress = totalConfigured === 0 ? 0 : Math.round((completedCount / totalConfigured) * 100);
      const nextStatus = completedCount === totalConfigured ? 'completed' : 'in_progress';
      const completedAt = nextStatus === 'completed' ? now : null;

      db.run(
        `UPDATE task_assignments
         SET progress = ?, status = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
        [progress, nextStatus, completedAt, now, current.id]
      );

      if (nextStatus === 'completed') {
        const count = db.get(
          `SELECT COUNT(*) AS count
           FROM notification_events
           WHERE assignment_id = ?
             AND event_type IN ('nudge_yellow', 'nudge_red')`,
          [current.id]
        );
        resolvedNudgeCount = (count && count.count) || 0;
      }
    });

    const finalRow = db.get('SELECT * FROM task_assignments WHERE id = ?', [assignment.id]);

    // WS 广播：任务完成时通知本人、central（central 无 employeeId，靠轮询）
    if (finalRow.status === 'completed') {
      const wsPayload = {
        event: 'assignment_completed',
        data: {
          assignmentId: finalRow.id,
          taskId: finalRow.task_id,
          userId: finalRow.user_id,
          storeId: finalRow.store_id,
          completedAt: finalRow.completed_at,
        },
      };
      // 本人
      broadcastToUser(finalRow.user_id, wsPayload);
      const storePeers = db.all(
        'SELECT id FROM employees WHERE store_id = ? AND id != ?',
        [finalRow.store_id, finalRow.user_id]
      );
      broadcastToUsers(storePeers.map((p) => p.id), wsPayload);
    }

    res.json({
      code: 200,
      message: '状态更新成功',
      data: {
        assignmentId: finalRow.id,
        status: finalRow.status,
        progress: finalRow.progress,
        startedAt: finalRow.started_at,
        completedAt: finalRow.completed_at,
        updatedAt: finalRow.updated_at,
        resolvedNudgeCount,
        platformStatus: {
          mypalCompleted: finalRow.mypal_completed === 1,
          smartsellCompleted: finalRow.smartsell_completed === 1,
          aiDemoCompleted: finalRow.ai_demo_completed === 1,
          liveBroadcastCompleted: finalRow.live_broadcast_completed === 1,
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/assignments/:id/viewed ──────────────────────────────────────
// 记录任务详情已读（task_detail_open）：写 received_at + read_receipts

router.post('/:id/viewed', authenticate, (req, res, next) => {
  try {
    const { employeeId } = req.user;
    const assignment = db.get('SELECT * FROM task_assignments WHERE id = ?', [req.params.id]);
    if (!assignment) throw createError(404, 'Assignment 不存在', 'ASSIGN_001');

    // 仅允许 assignment 所属用户操作
    if (employeeId && assignment.user_id !== employeeId) {
      throw createError(403, '无权操作他人任务', 'AUTH_003');
    }

    const now = new Date().toISOString();
    let alreadyViewed = false;

    // 1. 写 received_at（首次打开时）
    if (assignment.received_at) {
      alreadyViewed = true;
    } else {
      db.run(
        'UPDATE task_assignments SET received_at = ?, updated_at = ? WHERE id = ?',
        [now, now, assignment.id]
      );
    }

    // 2. 查找该 assignment 对应的 task_assigned 通知事件（batch-create 路径可能无此事件）
    const event = db.get(
      `SELECT id FROM notification_events
       WHERE assignment_id = ? AND event_type = 'task_assigned'`,
      [assignment.id]
    );

    // 3. 写 read_receipts（幂等；若无 task_assigned 事件则跳过，如 batch-create 场景）
    const userId = employeeId || null;
    let receiptId = null;
    if (event) {
      const existing = db.get(
        'SELECT * FROM read_receipts WHERE event_id = ? AND user_id = ?',
        [event.id, userId]
      );
      if (existing) {
        receiptId = existing.id;
      } else {
        receiptId = nanoid();
        db.run(
          `INSERT INTO read_receipts (id, event_id, user_id, read_at, source)
           VALUES (?, ?, ?, ?, 'task_detail_open')`,
          [receiptId, event.id, userId, now]
        );
      }
    }

    const finalRow = db.get('SELECT received_at FROM task_assignments WHERE id = ?', [assignment.id]);

    res.json({
      code: 200,
      message: 'success',
      data: {
        assignmentId: assignment.id,
        receivedAt: finalRow.received_at,
        receiptId,
        alreadyViewed,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
