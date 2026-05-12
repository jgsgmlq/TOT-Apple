'use strict';

var getDb = require('../../common/db/connection').getDb;

function getSyncDataById(id) {
  return getDb().prepare('SELECT * FROM mypal_learning_progress_sync WHERE sync_data_id = ?').get(id) ?? null;
}
function getSyncDataList(o) {
  var d = o || {}, c = [], p = [];
  if (d.taskWeek) { c.push('task_week = ?'); p.push(d.taskWeek); }
  if (d.emailId) { c.push('email_id = ?'); p.push(d.emailId); }
  var w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return getDb().prepare('SELECT * FROM mypal_learning_progress_sync ' + w + ' ORDER BY synced_at DESC LIMIT ? OFFSET ?').all.apply(null, p.concat([d.limit || 100, d.offset || 0]));
}
function upsertSyncData(d) {
  var db = getDb();
  db.prepare('INSERT INTO mypal_learning_progress_sync (sync_data_id, task_week, email_id, product_name, progress, passed_week, passed_time, first_use_time, week_start_time, sync_mode, source_endpoint, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'), datetime(\'now\', \'localtime\')) ON CONFLICT(sync_data_id) DO UPDATE SET progress=excluded.progress, passed_week=excluded.passed_week, passed_time=excluded.passed_time, synced_at=excluded.synced_at')
    .run(d.id, d.taskWeek, d.emailId, d.productName, d.progress, d.passedWeek, d.passedTime, d.firstUseTime, d.weekStartTime, d.syncMode, d.sourceEndpoint);
}
function createSyncAuditLog(d) {
  getDb().prepare('INSERT INTO mypal_learning_progress_sync_api_audit_log (audit_id, sync_data_id, endpoint_name, request_payload_json, response_payload_json, app_id, request_id, nonce_value, request_timestamp_ms, http_status_code, biz_code, biz_message, duration_ms, success_flag, error_detail, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'), datetime(\'now\', \'localtime\'))')
    .run(d.auditId, d.syncDataId, d.endpointName, d.requestPayload, d.responsePayload, d.appId, d.requestId, d.nonce, d.requestTimestampMs, d.httpStatusCode, d.bizCode, d.bizMessage, d.durationMs, d.successFlag, d.errorDetail);
}
function getSyncAuditLogs(syncDataId) {
  return getDb().prepare('SELECT * FROM mypal_learning_progress_sync_api_audit_log WHERE sync_data_id = ? ORDER BY created_at DESC').all(syncDataId);
}

module.exports = { getSyncDataById: getSyncDataById, getSyncDataList: getSyncDataList, upsertSyncData: upsertSyncData, createSyncAuditLog: createSyncAuditLog, getSyncAuditLogs: getSyncAuditLogs };
