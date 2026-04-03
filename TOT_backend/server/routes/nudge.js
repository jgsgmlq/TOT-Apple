'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { broadcastToUsers } = require('../ws/manager');
const mainAgent = require('../agent');

const router = express.Router();

// ─── POST /api/v1/nudges/ai-generate ──────────────────────────────────────────
// AI 辅助生成催办文案

router.post('/ai-generate', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { taskId, userId, severity } = req.body;
    
    // 调用 Agent 执行催办技能
    const result = await mainAgent.execute('generate_nudge_message', {
      taskId,
      userId,
      severity
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

// ─── 辅助：按 targetType/targetId 找到本次催办涉及的 assignments ──────────────

function resolveTargetAssignments(taskId, targetType, targetId, callerStoreId) {
  if (targetType === 'employee') {
    // targetId = employees.id
    return db.all(
      `SELECT ta.id, ta.user_id, ta.store_id, ta.status
       FROM task_assignments ta
       WHERE ta.task_id = ? AND ta.user_id = ?`,
      [taskId, targetId]
    );
  }

  if (targetType === 'store') {
    // targetId = stores.id
    return db.all(
      `SELECT ta.id, ta.user_id, ta.store_id, ta.status
       FROM task_assignments ta
       WHERE ta.task_id = ? AND ta.store_id = ?`,
      [taskId, targetId]
    );
  }

  if (targetType === 'region') {
    // targetId = region name（如"华东"）
    const storeRows = db.all('SELECT id FROM stores WHERE region = ?', [targetId]);
    if (storeRows.length === 0) return [];
    const storeIds = storeRows.map(r => r.id);
    const placeholders = storeIds.map(() => '?').join(', ');
    return db.all(
      `SELECT ta.id, ta.user_id, ta.store_id, ta.status
       FROM task_assignments ta
       WHERE ta.task_id = ? AND ta.store_id IN (${placeholders})`,
      [taskId, ...storeIds]
    );
  }

  return [];
}

// ─── POST /api/v1/nudges ──────────────────────────────────────────────────────

router.post('/', authenticate, requireRole(['central']), (req, res, next) => {
  try {
    const { taskId, targetType, targetId, severity } = req.body;
    const { role, storeId: callerStoreId, id: callerId } = req.user;

    if (!taskId)      throw createError(400, 'taskId 不能为空', 'NUDGE_003');
    if (!targetType)  throw createError(400, 'targetType 不能为空', 'NUDGE_003');
    if (!targetId)    throw createError(400, 'targetId 不能为空', 'NUDGE_003');
    if (!severity)    throw createError(400, 'severity 不能为空', 'NUDGE_003');

    if (!['employee', 'store', 'region'].includes(targetType)) {
      throw createError(400, 'targetType 非法（employee/store/region）', 'NUDGE_003');
    }
    if (!['yellow', 'red'].includes(severity)) {
      throw createError(400, 'severity 非法（yellow/red）', 'NUDGE_003');
    }

    const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw createError(404, 'taskId 不存在', 'TASK_002');

    // 验证 targetId 存在（employee / store 类型）
    if (targetType === 'employee') {
      const emp = db.get('SELECT id, store_id FROM employees WHERE id = ?', [targetId]);
      if (!emp) throw createError(404, '目标员工不存在', 'NUDGE_004');
    } else if (targetType === 'store') {
      const store = db.get('SELECT id FROM stores WHERE id = ?', [targetId]);
      if (!store) throw createError(404, '目标门店不存在', 'NUDGE_004');
    }

    // 找到所有相关 assignments
    const allAssignments = resolveTargetAssignments(taskId, targetType, targetId, callerStoreId);

    const pendingAssignments = allAssignments.filter(a => a.status !== 'completed');
    const skippedCount = allAssignments.length - pendingAssignments.length;

    if (pendingAssignments.length === 0) {
      throw createError(409, '目标范围内所有 assignment 均已完成，无可催对象', 'NUDGE_001');
    }

    const now = new Date().toISOString();
    const nudgeRecordId = nanoid();
    const eventType = severity === 'red' ? 'nudge_red' : 'nudge_yellow';
    const initiatorRole = role;

    // 预生成所有 event ID
    const eventEntries = pendingAssignments.map(a => ({
      assignmentId: a.id,
      userId: a.user_id,
      storeId: a.store_id,
      eventId: nanoid(),
    }));
    const notificationEventIds = eventEntries.map(e => e.eventId);

    db.transaction(() => {
      // 1. 写 nudge_records
      db.run(
        `INSERT INTO nudge_records
          (id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nudgeRecordId, taskId, targetType, targetId, callerId, initiatorRole, severity,
         JSON.stringify(notificationEventIds), now]
      );

      // 2. 写 notification_events + nudge_count+1
      for (const entry of eventEntries) {
        db.run(
          `INSERT INTO notification_events
            (id, task_id, assignment_id, target_user_id, store_id, event_type, severity, initiator_id, created_at)
           VALUES (?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?)`,
          [entry.eventId, taskId, entry.assignmentId, entry.userId, entry.storeId,
           entry.assignmentId,
           eventType, severity, callerId, initiatorRole, now]
        );
        db.run(
          'UPDATE task_assignments SET nudge_count = nudge_count + 1, updated_at = ? WHERE id = ?',
          [now, entry.assignmentId]
        );
      }
    });

    // WS 广播 nudge_sent 给目标用户
    const targetEmployeeIds = eventEntries.map(e => e.userId);
    broadcastToUsers(targetEmployeeIds, {
      event: 'nudge_sent',
      data: {
        nudgeRecordId,
        taskId,
        severity,
        eventType,
        initiatorRole,
      },
    });

    res.json({
      code: 200,
      message: '催办执行成功',
      data: {
        nudgeRecordId,
        nudgedCount: pendingAssignments.length,
        skippedCount,
        failedCount: 0,
        failedReasons: [],
        notificationEventIds,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/nudges ───────────────────────────────────────────────────────

router.get('/', authenticate, requireRole(['central']), (req, res, next) => {
  try {
    const { role, storeId: callerStoreId } = req.user;
    const {
      taskId, targetType, targetId, severity,
      pageNum = 1, pageSize = 20,
    } = req.query;

    if (!taskId) throw createError(400, 'taskId 为必填参数', 'NUDGE_005');

    const page  = Math.max(1, parseInt(pageNum,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = ['nr.task_id = ?'];
    const params = [taskId];

    if (targetType) { conditions.push('nr.target_type = ?'); params.push(targetType); }
    if (targetId)   { conditions.push('nr.target_id = ?');   params.push(targetId); }
    if (severity)   { conditions.push('nr.severity = ?');    params.push(severity); }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = db.get(`SELECT COUNT(*) AS cnt FROM nudge_records nr ${whereClause}`, params);
    const total = (countRow && countRow.cnt) || 0;
    const totalPages = Math.ceil(total / limit);

    const rows = db.all(
      `SELECT nr.* FROM nudge_records nr ${whereClause}
       ORDER BY nr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const list = rows.map(r => {
      let eventIds;
      try { eventIds = JSON.parse(r.notification_event_ids); } catch (_) { eventIds = []; }
      return {
        nudgeRecordId: r.id,
        taskId: r.task_id,
        targetType: r.target_type,
        targetId: r.target_id,
        severity: r.severity,
        initiatorId: String(r.initiator_id),
        nudgedCount: eventIds.length,
        notificationEventIds: eventIds,
        createdAt: r.created_at,
      };
    });

    res.json({
      code: 200,
      message: 'success',
      data: {
        list,
        pagination: { pageNum: page, pageSize: limit, total, totalPages },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
