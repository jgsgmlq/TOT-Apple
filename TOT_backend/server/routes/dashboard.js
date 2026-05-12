'use strict';

/**
 * dashboard.js — 看板聚合查询
 *
 * 端点：
 *   GET /api/v1/dashboard/overview   §5.1 总部/Executive 概览 KPI
 *   GET /api/v1/dashboard/heatmap    §5.2 RTM/区域热力图
 *   GET /api/v1/dashboard/trend      §5.4 完成趋势
 *   GET /api/v1/dashboard/funnel     §5.10 转化漏斗 + 预警漏斗（大盘 + 下钻）
 *   GET /api/v1/dashboard/alerts-unified  预警列表四合一（P2/P1/P0/Unfinished）
 *
 * 门店层级下钻（可选 query，可组合，AND）：rtm、format、dealerName、storeId
 * 对应 stores：rtm → format → dealer_name → id。不传则与旧行为一致。
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getOverviewBoardData,
  getFunnelBoardData,
  getAlertFunnelData,
  getAlertDrillDownData,
  getUnifiedAlertsBoardData,
  getHeatmapBoardData,
  getTrendBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
} = require('../services/dashboardQueryCore');

const router = express.Router();

// ─── GET /api/v1/dashboard/overview ──────────────────────────────────────────
router.get('/overview', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getOverviewBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/heatmap ───────────────────────────────────────────
router.get('/heatmap', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getHeatmapBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/alerts-unified ───────────────────────────────────
router.get('/alerts-unified', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const data = getUnifiedAlertsBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/trend ──────────────────────────────────────────────
router.get('/trend', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getTrendBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/dashboard/funnel ────────────────────────────────────────
router.get('/funnel', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    let data;
    if (req.query.type === 'alert') {
      data = req.query.alertLevel
        ? getAlertDrillDownData(req.query)
        : getAlertFunnelData(req.query);
    } else {
      data = getFunnelBoardData(req.query);
    }
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
