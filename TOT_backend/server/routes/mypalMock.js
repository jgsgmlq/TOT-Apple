'use strict';

const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

const router = express.Router();

const MY_PAL_WEEK_PRIMARY = 'FY26Q2W1';
const MY_PAL_WEEK_SECONDARY = 'FY26Q2W2';

function isMypalMockEnabled() {
  return process.env.MYPAL_MOCK === '1';
}

function resolveTaskWeek(queryTaskWeek, queryDate) {
  if (queryTaskWeek) return String(queryTaskWeek);
  if (queryDate) {
    // 开发期简化：当仅提供 queryDate 时，固定映射到主周次以保证联调可用。
    return MY_PAL_WEEK_PRIMARY;
  }
  return MY_PAL_WEEK_PRIMARY;
}

router.get(
  '/learning',
  authenticate,
  requireRole(['central', 'executive', 'admin', 'employee']),
  (req, res, next) => {
    try {
      if (!isMypalMockEnabled()) {
        return next(createError(404, 'MyPal mock 未启用', 'MYPAL_001'));
      }

      const taskWeek = resolveTaskWeek(req.query.taskWeek, req.query.queryDate);

      const { role, employeeId, storeId } = req.user;
      const qEmployeeId = req.query.employeeId;
      const qStoreId = req.query.storeId;

      // employee：只能查自己
      if (role === 'employee') {
        if (!employeeId) throw createError(403, '员工缺少 employeeId', 'MYPAL_002');

        const rows = db.all(
          `SELECT
             m.seed_id,
             m.product_name,
             m.first_use_time,
             m.task_week,
             m.progress,
             m.passed_week,
             m.passed_time,
             m.required,
             m.week_start_time
           FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`,
          [employeeId, taskWeek]
        );

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

        return res.json({ code: 200, message: 'success', data: list, requestId: req.requestId });
      }

      // central/executive/admin：支持按 employeeId / storeId 过滤；不传则按 taskWeek 全量返回（mock 数据量可控）
      let rows;
      if (qEmployeeId) {
        rows = db.all(
          `SELECT
             m.seed_id,
             m.product_name,
             m.first_use_time,
             m.task_week,
             m.progress,
             m.passed_week,
             m.passed_time,
             m.required,
             m.week_start_time
           FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`,
          [qEmployeeId, taskWeek]
        );
      } else if (qStoreId) {
        rows = db.all(
          `SELECT
             m.seed_id,
             m.product_name,
             m.first_use_time,
             m.task_week,
             m.progress,
             m.passed_week,
             m.passed_time,
             m.required,
             m.week_start_time
           FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.store_id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`,
          [qStoreId, taskWeek]
        );
      } else if (storeId) {
        // JWT 中若带 storeId（理论上只有 employee），这里兜底
        rows = db.all(
          `SELECT
             m.seed_id,
             m.product_name,
             m.first_use_time,
             m.task_week,
             m.progress,
             m.passed_week,
             m.passed_time,
             m.required,
             m.week_start_time
           FROM mypal_learning_mock m
           JOIN employees e ON lower(trim(e.email)) = m.seed_id
           WHERE e.store_id = ? AND m.task_week = ?
           ORDER BY m.seed_id, m.product_name`,
          [storeId, taskWeek]
        );
      } else {
        rows = db.all(
          `SELECT
             seed_id,
             product_name,
             first_use_time,
             task_week,
             progress,
             passed_week,
             passed_time,
             required,
             week_start_time
           FROM mypal_learning_mock
           WHERE task_week = ?
           ORDER BY seed_id, product_name`,
          [taskWeek]
        );
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

      return res.json({ code: 200, message: 'success', data: list, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

