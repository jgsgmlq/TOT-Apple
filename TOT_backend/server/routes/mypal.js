'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { isMypalIntegrationEnabled } = require('../services/mypalClient');
const { syncMypal } = require('../services/mypalSyncService');

const router = express.Router();

// ─── POST /api/v1/mypal/sync ───────────────────────────────────────────────────
router.post('/sync', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    if (!isMypalIntegrationEnabled()) {
      throw createError(503, 'MyPal 集成未启用或配置不完整（需 MYPAL_ENABLED=1 及 API 凭证）', 'MYPAL_DISABLED');
    }

    const mode = req.body && req.body.mode === 'weekly' ? 'weekly' : 'batch';
    const taskId = req.body && req.body.taskId != null ? String(req.body.taskId).trim() : undefined;
    const queryDate =
      req.body && req.body.queryDate != null ? String(req.body.queryDate).trim() : undefined;

    const summary = await syncMypal({ mode, taskId, queryDate });

    res.json({
      code: 200,
      message: 'success',
      data: summary,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
