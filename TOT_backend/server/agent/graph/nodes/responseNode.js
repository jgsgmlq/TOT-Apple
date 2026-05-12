'use strict';

const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { getFcModel } = require('../modelFactory');
const { nanoid } = require('nanoid');
const { db } = require('../../../db');
const { formatNowSqliteLocal } = require('../../../utils/ddlAt');
const { memoryQueueProducer } = require("../../queue/bullMqProducer");
const { getClient, endGeneration, endSpan, maskPII, preview, NOOP_TRACE } = require("../../../utils/tracer");
const promptRegistry = require('../../../prompts/registry');
const { sanitizeUserFacingMarkdown } = require('../sanitize');
const { renderToolResultsMarkdown } = require('../renderers');
const { interrupt } = require("@langchain/langgraph");
const { makeToolMessage } = require('../toolCallUtils');

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try { const client = getClient(); return client ? client.span({ traceId, name, input }) : null; }
  catch { return null; }
};

const humanInTheLoopGate = async (state) => {
  const span = startNodeSpan(state, 'HumanInTheLoopGate', { hitlStatus: state.hitl_status });
  const payload = state.interrupt_payload;
  console.log(`[HITL] paused, waiting for resume. payload:`, payload);
  const userResponse = interrupt(payload);
  console.log(`[HITL] received:`, userResponse);
  const normalized = userResponse?.resumePayload || userResponse?.resume_payload || userResponse?.value || userResponse;
  const resumeType = normalized?.resume_type || (normalized?.selected_option_id?.startsWith('clarify_') ? 'intent_shift' : 'slot_fill');
  const isIntentShift = resumeType === 'intent_shift';
  const isCancel = resumeType === 'cancel';
  const userText = typeof normalized?.user_text === 'string' && normalized.user_text.trim() ? normalized.user_text.trim() : (typeof normalized?.value === 'string' ? normalized.value.trim() : '');

  if (isCancel) {
    endSpan(span, { output: 'cancel' });
    const cancelMsg = '已取消本次查询。如需继续，请告诉我新的问题。';
    return { hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized, pending_tool_calls: [], reply_markdown: cancelMsg, finalResponse: cancelMsg, fc_next_action: 'finalize', messages: [new AIMessage({ content: cancelMsg })] };
  }
  if (isIntentShift) {
    endSpan(span, { output: 'intent_shift' });
    const nextUserMessage = userText || state.userMessage;
    const cancelMessages = (state.pending_tool_calls || []).map(tc => makeToolMessage({ id: tc.id || 'unknown', name: tc.name || 'clarify_intent' }, { error: 'User cancelled due to intent shift.' }));
    return { hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized, userMessage: nextUserMessage, intent: '', entities: {}, entities_confidence: {}, candidateTools: [], pending_tool_calls: [], fc_next_action: 're_route', messages: [...cancelMessages, new HumanMessage(nextUserMessage)] };
  }
  endSpan(span, { output: resumeType });
  const messageContent = `用户确认: ${JSON.stringify(normalized?.value ?? normalized?.selected_option_id ?? normalized)}`;
  return { hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized, fc_next_action: 'validate', messages: [new ToolMessage({ tool_call_id: payload?.resume_token || 'unknown_token', name: 'clarify_intent', content: messageContent })] };
};

const finalResponseStep = async (state, config) => {
  let response = state.reply_markdown || state.finalResponse || "";
  if (!response) {
    if (state.mode === "deny") {
      response = "### ⚠️ 请求被拒绝\n\n抱歉，Executive Chat 目前仅支持**只读查询**。我无法帮您执行修改数据、发送催办通知或直接处理业务流等操作。\n\n💡 *建议您可以在系统中手动处理，或询问我当前的数据完成情况。*";
    } else if ((state.mode === "chat_only" || state.intent === "chat_only") && Object.keys(state.toolResults || {}).length === 0) {
      console.log(`[FinalResponseStep] chat_only, calling LLM...`);
      const emitter = config?.configurable?.sseEmitter;
      const llm = getFcModel();
      const traceId = config?.configurable?.traceId;
      const client = getClient();
      const chatGen = client && traceId ? client.generation({ traceId, name: 'FinalResponse_ChatReply', model: 'deepseek-chat', input: maskPII(state.userMessage), metadata: { intent: 'chat_only' } }) : NOOP_TRACE.generation({ name: 'FinalResponse_ChatReply' });
      const chatContext = (state.messages || []).filter(m => { const t = m._getType ? m._getType() : ''; return t === 'human' || t === 'ai'; }).slice(-7, -1);
      const contextBlock = chatContext.length > 0 ? `\n\nRecent conversation:\n${chatContext.map(m => `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : ''}`).join('\n')}` : '';
      const chatPrompt = promptRegistry.get('chat_reply') + contextBlock;
      try {
        const stream = await llm.stream([new SystemMessage(chatPrompt), new HumanMessage(state.userMessage)]);
        response = "";
        for await (const chunk of stream) { const t = typeof chunk.content === 'string' ? chunk.content : ''; if (t) { response += t; if (emitter?.handleLLMNewToken) emitter.handleLLMNewToken(t, { isReasoning: false }); } }
        endGeneration(chatGen, { output: maskPII(preview(response)), model: 'deepseek-chat', metadata: { intent: 'chat_only' } });
      } catch (err) { console.error('[FinalResponseStep] failed:', err); endGeneration(chatGen, { output: preview(err.message), level: 'ERROR', statusMessage: err.message, model: 'deepseek-chat', metadata: { intent: 'chat_only' } }); response = "你好！我是您的 Executive Chat 智能助理。"; }
    } else { response = renderToolResultsMarkdown(state.toolResults || {}, state.intent) || "抱歉，我暂时无法回答这个问题。请稍后重试或尝试缩小查询范围。"; }
  }
  response = sanitizeUserFacingMarkdown(response);
  return { finalResponse: response, reply_markdown: response, messages: [new AIMessage({ content: response })] };
};

const persistAndEmit = async (state, config) => {
  const span = startNodeSpan(state, 'PersistAndEmit', { sessionId: state.sessionId, intent: state.intent });
  const sessionId = state.sessionId;
  const replyContent = state.reply_markdown || state.finalResponse || "";
  const now = formatNowSqliteLocal();
  const assistMsgId = nanoid();
  try {
    db.transaction(() => { db.run('INSERT INTO chat_messages (id, session_id, role, content, intent_type, entities_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [assistMsgId, sessionId, 'assistant', replyContent, state.intent || null, JSON.stringify(state.entities || {}), now]); db.run('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [now, sessionId]); });
  } catch (err) { throw Object.assign(new Error(`CHAT_PERSIST_FAILED: ${err.message}`), { code: 'CHAT_PERSIST_FAILED', status: 500 }); }
  memoryQueueProducer.publishMemoryIngestion({ userId: state.userId || "mock_user_1", sessionId: state.sessionId, userMessage: state.userMessage, finalResponse: replyContent }).catch(e => console.error("memory event failed:", e));
  if (config?.configurable?.traceId) { try { const lf = getClient(); if (lf) { lf.trace({ id: config.configurable.traceId }).update({ output: replyContent, metadata: { selected_tier: state.selected_tier, fc_steps_used: state.fc_super_step_count, repair_attempts: state.fc_repair_attempts, intent: state.intent } }); lf.flushAsync().catch(() => {}); } } catch {} }
  endSpan(span, { output: `msgId=${assistMsgId}`, metadata: { contentBytes: replyContent.length } });
  return { finalMessageId: assistMsgId, reply_markdown: replyContent };
};

module.exports = { humanInTheLoopGate, finalResponseStep, persistAndEmit };
