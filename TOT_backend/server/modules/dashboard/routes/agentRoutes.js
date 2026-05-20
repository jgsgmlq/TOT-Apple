'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');
const { getDashboardAgentInsight } = require('../services/dashboardAgentService');

const router = express.Router();

router.get('/agent/diagnose', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const data = await getDashboardAgentInsight(req.user.id, refresh);
    res.json(success(data, req.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
