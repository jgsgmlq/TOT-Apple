'use strict';

const { all, run } = require('../../common/db/mysql');
const { nanoid } = require('nanoid');

const MODEL_TYPE_FILTER = "ca.model_type IN ('BAU', 'NPI') OR ca.model_type IS NULL";

const QUEUE_PULL_SQL = `
  SELECT ltq.queue_id, ltq.email_id, ltq.task_publish_id, ltq.priority_level, ltq.created_at AS queue_created_at,
         tp.task_title, tp.task_description, tp.start_date, tp.due_date, tp.publish_status, tp.created_at AS task_created_at,
         ca.task_week, ca.topic_name, ca.model_type
  FROM learner_task_queue ltq
  INNER JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id
  LEFT JOIN campaign_activity ca ON ca.activity_id = tp.activity_id
  WHERE LOWER(TRIM(ltq.email_id)) = ?
    AND tp.publish_status = 'dispatched'
    AND (${MODEL_TYPE_FILTER})
  ORDER BY ltq.created_at DESC
`;

const REMINDER_PULL_SQL = `
  SELECT ltr.reminder_id, ltr.email_id, ltr.task_publish_id, ltr.reminder_level, ltr.created_at,
         tp.task_title, tp.task_description, tp.start_date, tp.due_date,
         ca.task_week, ca.topic_name, ca.model_type
  FROM learner_task_reminder ltr
  INNER JOIN task_publish tp ON tp.task_publish_id = ltr.task_publish_id
  LEFT JOIN campaign_activity ca ON ca.activity_id = tp.activity_id
  WHERE DATE(ltr.created_at) = ?
    AND tp.publish_status = 'dispatched'
    AND (ca.model_type IN ('BAU', 'NPI'))
  ORDER BY ltr.created_at ASC
`;

async function pullQueueRowsByEmail(email) {
  return await all(QUEUE_PULL_SQL, [email]);
}

async function pullReminderRowsByCreatedDate(createdDate) {
  return await all(REMINDER_PULL_SQL, [createdDate]);
}

async function getMyPalProgressForLearner(emailId, taskWeeks) {
  const weeks = [...new Set((taskWeeks || []).filter(Boolean))];
  if (!weeks.length) return [];
  const weekPh = weeks.map(() => '?').join(',');
  return await all(
    `SELECT email_id, task_week, product_name, progress, required_flag,
            first_use_time, passed_week, passed_time
     FROM mypal_learning_progress_sync
     WHERE LOWER(TRIM(email_id)) = ? AND task_week IN (${weekPh})`,
    [emailId.toLowerCase(), ...weeks]
  );
}

async function getConfirmationEmails(taskPublishIds, emailId) {
  if (!taskPublishIds.length) return new Set();
  const ph = taskPublishIds.map(() => '?').join(',');
  const rows = await all(
    `SELECT DISTINCT task_publish_id
     FROM task_reminder_log
     WHERE LOWER(TRIM(email_id)) = ?
       AND task_publish_id IN (${ph})
       AND reminder_result IN ('success', 'received')`,
    [emailId, ...taskPublishIds]
  );
  return new Set(rows.map(r => r.task_publish_id));
}

async function insertQueueSyncAudit({ queueId, requestId, syncResult, requestPayload, responsePayload }) {
  const id = nanoid();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run(
    `INSERT INTO learner_task_queue_sync_audit_log
     (queue_sync_audit_id, queue_id, request_id, sync_result, request_payload_text, response_payload_text, synced_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, queueId, requestId, syncResult, requestPayload, responsePayload, now, 'open_sync']
  );
}

async function insertReminderSyncAudit({ reminderId, requestId, syncResult, requestPayload, responsePayload }) {
  const id = nanoid();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run(
    `INSERT INTO learner_task_reminder_sync_audit_log
     (reminder_sync_audit_id, reminder_id, request_id, sync_result, request_payload_text, response_payload_text, synced_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, reminderId, requestId, syncResult, requestPayload, responsePayload, now, 'open_sync']
  );
}

module.exports = {
  pullQueueRowsByEmail,
  pullReminderRowsByCreatedDate,
  getMyPalProgressForLearner,
  getConfirmationEmails,
  insertQueueSyncAudit,
  insertReminderSyncAudit,
};
