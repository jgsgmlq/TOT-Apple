'use strict';

const { get, all, run } = require('../../common/db/mysql');

async function createSession({ id, userId, entryType, scopeType, scopeRegionsJson, scopeRtm, ipAddress }) {
  await run(
    `INSERT INTO chat_session (id, user_id, entry_type, scope_type, scope_regions_json, scope_rtm, ip_address, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [id, userId, entryType || 'executive', scopeType, scopeRegionsJson || null, scopeRtm || null, ipAddress || null]
  );
}

async function getSession(id) {
  return await get('SELECT * FROM chat_session WHERE id = ? AND deleted_at IS NULL', [id]);
}

async function updateSessionActive(id) {
  await run('UPDATE chat_session SET last_active_at = NOW(3) WHERE id = ?', [id]);
}

async function updateSessionTitle(id, title) {
  await run('UPDATE chat_session SET title = ? WHERE id = ?', [title, id]);
}

async function insertMessage({ id, sessionId, role, contentText, contentJson, intentType, toolCallsJson, toolCallId, clientMessageId }) {
  await run(
    `INSERT INTO chat_message (id, session_id, role, content_text, content_json, intent_type, tool_calls_json, tool_call_id, client_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [id, sessionId, role, contentText, contentJson || null, intentType || null, toolCallsJson || null, toolCallId || null, clientMessageId || null]
  );
}

async function getMessages(sessionId) {
  return await all(
    'SELECT id, session_id, role, content_text, content_json, intent_type, tool_calls_json, tool_call_id, client_message_id, created_at FROM chat_message WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC',
    [sessionId]
  );
}

async function getMessageByClientId(clientMessageId) {
  if (!clientMessageId) return null;
  return await get('SELECT id FROM chat_message WHERE client_message_id = ?', [clientMessageId]);
}

async function insertFeedback({ id, messageId, userId, feedbackType }) {
  await run(
    `INSERT INTO chat_message_feedback (id, message_id, user_id, feedback_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE feedback_type = VALUES(feedback_type), updated_at = NOW(3)`,
    [id, messageId, userId, feedbackType]
  );
}

async function deleteFeedback(messageId, userId) {
  await run('DELETE FROM chat_message_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
}

async function getLastAssistantMessage(sessionId) {
  return await get(
    "SELECT id, content_text FROM chat_message WHERE session_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [sessionId]
  );
}

async function getMessageById(messageId) {
  return await get('SELECT id, role, session_id FROM chat_message WHERE id = ? AND deleted_at IS NULL', [messageId]);
}

async function deleteMessage(messageId) {
  await run('UPDATE chat_message SET deleted_at = NOW(3) WHERE id = ?', [messageId]);
}

async function getMessageCount(sessionId) {
  const row = await get('SELECT COUNT(*) AS total FROM chat_message WHERE session_id = ? AND deleted_at IS NULL', [sessionId]);
  return row ? row.total : 0;
}

async function softDeleteSessionMessages(sessionId) {
  await run('UPDATE chat_message SET deleted_at = NOW(3) WHERE session_id = ? AND deleted_at IS NULL', [sessionId]);
}

async function softDeleteSession(sessionId) {
  await run('UPDATE chat_session SET deleted_at = NOW(3) WHERE id = ?', [sessionId]);
}

async function getUserById(userId) {
  return await get('SELECT account_id, account_role, rtm FROM account WHERE account_id = ? AND enabled_flag = 1', [userId]);
}

async function getLatestDispatchedTask() {
  return await get("SELECT task_title AS title FROM task_publish WHERE publish_status = 'dispatched' ORDER BY created_at DESC LIMIT 1");
}

module.exports = {
  createSession, getSession, updateSessionActive, updateSessionTitle,
  insertMessage, getMessages, getMessageByClientId,
  insertFeedback, deleteFeedback,
  getLastAssistantMessage, getMessageById, deleteMessage, getMessageCount,
  softDeleteSessionMessages, softDeleteSession,
  getUserById, getLatestDispatchedTask,
};
