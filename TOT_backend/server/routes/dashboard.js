'use strict';

/**
 * dashboard.js — 看板聚合查询（Day 5 Dev2）
 *
 * 端点：
 *   GET /api/v1/dashboard/overview   §5.1 总部/Executive 概览 KPI
 *   GET /api/v1/dashboard/heatmap    §5.2 RTM/区域热力图
 *   GET /api/v1/dashboard/store-rank §5.3 Top/Bottom N 门店排行
 *   GET /api/v1/dashboard/warnings   §5.5 预警列表（临期 p0/p1 + 起步 p2）
 *
 * 门店层级下钻（可选 query，可组合，AND）：rtm、format、dealerName、storeId
 * 对应 stores：rtm → format → dealer_name → id。不传则与旧行为一致。
 *
 * completionRate / avgProgress 统一为整数 0-100。
 * 数据全部实时从 task_assignments 聚合，无缓存表。
 */

const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { parseStoreDrill } = require('../utils/storeDrill');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const {
  parsePlatformFilter,
  completedCondition,
  getOverviewBoardData,
  getHeatmapBoardData,
  getTrendBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
} = require('../services/dashboardQueryCore');

const router = express.Router();

// ─── GET /api/v1/dashboard/overview ──────────────────────────────────────────
// §5.1 总部概览 KPI

router.get('/overview', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getOverviewBoardData(req.query);
    res.json({
      code: 200,
      message: 'success',
      data,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/heatmap ────────────────────────────────────────────
// §5.2 RTM / 区域 / 业态热力图

router.get('/heatmap', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getHeatmapBoardData(req.query);
    res.json({
      code: 200,
      message: 'success',
      data,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/store-rank ─────────────────────────────────────────
// §5.3 Top / Bottom N 门店排行

router.get('/store-rank', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const { taskId, type, limit = 5 } = req.query;
    const drill = parseStoreDrill(req.query);
    const platform = parsePlatformFilter(req.query);

    if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');
    if (!type || !['top', 'bottom'].includes(type)) {
      throw createError(400, 'type 必须为 top 或 bottom', 'DASH_002');
    }
    const n = Math.min(50, Math.max(1, parseInt(limit, 10) || 5));

    const conditions = ['ta.task_id = ?'];
    const params = [taskId];
    if (drill.hasDrill) {
      conditions.push(drill.sql.replace(/^\s*AND\s+/, ''));
      params.push(...drill.params);
    }

    const whereClause = conditions.join(' AND ');

    const orderDir = type === 'top' ? 'DESC' : 'ASC';
    const bottomFilter = type === 'bottom' ? 'HAVING completion_rate < 100' : '';
    const completedCond = completedCondition(platform);

    const rows = db.all(
      `SELECT
         s.id AS store_id,
         s.name AS store_name,
         COUNT(ta.id) AS assignment_count,
         SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
         ROUND(100.0 * SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
         ROUND(AVG(ta.progress), 0) AS avg_progress
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       WHERE ${whereClause}
       GROUP BY ta.store_id
       ${bottomFilter}
       ORDER BY completion_rate ${orderDir}, avg_progress ${orderDir}, s.id ASC
       LIMIT ?`,
      [...params, n]
    );

    const rankList = rows.map(r => ({
      storeId:         r.store_id,
      storeName:       r.store_name,
      completionRate:  r.completion_rate || 0,
      assignmentCount: r.assignment_count,
      completedCount:  r.completed_count,
    }));

    const updatedAt = formatNowSqliteLocal();
    res.json({
      code: 200,
      message: 'success',
      data: { taskId, type, platform: platform ? platform.sourceLabel : null, rankList, updatedAt },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/warnings ───────────────────────────────────────────
// §5.5 预警列表（实时聚合，无独立 alerts 表）
// - p1/p0：task_assignments + deadlineCrisis 与 autoNudge 一致
// - 实体 warningRate：与 §5.1 同公式在单实体范围（起步异常=进度0人数/总人数；临期=未完成人数/总人数，且任务须落在对应临期带）

router.get('/warnings', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const data = getWarningsBoardData(req.query);
    res.json({
      code: 200,
      message: 'success',
      data,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/trend ──────────────────────────────────────────────
router.get('/trend', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getTrendBoardData(req.query);
    res.json({
      code: 200,
      message: 'success',
      data,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});


// ─── GET /api/v1/dashboard/nudge-conversion ──────────────────────────────
router.get('/nudge-conversion', authenticate, requireRole(['central', 'admin', 'executive']), (req, res, next) => {
  try {
    const data = getNudgeConversionBoardData(req.query);
    res.json({
      code: 200,
      message: 'success',
      data,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
