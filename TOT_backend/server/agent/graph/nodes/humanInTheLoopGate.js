'use strict';

const { AIMessage, HumanMessage, ToolMessage } = require("@langchain/core/messages");
const { interrupt } = require("@langchain/langgraph");
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const { makeToolMessage } = require('../toolCallUtils');

const humanInTheLoopGate = async (state) => {
  const span = startNodeSpan(state, 'HumanInTheLoopGate', { hitlStatus: state.hitl_status });
  const payload = state.interrupt_payload;
  console.log(`[HITL] 图执行流挂起，等待客户端发送 resume。 payload:`, payload);

  const userResponse = interrupt(payload);
  console.log(`[HITL] 已收到用户选择/确认:`, userResponse);
  const normalized = userResponse?.resumePayload || userResponse?.resume_payload || userResponse?.value || userResponse;
  const resumeType = normalized?.resume_type
    || (normalized?.selected_option_id?.startsWith('clarify_') ? 'intent_shift' : 'slot_fill');
  const isIntentShift = resumeType === 'intent_shift';
  const isCancel = resumeType === 'cancel';

  const userText = typeof normalized?.user_text === 'string' && normalized.user_text.trim()
    ? normalized.user_text.trim()
    : (typeof normalized?.value === 'string' ? normalized.value.trim() : '');

  if (isCancel) {
    endSpan(span, { output: 'cancel' });
    const cancelMsg = '已取消本次查询。如需继续，请告诉我新的问题。';
    return {
      hitl_status: 'resumed',
      interrupt_payload: null,
      hitl_resume_payload: normalized,
      pending_tool_calls: [],
      reply_markdown: cancelMsg,
      finalResponse: cancelMsg,
      fc_next_action: 'finalize',
      messages: [new AIMessage({ content: cancelMsg })]
    };
  }

  if (isIntentShift) {
    endSpan(span, { output: 'intent_shift' });
    const nextUserMessage = userText || state.userMessage;
    const cancelMessages = (state.pending_tool_calls || []).map(tc =>
      makeToolMessage(
        { id: tc.id || 'unknown', name: tc.name || 'clarify_intent' },
        { error: 'User cancelled this operation due to intent shift.' }
      )
    );
    return {
      hitl_status: 'resumed',
      interrupt_payload: null,
      hitl_resume_payload: normalized,
      userMessage: nextUserMessage,
      intent: '',
      entities: {},
      entities_confidence: {},
      candidateTools: [],
      pending_tool_calls: [],
      fc_next_action: 're_route',
      messages: [
        ...cancelMessages,
        new HumanMessage(nextUserMessage)
      ]
    };
  }

  endSpan(span, { output: resumeType });
  const messageContent = `用户确认了选项/补充了信息: ${JSON.stringify(normalized?.value ?? normalized?.selected_option_id ?? normalized)}`;
  return {
    hitl_status: 'resumed',
    interrupt_payload: null,
    hitl_resume_payload: normalized,
    fc_next_action: 'validate',
    messages: [
      new ToolMessage({
        tool_call_id: payload?.resume_token || 'unknown_token',
        name: 'clarify_intent',
        content: messageContent
      })
    ]
  };
};

module.exports = { humanInTheLoopGate };
