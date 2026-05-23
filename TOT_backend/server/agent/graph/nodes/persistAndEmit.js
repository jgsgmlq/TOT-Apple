'use strict';

const { nanoid } = require('nanoid');
const { getTitleModel } = require('../llm');
const chatCrud = require('../../../modules/dashboard/crud/chatCrud');
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient } = require('../../../utils/tracer');
const { memoryQueueProducer } = require('../../queue/bullMqProducer');
const trace = require('../shared/runTrace');

const persistAndEmit = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const span = startNodeSpan(state, 'PersistAndEmit', { sessionId: state.sessionId, intent: state.intent });
  trace.nodeEnter(emitter, state, 'PersistAndEmit');
  const sessionId = state.sessionId;
  const replyContent = state.reply_markdown || state.finalResponse || "";
  const assistMsgId = nanoid();

  console.log(`[PersistAndEmit] 正在持久化会话 ${sessionId} 的机器人回复...`);

  let sessionTitle = null;

  try {
    // 从 replyContent 提取 overview 和结构化 JSON
    let overviewText = replyContent;
    let contentJson = null;
    if (typeof replyContent === 'string') {
      try {
        const parsed = JSON.parse(replyContent.trim());
        if (parsed && typeof parsed === 'object') {
          // 注入 trace_log 到 content_json
          if (Array.isArray(state.trace_log) && state.trace_log.length > 0) {
            parsed._trace = state.trace_log;
          }
          // Preserve _datasets and _contentText from finalResponse blocks output
          if (typeof replyContent === 'string') {
            try {
              const rj = JSON.parse(replyContent);
              if (rj._datasets) parsed._datasets = rj._datasets;
              if (rj._contentText) parsed._contentText = rj._contentText;
              if (rj._provenance) parsed._provenance = rj._provenance;
            } catch (_) {}
          }
          contentJson = JSON.stringify(parsed);
          // contentText: prefer _contentText (pre-extracted from blocks), fallback to overview
          let contentText = '';
          if (typeof parsed._contentText === 'string' && parsed._contentText.trim()) {
            contentText = parsed._contentText.trim();
          } else if (typeof parsed.overview === 'string' && parsed.overview.trim()) {
            contentText = parsed.overview.trim();
          } else if (typeof parsed.markdown === 'string') {
            contentText = parsed.markdown.trim().substring(0, 500);
          }
          overviewText = contentText;
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

    // 首次 assistant 回复后自动生成会话标题
    await generateSessionTitle(sessionId, state.userMessage, overviewText).catch(e =>
      console.warn('[PersistAndEmit] 标题生成失败（非致命）:', e.message)
    );
    try {
      const s = await chatCrud.getSession(sessionId);
      sessionTitle = s?.title || null;
    } catch { /* ignore */ }
  } catch (err) {
    throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 });
  }

  // 每 10 轮触发一次长期记忆提取
  const turnCount = await chatCrud.getUserMessageCount(sessionId);
  if (shouldTriggerLongTermExtraction(turnCount)) {
    memoryQueueProducer.publishMemoryIngestion({
      userId: state.userId || "mock_user_1",
      sessionId: state.sessionId,
      userMessage: state.userMessage,
      finalResponse: replyContent
    }).catch(e => console.error("发布记忆事件失败:", e));
  }

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
  trace.nodeExit(emitter, state, 'PersistAndEmit', { messageId: assistMsgId });
  trace.clearT0(sessionId);
  return {
    finalMessageId: assistMsgId,
    reply_markdown: replyContent,
    sessionTitle: sessionTitle || undefined,
  };
};

async function generateSessionTitle(sessionId, userMessage, overviewText) {
  // 仅在会话尚无标题时生成（避免重复覆盖）
  const sess = await chatCrud.getSession(sessionId);
  if (sess?.title) return;

  const user = (userMessage || '').slice(0, 200);
  const overview = (overviewText || '').slice(0, 200);
  if (!user && !overview) return;

  const llm = getTitleModel();

  const messages = [
    { role: "system", content: '你是一个对话标题生成器。根据对话内容提炼一个简洁的标题，概括本次对话讨论的主题。\n规则：\n1. 标题应概括对话主题，不是复述数据结论。例如用户问「哪些门店完成率低」，标题应为「门店完成率排查」，而不是「5家门店完成率低于50%」\n2. 使用名词性短语，不要用陈述句\n3. 只输出标题本身，不要引号、不要多余文字\n4. 不超过16个字' },
    { role: "user", content: `用户问题：${user}\nAI回答概要：${overview}\n\n标题：` },
  ];

  try {
    const resp = await llm.invoke(messages);
    const raw = (typeof resp.content === 'string' ? resp.content : '').trim();
    const title = raw.replace(/^["「《]|["」》]$/g, '').replace(/[。！？\.\!\?]$/, '').slice(0, 24).trim() || '新对话';
    await chatCrud.updateSessionTitle(sessionId, title);
    console.log(`[PersistAndEmit] 会话标题已生成: "${title}" (session=${sessionId})`);
  } catch (err) {
    console.warn(`[PersistAndEmit] 标题生成 LLM 调用失败: ${err.message}`);
  }
}

function shouldTriggerLongTermExtraction(turnCount) {
  return turnCount === 0 || turnCount % 10 === 0;
}

module.exports = { persistAndEmit, shouldTriggerLongTermExtraction };
