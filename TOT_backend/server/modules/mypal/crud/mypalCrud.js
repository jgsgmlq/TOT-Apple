'use strict';

const { get, all, run } = require('../../common/db/mysql');

const getSyncDataById = async (id) => {
  return await get('SELECT * FROM mypal_learning_progress_sync WHERE sync_data_id = ?', [id]);
};

const getSyncDataList = async (o) => {
  const d = o || {};
  const c = []; const p = [];
  if (d.taskWeek) { c.push('task_week = ?'); p.push(d.taskWeek); }
  if (d.emailId) { c.push('email_id = ?'); p.push(d.emailId); }
  const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return await all(
    'SELECT * FROM mypal_learning_progress_sync ' + w + ' ORDER BY synced_at DESC LIMIT ? OFFSET ?',
    [...p, d.limit || 100, d.offset || 0]
  );
};

const upsertSyncData = async (d) => {
  await run(
    `INSERT INTO mypal_learning_progress_sync (
       sync_data_id, task_week, email_id, product_name, progress,
       passed_week, passed_time, first_use_time, week_start_time,
       sync_mode, source_endpoint, synced_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       progress = VALUES(progress),
       passed_week = VALUES(passed_week),
       passed_time = VALUES(passed_time),
       synced_at = VALUES(synced_at)`,
    [d.id, d.taskWeek, d.emailId, d.productName, d.progress,
     d.passedWeek, d.passedTime, d.firstUseTime, d.weekStartTime,
     d.syncMode, d.sourceEndpoint]
  );
};

const createSyncAuditLog = async (d) => {
  await run(
    `INSERT INTO mypal_learning_progress_sync_api_audit_log (
       audit_id, sync_data_id, endpoint_name, request_payload_json,
       response_payload_json, app_id, request_id, nonce_value,
       request_timestamp_ms, http_status_code, biz_code, biz_message,
       duration_ms, success_flag, error_detail, synced_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [d.auditId, d.syncDataId, d.endpointName, d.requestPayload,
     d.responsePayload, d.appId, d.requestId, d.nonce,
     d.requestTimestampMs, d.httpStatusCode, d.bizCode, d.bizMessage,
     d.durationMs, d.successFlag, d.errorDetail]
  );
};

const getSyncAuditLogs = async (syncDataId) => {
  return await all(
    'SELECT * FROM mypal_learning_progress_sync_api_audit_log WHERE sync_data_id = ? ORDER BY created_at DESC',
    [syncDataId]
  );
};

module.exports = {
  getSyncDataById,
  getSyncDataList,
  upsertSyncData,
  createSyncAuditLog,
  getSyncAuditLogs,
};
