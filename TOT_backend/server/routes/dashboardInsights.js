'use strict';

/**
 * 看板「智能洞察」：单接口按 insightType 生成 AI 总结（**SSE**），并落库；点赞/点踩单独提交。
 *
 * POST /api/v1/dashboard/insights（text/event-stream）
 * POST /api/v1/dashboard/insights/:insightId/vote
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createInsight, recordVote } = require('../services/dashboardInsightService');

const router = express.Router();

/** 固定返回 SSE（`text/event-stream`），成功体在 `event: done` 的 `data` 中，与原先 JSON 成功响应结构一致。 */
router.post(
  '/insights',
  authenticate,
  requireRole(['central', 'executive', 'admin']),
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      await createInsight(req.body || {}, userId, req, res);
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
