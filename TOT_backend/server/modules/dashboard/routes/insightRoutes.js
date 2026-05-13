'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { createInsight, recordVote } = require('../services/insightService');

const router = express.Router();

router.post('/insights', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const userId = req.user.id;
    await createInsight(req.body || {}, userId, req, res);
  } catch (err) { next(err); }
});

router.post('/insights/:insightId/vote', authenticate, requireRole(['central', 'executive', 'admin']), (req, res, next) => {
  try {
    const data = recordVote(req.params.insightId, req.body || {});
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

module.exports = router;
