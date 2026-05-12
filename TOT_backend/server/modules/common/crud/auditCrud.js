'use strict';

var getDb = require('../db/connection').getDb;

function getQueueSyncAuditList(o) {
  var d = o || {}, c = [], p = [];
  if (d.queueId) { c.push('queue_id = ?'); p.push(d.queueId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM learner_task_queue_sync_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 100, d.offset || 0]));
}

function getReminderSyncAuditList(o) {
  var d = o || {}, c = [], p = [];
  if (d.reminderId) { c.push('reminder_id = ?'); p.push(d.reminderId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM learner_task_reminder_sync_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 100, d.offset || 0]));
}

function getReminderAuditList(o) {
  var d = o || {}, c = [], p = [];
  if (d.reminderLogId) { c.push('reminder_log_id = ?'); p.push(d.reminderLogId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM task_reminder_audit_log ' + w + ' ORDER BY audited_at DESC LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 100, d.offset || 0]));
}

function getMypalAuditList(o) {
  var d = o || {}, c = [], p = [];
  if (d.syncDataId) { c.push('sync_data_id = ?'); p.push(d.syncDataId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM mypal_learning_progress_sync_api_audit_log ' + w + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 100, d.offset || 0]));
}

module.exports = {
  getQueueSyncAuditList: getQueueSyncAuditList,
  getReminderSyncAuditList: getReminderSyncAuditList,
  getReminderAuditList: getReminderAuditList,
  getMypalAuditList: getMypalAuditList,
};
