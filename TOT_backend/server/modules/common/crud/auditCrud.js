'use strict';

const { get, all } = require('../db/mysql');

const getQueueSyncAuditList = async (o) => {
  const d = o || {};
  const c = []; const p = [];
  if (d.queueId) { c.push('queue_id = ?'); p.push(d.queueId); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM learner_task_queue_sync_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?',
    [...p, d.limit || 100, d.offset || 0]
  );
};

const getReminderSyncAuditList = async (o) => {
  const d = o || {};
  const c = []; const p = [];
  if (d.reminderId) { c.push('reminder_id = ?'); p.push(d.reminderId); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM learner_task_reminder_sync_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?',
    [...p, d.limit || 100, d.offset || 0]
  );
};

const getReminderAuditList = async (o) => {
  const d = o || {};
  const c = []; const p = [];
  if (d.reminderLogId) { c.push('reminder_log_id = ?'); p.push(d.reminderLogId); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM task_reminder_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?',
    [...p, d.limit || 100, d.offset || 0]
  );
};

const getMypalAuditList = async (o) => {
  const d = o || {};
  const c = []; const p = [];
  if (d.syncDataId) { c.push('sync_data_id = ?'); p.push(d.syncDataId); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM mypal_learning_progress_sync_api_audit_log ' + w + ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [...p, d.limit || 100, d.offset || 0]
  );
};

module.exports = {
  getQueueSyncAuditList,
  getReminderSyncAuditList,
  getReminderAuditList,
  getMypalAuditList,
};
