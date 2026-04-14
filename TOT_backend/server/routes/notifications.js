'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

const router = express.Router();

// ─── 辅助：计算 isActive / resolvedAt（基于 assignment 状态）──────────────────

function computeIsActive(eventType, assignmentStatus) {
  if (eventType === 'task_updated') return true;
  return assignmentStatus !== 'completed';
}

function computeResolvedAt(eventType, assignmentCompletedAt) {
  if (eventType === 'task_updated') return null;
  return assignmentCompletedAt || null;
}

// ─── 辅助：格式化通知事件行 ──────────────────────────────────────────────────

function formatEvent(row) {
  const isActive = computeIsActive(row.event_type, row.assignment_status);
  const resolvedAt = computeResolvedAt(row.event_type, row.assignment_completed_at);
  
  let ruleType = null;
  if (row.dedupe_key && row.dedupe_key.startsWith('autonudge:')) {
    // dedupe_key is like "autonudge:ruleType:assignmentId"
    const parts = row.dedupe_key.split(':');
    if (parts.length >= 2) {
      ruleType = parts[1];
    }
  }

  return {
    eventId:       row.id,
    eventType:     row.event_type,
    taskId:        row.task_id,
    assignmentId:  row.assignment_id  || null,
    targetUserId:  row.target_user_id,
    storeId:       row.store_id,
    targetRole:    row.target_role,
    severity:      row.severity       || null,
    content:       row.content != null ? row.content : null,
    ruleType:      ruleType,
    isActive,
    resolvedAt,
    readStatus:    row.receipt_id != null,
    readAt:        row.read_at        || null,
    initiatorId:   row.initiator_id != null ? String(row.initiator_id) : null,
    initiatorRole: row.initiator_role || null,
    createdAt:     row.created_at,
  };
}

// ─── GET /api/v1/events/unread-count ─────────────────────────────────────────
// 必须先于 /:eventId 注册，避免 "unread-count" 被当 ID 匹配

router.get('/unread-count', authenticate, (req, res, next) => {
  try {
    const { employeeId } = req.user;
    if (!employeeId) {
      return res.json({ code: 200, message: 'success', data: { unreadCount: 0 }, requestId: req.requestId });
    }

    const row = db.get(
      `SELECT COUNT(*) AS cnt
       FROM notification_events ne
       LEFT JOIN read_receipts rr
         ON rr.event_id = ne.id AND rr.user_id = ?
       LEFT JOIN task_assignments ta
         ON ta.id = ne.assignment_id
       WHERE ne.target_user_id = ?
         AND rr.id IS NULL
         AND (
           (ne.event_type IN ('task_assigned', 'nudge_yellow', 'nudge_red')
             AND (ta.status IS NULL OR ta.status != 'completed'))
           OR ne.event_type = 'task_updated'
         )`,
      [employeeId, employeeId]
    );

    res.json({
      code: 200,
      message: 'success',
      data: { unreadCount: (row && row.cnt) || 0 },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/events ───────────────────────────────────────────────────────

router.get('/', authenticate, (req, res, next) => {
  try {
    const { role, employeeId, storeId } = req.user;
    const {
      eventType, taskId, targetUserId, assignmentId,
      storeId: qStoreId, severity,
      readStatus, isActive,
      pageNum = 1, pageSize = 20,
    } = req.query;

    const page  = Math.max(1, parseInt(pageNum,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    // 角色可见性 scope
    if (role === 'employee') {
      if (!employeeId) throw createError(403, '员工账号缺少 employeeId', 'AUTH_003');
      conditions.push('ne.target_user_id = ?');
      params.push(employeeId);
    }
    // central/admin/executive 无额外限制

    if (eventType)    { conditions.push('ne.event_type = ?');    params.push(eventType); }
    if (taskId)       { conditions.push('ne.task_id = ?');       params.push(taskId); }
    if (assignmentId) { conditions.push('ne.assignment_id = ?'); params.push(assignmentId); }
    if (qStoreId)     { conditions.push('ne.store_id = ?');      params.push(qStoreId); }
    if (severity)     { conditions.push('ne.severity = ?');      params.push(severity); }

    // targetUserId 参数（central 下钻时用）
    if (targetUserId) {
      conditions.push('ne.target_user_id = ?');
      params.push(targetUserId);
    }

    // isActive 过滤：task_updated 事件永远 active；其余取决于 assignment 是否已完成
    if (isActive !== undefined) {
      const wantActive = isActive === 'true' || isActive === '1';
      if (wantActive) {
        conditions.push(
          "(ne.event_type = 'task_updated' OR (ta.status IS NULL OR ta.status != 'completed'))"
        );
      } else {
        conditions.push(
          "(ne.event_type != 'task_updated' AND ta.status = 'completed')"
        );
      }
    }

    // readStatus 过滤：rr.id IS NULL → 未读；IS NOT NULL → 已读
    // 注意：currentEmployeeId 已作为首个参数绑定到 JOIN ON 子句
    if (readStatus !== undefined) {
      const wantRead = readStatus === 'true' || readStatus === '1';
      conditions.push(wantRead ? 'rr.id IS NOT NULL' : 'rr.id IS NULL');
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // currentEmployeeId 用于 JOIN read_receipts
    const currentEmployeeId = employeeId || null;

    // 查总数（需带 JOIN read_receipts 以支持 readStatus 过滤）
    const countRow = db.get(
      `SELECT COUNT(*) AS cnt
       FROM notification_events ne
       LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
       LEFT JOIN read_receipts rr
         ON rr.event_id = ne.id AND rr.user_id = ?
       ${whereClause}`,
      [currentEmployeeId, ...params]
    );
    const total = (countRow && countRow.cnt) || 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const rows = db.all(
      `SELECT
         ne.*,
         ta.status           AS assignment_status,
         ta.completed_at     AS assignment_completed_at,
         rr.id               AS receipt_id,
         rr.read_at
       FROM notification_events ne
       LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
       LEFT JOIN read_receipts rr
         ON rr.event_id = ne.id AND rr.user_id = ?
       ${whereClause}
       ORDER BY ne.created_at DESC
       LIMIT ? OFFSET ?`,
      [currentEmployeeId, ...params, limit, offset]
    );

    const list = rows.map(formatEvent);

    // 未读数（当前结果集内）
    const unreadCount = list.filter(e => !e.readStatus && e.isActive).length;

    res.json({
      code: 200,
      message: 'success',
      data: {
        list,
        pagination: { pageNum: page, pageSize: limit, total, totalPages },
        unreadCount,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/events ──────────────────────────────────────────────────────
// 仅供内部调用：task_assigned / task_updated（禁止 nudge_yellow/nudge_red）

router.post('/', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const { eventType, taskId, assignmentId, targetUserId, targetRole, dedupeKey } = req.body;

    if (!eventType) throw createError(400, 'eventType 不能为空', 'EVENT_001');
    if (['nudge_yellow', 'nudge_red'].includes(eventType)) {
      throw createError(400, 'nudge 事件必须通过 POST /nudges 创建', 'EVENT_002');
    }
    if (!['task_assigned', 'task_updated'].includes(eventType)) {
      throw createError(400, 'eventType 非法', 'EVENT_001');
    }
    if (!taskId)        throw createError(400, 'taskId 不能为空', 'EVENT_003');
    if (!targetUserId)  throw createError(400, 'targetUserId 不能为空', 'EVENT_004');
    if (!targetRole || targetRole !== 'employee') {
      throw createError(400, 'targetRole 必须为 employee', 'EVENT_005');
    }
    if (eventType === 'task_assigned') {
      if (!assignmentId) throw createError(400, 'task_assigned 事件必须提供 assignmentId', 'EVENT_006');
      if (!dedupeKey)    throw createError(400, 'task_assigned 事件必须提供 dedupeKey', 'EVENT_007');
    }

    const task = db.get('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) throw createError(404, 'taskId 不存在', 'TASK_002');

    const employee = db.get('SELECT id, store_id FROM employees WHERE id = ?', [targetUserId]);
    if (!employee) throw createError(404, 'targetUserId 不存在', 'EVENT_008');

    // 幂等：dedupeKey 已存在时返回已有 eventId
    if (dedupeKey) {
      const existing = db.get('SELECT id, created_at FROM notification_events WHERE dedupe_key = ?', [dedupeKey]);
      if (existing) {
        return res.json({
          code: 200,
          message: '事件已存在（幂等）',
          data: { eventId: existing.id, eventType, createdAt: existing.created_at },
          requestId: req.requestId,
        });
      }
    }

    const id  = nanoid();
    const now = formatNowSqliteLocal();
    db.run(
      `INSERT INTO notification_events
        (id, task_id, assignment_id, target_user_id, store_id, event_type, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, taskId, assignmentId || null, targetUserId, employee.store_id, eventType, dedupeKey || null, now]
    );

    res.json({
      code: 200,
      message: '事件创建成功',
      data: { eventId: id, eventType, createdAt: now },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
