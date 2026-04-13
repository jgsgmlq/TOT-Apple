'use strict';

/**
 * 看板「智能洞察」：单接口按 module 生成 AI 总结，并落库；点赞/点踩单独提交。
 *
 * POST /api/v1/dashboard/insights
 * POST /api/v1/dashboard/insights/:insightId/vote
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createInsight, recordVote } = require('../services/dashboardInsightService');

const router = express.Router();

router.post(
  '/insights',
  authenticate,
  requireRole(['central', 'executive', 'admin']),
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const data = await createInsight(req.body || {}, userId);
      res.json({ code: 200, message: 'success', data, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/insights/:insightId/vote',
  authenticate,
  requireRole(['central', 'executive', 'admin']),
  (req, res, next) => {
    try {
      const { vote } = req.body || {};
      const data = recordVote(req.params.insightId, vote);
      res.json({ code: 200, message: 'success', data, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
