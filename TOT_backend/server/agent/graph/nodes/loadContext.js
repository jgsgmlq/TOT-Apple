'use strict';

const { HumanMessage } = require("@langchain/core/messages");
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const chatMemoryService = require('../../../services/chatMemoryService');
const chatCrud = require('../../../modules/dashboard/crud/chatCrud');
const trace = require('../shared/runTrace');

function buildConversation(rows) {
  if (!rows || rows.length === 0) return [];

  const turns = [];
  let currentTurn = { turn: 0, user: null, assistant: null };
  let turnSeq = 0;

  for (const row of rows) {
    if (row.role === 'user') {
      turnSeq += 1;
      if (currentTurn.user && currentTurn.assistant) {
        turns.push({ turn: currentTurn.turn, user: currentTurn.user, assistant: currentTurn.assistant });
      }
      currentTurn = { turn: turnSeq, user: row, assistant: null };
    } else if (row.role === 'assistant' && currentTurn.user) {
      currentTurn.assistant = row;
    }
  }
  if (currentTurn.user && currentTurn.assistant) {
    turns.push({ turn: currentTurn.turn, user: currentTurn.user, assistant: currentTurn.assistant });
  }

  const recent = turns.slice(-5);
  const conversation = [];
  for (const t of recent) {
    conversation.push({
      role: 'user',
      content: t.user.content_text || '',
      turn: t.turn,
    });

    let narrative = t.assistant.content_text || '';
    let provenance = null;

    if (t.assistant.content_json) {
      try {
        const cj = JSON.parse(t.assistant.content_json);
        if (cj._contentText && typeof cj._contentText === 'string') {
          narrative = cj._contentText;
        }
        if (cj._provenance) {
          provenance = cj._provenance;
        }
      } catch (_) {}
    }

    conversation.push({
      role: 'assistant',
      content: narrative,
      provenance,
      turn: t.turn,
    });
  }
  return conversation;
}

const loadContext = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  trace.nodeEnter(emitter, state, 'LoadContext');
  const span = startNodeSpan(state, 'LoadContext', { userId: state.userId });

  let conversation = [];
  try {
    const rows = await chatCrud.getMessages(state.sessionId, 30);
    conversation = buildConversation(rows);
    console.log(`[LoadContext] 加载 ${conversation.length / 2} 轮对话`);
  } catch (err) {
    console.error("[LoadContext] 对话历史加载失败:", err.message);
  }

  let longTermText = '';
  try {
    longTermText = await chatMemoryService.getMemories(state.userId);
    if (longTermText) console.log(`[LoadContext] 加载长期记忆`);
  } catch (err) {
    console.error("[LoadContext] 长期记忆加载失败:", err.message);
  }

  endSpan(span, { output: `conversation=${conversation.length} longTerm=${longTermText ? 'yes' : 'none'}` });
  trace.nodeExit(emitter, state, 'LoadContext', {
    conversationTurns: conversation.length / 2,
    hasLongTerm: !!longTermText,
  });

  return {
    conversation,
    long_term_memories: longTermText,
    messages: [new HumanMessage(state.userMessage || '')],
  };
};

module.exports = { loadContext, buildConversation };
