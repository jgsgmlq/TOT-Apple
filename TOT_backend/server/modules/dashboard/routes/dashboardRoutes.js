'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const {
  getOverviewBoardData, getFunnelBoardData, getAlertFunnelData,
  getAlertDrillDownData, getUnifiedAlertsBoardData, getHeatmapBoardData,
  getTrendBoardData, getWarningsBoardData, getNudgeConversionBoardData,
} = require('../services/queryEngine');

const router = express.Router();

router.get('/overview', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getOverviewBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.get('/heatmap', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getHeatmapBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.get('/alerts-unified', authenticate, requireRole(['central', 'admin']), (req, res, next) => {
  try {
    const data = getUnifiedAlertsBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.get('/trend', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getTrendBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

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
  } catch (err) { next(err); }
});

router.get('/warnings', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getWarningsBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.get('/nudge-conversion', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = getNudgeConversionBoardData(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

module.exports = router;
