'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');
const { createInsight, recordVote } = require('../services/insightService');
const { writeSseHeaders, createSseSender } = require('../../common/utils/sseResponse');

const router = express.Router();

// SSE streaming endpoint — route owns HTTP concerns, service owns business logic
router.post('/insights', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    writeSseHeaders(res);
    const send = createSseSender(res);

    const result = await createInsight(req.body || {}, req.user.id, (event) => {
      send(event.type, { text: event.text, phase: event.phase, message: event.message, code: event.code });
    });

    if (result) {
      send('done', { code: 200, message: 'success', data: result, requestId: req.requestId });
    }
    res.end();
  } catch (err) { next(err); }
});

router.post('/insights/:insightId/vote', authenticate, requireRole(['central', 'executive', 'admin']), async (req, res, next) => {
  try {
    const data = await recordVote(req.params.insightId, req.body || {});
    res.json(success(data, req.requestId));
  } catch (err) { next(err); }
});

module.exports = router;
