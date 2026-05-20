'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const taskCrud = require('../crud/taskMysqlCrud');
const { createError } = require('../../common/middleware/errorHandler');

const router = express.Router();

// ─── GET / — 催办记录列表（分页）───────────────────────────────────────

router.get('/', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { taskPublishId, level, emailId, pageNum = 1, pageSize = 20 } = req.query;
    const page  = Math.max(1, parseInt(pageNum, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (page - 1) * limit;

    const rows = await taskCrud.getReminderList({ taskPublishId, level, emailId, limit, offset });

    res.json({
      code: 200, message: 'success',
      data: {
        list: rows.map(r => ({
          reminderId:    r.reminder_id,
          queueId:       r.queue_id ?? null,
          taskPublishId: r.task_publish_id,
          emailId:       r.email_id,
          level:         r.reminder_level,
          channel:       r.reminder_channel ?? null,
          reminderAt:    r.reminder_at ?? null,
          result:        r.reminder_result ?? null,
          createdAt:     r.created_at,
        })),
        pagination: { pageNum: page, pageSize: limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) || 1 },
      },
      requestId: req.requestId,
    });
  } catch (err) { next(err); }
});

// ─── POST / — 手动催办 ─────────────────────────────────────────────────

router.post('/', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { taskPublishId, queueId, emailId, level, channel } = req.body || {};
    if (!taskPublishId) throw createError(400, 'taskPublishId 不能为空', 'NUDGE_003');
    if (!emailId)       throw createError(400, 'emailId 不能为空', 'NUDGE_003');
    if (!level)         throw createError(400, 'level 不能为空', 'NUDGE_003');

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await taskCrud.createReminder({
      id: nanoid(),
      taskPublishId,
      emailId,
      level: level || 'yellow',
    });

    res.json({
      code: 200, message: '催办已创建',
      data: { taskPublishId, emailId, level },
      requestId: req.requestId,
    });
  } catch (err) { next(err); }
});

// ─── GET /events — 催办日志列表（分页）─────────────────────────────────

router.get('/events', authenticate, async (req, res, next) => {
  try {
    const { taskPublishId, emailId, level, pageNum = 1, pageSize = 20 } = req.query;
    const page  = Math.max(1, parseInt(pageNum, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (page - 1) * limit;

    const rows = await taskCrud.getReminderLogList({ taskPublishId, emailId, level, limit, offset });

    res.json({
      code: 200, message: 'success',
      data: {
        list: rows.map(r => ({
          logId:         r.reminder_log_id,
          taskPublishId: r.task_publish_id,
          emailId:       r.email_id,
          level:         r.reminder_level,
          channel:       r.reminder_channel,
          reminderAt:    r.reminder_at,
          result:        r.reminder_result,
          createdAt:     r.created_at,
        })),
        pagination: { pageNum: page, pageSize: limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) || 1 },
      },
      requestId: req.requestId,
    });
  } catch (err) { next(err); }
});

module.exports = router;
