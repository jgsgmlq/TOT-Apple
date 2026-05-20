'use strict';

const express = require('express');
const { getDb } = require('../../common/db/connection');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { createError } = require('../../common/middleware/errorHandler');

const router = express.Router();

const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';

function resolveTaskWeek(queryTaskWeek) {
  if (queryTaskWeek) return String(queryTaskWeek);
  return MY_PAL_WEEK_PRIMARY;
}

router.get(
  '/learning',
  authenticate,
  requireRole(['central', 'executive', 'admin', 'employee']),
  (req, res, next) => {
    try {
      const taskWeek = resolveTaskWeek(req.query.taskWeek);
      const { role, employeeId, storeId } = req.user;
      const qEmployeeId = req.query.employeeId;
      const qStoreId = req.query.storeId;

      const COLS = [
        'm.seed_id', 'm.product_name', 'm.first_use_time',
        'm.task_week', 'm.progress', 'm.passed_week',
        'm.passed_time', 'm.required', 'm.week_start_time',
      ].join(', ');

      let rows;
      if (role === 'employee') {
        if (!employeeId) throw createError(403, '员工缺少 employeeId', 'MYPAL_002');
        rows = getDb().prepare(
          `SELECT ${COLS} FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`
        ).all(employeeId, taskWeek);
      } else if (qEmployeeId) {
        rows = getDb().prepare(
          `SELECT ${COLS} FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`
        ).all(qEmployeeId, taskWeek);
      } else if (qStoreId) {
        rows = getDb().prepare(
          `SELECT ${COLS} FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.store_id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`
        ).all(qStoreId, taskWeek);
      } else if (storeId) {
        rows = getDb().prepare(
          `SELECT ${COLS} FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.store_id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`
        ).all(storeId, taskWeek);
      } else {
        rows = getDb().prepare(
          `SELECT seed_id, product_name, first_use_time, task_week,
                  progress, passed_week, passed_time, required, week_start_time
           FROM mypal_learning_mock WHERE task_week = ?
           ORDER BY seed_id, product_name`
        ).all(taskWeek);
      }

      const list = rows.map((r) => ({
        seedId: r.seed_id,
        productName: r.product_name,
        firstUseTime: r.first_use_time,
        taskWeek: r.task_week,
        progress: r.progress,
        passedWeek: r.passed_week,
        passedTime: r.passed_time,
        required: r.required === 1,
        weekStartTime: r.week_start_time,
      }));

      res.json({ code: 200, message: 'success', data: list, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
