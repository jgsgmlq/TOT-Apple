'use strict';

const express = require('express');
const mypalService = require('../services/mypalService');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');

const router = express.Router();

router.post('/sync', authenticate, requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    if (!mypalService.isMypalEnabled()) {
      const err = new Error('MyPal 集成未启用');
      err.status = 503;
      throw err;
    }
    const queryDate = req.body && req.body.queryDate ? String(req.body.queryDate).trim() : '';
    if (!queryDate) {
      const e = new Error('queryDate 不能为空');
      e.status = 400;
      throw e;
    }
    const summary = await mypalService.syncLearningProgress(queryDate);
    res.json(success(summary));
  } catch (err) {
    next(err);
  }
});

router.get('/status', authenticate, requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const queryDate = req.query.queryDate || undefined;
    const data = await mypalService.getSyncStatus(queryDate);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

router.get('/audit/:syncDataId', authenticate, requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const logs = await mypalService.getSyncAuditLogs(req.params.syncDataId);
    res.json(success(logs));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
