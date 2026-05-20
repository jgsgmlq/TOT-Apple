'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');
const {
  getOverviewBoardData, getFunnelData, getUnifiedAlertsBoardData,
  getHeatmapBoardData, getTrendBoardData, getWarningsBoardData,
  getNudgeConversionBoardData, getStoreRankBoardData,
} = require('../services/queryEngine');

const router = express.Router();

router.get('/overview', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getOverviewBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/heatmap', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getHeatmapBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/alerts-unified', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const data = await getUnifiedAlertsBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/trend', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getTrendBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/funnel', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getFunnelData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/warnings', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getWarningsBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/nudge-conversion', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getNudgeConversionBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

router.get('/store-rank', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await getStoreRankBoardData(req.query);
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

module.exports = router;
