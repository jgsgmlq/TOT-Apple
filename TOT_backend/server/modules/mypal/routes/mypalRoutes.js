'use strict';

var express = require('express');
var mypalService = require('../services/mypalService');
var { authenticate, requireRole } = require('../../common/middleware/auth');
var { success } = require('../../common/responseHelper');

var router = express.Router();

// ─── POST /api/v1/mypal/sync ──────────────────────────────────
router.post('/sync', authenticate, requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    if (!mypalService.isMypalEnabled()) {
      var err = new Error('MyPal 集成未启用');
      err.status = 503;
      throw err;
    }
    var queryDate = req.body && req.body.queryDate ? String(req.body.queryDate).trim() : undefined;
    var summary = await mypalService.syncLearningProgress(queryDate);
    res.json(success(summary));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/mypal/status ─────────────────────────────────
router.get('/status', authenticate, requireRole(['central', 'admin']), function(req, res, next) {
  try {
    var queryDate = req.query.queryDate || undefined;
    var data = mypalService.getSyncStatus(queryDate);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/mypal/audit/:syncDataId ──────────────────────
router.get('/audit/:syncDataId', authenticate, requireRole(['central', 'admin']), function(req, res, next) {
  try {
    var logs = mypalService.getSyncAuditLogs(req.params.syncDataId);
    res.json(success(logs));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
