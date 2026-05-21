'use strict';

const { nanoid } = require('nanoid');
const chatCrud = require('../../../modules/dashboard/crud/chatCrud');
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient } = require('../../../utils/tracer');
const { memoryQueueProducer } = require('../../queue/bullMqProducer');

const persistAndEmit = async (state, config) => {
  const span = startNodeSpan(state, 'PersistAndEmit', { sessionId: state.sessionId, intent: state.intent });
  const sessionId = state.sessionId;
  const replyContent = state.reply_markdown || state.finalResponse || "";
  const assistMsgId = nanoid();

  if (process.env.TEST_MOCK_MODE === 'true') {
    console.log(`[PersistAndEmit] mock 模式: 跳过 DB 持久化, msgId=${assistMsgId}`);
    endSpan(span, { output: `mock:msgId=${assistMsgId}`, metadata: { contentBytes: replyContent.length } });
    return { finalMessageId: assistMsgId, reply_markdown: replyContent };
  }

  console.log(`[PersistAndEmit] 正在持久化会话 ${sessionId} 的机器人回复...`);

  try {
    // 从 replyContent 提取 overview 和结构化 JSON
    let overviewText = replyContent;
    let contentJson = null;
    if (typeof replyContent === 'string') {
      try {
        const parsed = JSON.parse(replyContent.trim());
        if (parsed && typeof parsed === 'object') {
          contentJson = replyContent.trim();
          if (typeof parsed.overview === 'string' && parsed.overview.trim()) {
            overviewText = parsed.overview.trim();
          }
        }
      } catch (_) { /* plain text, no JSON */ }
    }
    await chatCrud.insertMessage({
      id: assistMsgId, sessionId, role: 'assistant',
      contentText: overviewText,
      contentJson,
      intentType: state.intent || null,
    });
    await chatCrud.updateSessionActive(sessionId);
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
