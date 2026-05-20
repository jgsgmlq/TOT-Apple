'use strict';

const express = require('express');
const { openSyncAuth } = require('../middleware/openSyncAuth');
const openSyncService = require('../services/openSyncService');

const router = express.Router();

router.use(openSyncAuth);

function success(res, requestId, data) {
  return res.json({
    code: '0',
    message: 'success',
    requestId,
    data,
  });
}

function handleOpenSyncError(res, err, requestId) {
  const code = err.openSyncCode || '50001';
  const status = err.status || (code.startsWith('40') ? 400 : code.startsWith('401') ? 401 : 500);
  const message = err.message || '系统内部错误';
  return res.status(status).json({
    code,
    message,
    requestId: requestId || null,
    data: null,
  });
}

router.post('/learner-task-queue/pull', async (req, res) => {
  const requestId = req.openSyncRequestId;
  try {
    const email = req.body && req.body.email;
    const { records, _auditRows } = await openSyncService.pullLearnerTaskQueue(email);
    await openSyncService.writeQueuePullAudits(requestId, email, _auditRows, 'success');
    return success(res, requestId, { records });
  } catch (err) {
    return handleOpenSyncError(res, err, requestId);
  }
});

router.post('/learner-task-reminder/pull', async (req, res) => {
  const requestId = req.openSyncRequestId;
  try {
    const createdDate = req.body && req.body.createdDate;
    const { records, _auditRows } = await openSyncService.pullLearnerTaskReminder(createdDate);
    await openSyncService.writeReminderPullAudits(requestId, createdDate, _auditRows, 'success');
    return success(res, requestId, { records });
  } catch (err) {
    return handleOpenSyncError(res, err, requestId);
  }
});

module.exports = router;
