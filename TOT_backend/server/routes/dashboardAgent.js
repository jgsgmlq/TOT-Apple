'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getDashboardAgentInsight } = require('../services/dashboardAgentService');

const router = express.Router();

// GET /api/v1/dashboard/agent/diagnose
router.get('/agent/diagnose', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const userId = req.user.id;
    const data = await getDashboardAgentInsight(userId, refresh);

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
