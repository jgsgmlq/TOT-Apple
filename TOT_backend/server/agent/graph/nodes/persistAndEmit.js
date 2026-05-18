'use strict';

const { nanoid } = require('nanoid');
const { db } = require('../../../db');
const { formatNowSqliteLocal } = require('../../../utils/ddlAt');
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient } = require('../../../utils/tracer');
const { memoryQueueProducer } = require('../../queue/bullMqProducer');

const persistAndEmit = async (state, config) => {
  const span = startNodeSpan(state, 'PersistAndEmit', { sessionId: state.sessionId, intent: state.intent });
  const sessionId = state.sessionId;
  const replyContent = state.reply_markdown || state.finalResponse || "";
  const now = formatNowSqliteLocal();
  const assistMsgId = nanoid();

  console.log(`[PersistAndEmit] 正在持久化会话 ${sessionId} 的机器人回复...`);

  try {
    db.transaction(() => {
      db.run(
        'INSERT INTO chat_messages (id, session_id, role, content, intent_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [assistMsgId, sessionId, 'assistant', replyContent, state.intent || null, now]
      );
      db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]);
    });
  } catch (err) {
    throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 });
  }

  memoryQueueProducer.publishMemoryIngestion({
    userId: state.userId || "mock_user_1",
    sessionId: state.sessionId,
    userMessage: state.userMessage,
    finalResponse: replyContent
  }).catch(e => console.error("发布记忆事件失败:", e));

  if (config?.configurable?.traceId) {
    try {
      const lf = getClient();
      if (lf) {
        lf.trace({ id: config.configurable.traceId }).update({
          output: replyContent,
          metadata: {
            mode: state.mode,
            intent: state.intent,
            fc_steps_used: state.fc_super_step_count,
            escalate_count: state.escalate_count || 0,
            extracted_task_ref: state.extracted_task_ref || null,
            ambiguity: state.ambiguity_payload?.type || null,
            error_code: (replyContent && replyContent.includes("SYSTEM_ERROR")) ? "TOOL_PARAM_ERROR" : undefined
          }
        });
        lf.flushAsync().catch(() => {});
      }
    } catch (err) {
      console.warn('[Langfuse] final trace update skipped:', err.message);
    }
  }

  endSpan(span, { output: `msgId=${assistMsgId}`, metadata: { contentBytes: replyContent.length } });
  return {
    finalMessageId: assistMsgId,
    reply_markdown: replyContent
  };
};

module.exports = { persistAndEmit };
