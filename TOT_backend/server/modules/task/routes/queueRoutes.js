'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const queueService = require('../services/queueService');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const data = await queueService.listQueues(req.query);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const data = await queueService.getQueueDetail(req.params.id);
    res.json({ code: 200, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const data = await queueService.createQueueEntry(req.body);
    res.status(201).json({ code: 201, message: 'success', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.post('/batch-create', authenticate, requireRole(['central', 'admin']), async (req, res, next) => {
  try {
    const { taskPublishId, entries } = req.body || {};
    const data = await queueService.batchCreateQueues(taskPublishId, entries);
    res.json({ code: 200, message: '批量创建成功', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    const data = await queueService.updateQueueStatus(req.params.id, req.body);
    res.json({ code: 200, message: '状态更新成功', data, requestId: req.requestId });
  } catch (err) { next(err); }
});

module.exports = router;
