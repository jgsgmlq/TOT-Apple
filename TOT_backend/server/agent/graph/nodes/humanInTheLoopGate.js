'use strict';

const { AIMessage, HumanMessage, ToolMessage } = require("@langchain/core/messages");
const { interrupt } = require("@langchain/langgraph");
const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient, NOOP_TRACE } = require('../../../utils/tracer');
const { makeToolMessage } = require('../toolCallUtils');

const humanInTheLoopGate = async (state) => {
  const span = startNodeSpan(state, 'HumanInTheLoopGate', { hitlStatus: state.hitl_status, reason: state.ambiguity_payload?.type || null });
  let payload = state.ambiguity_payload || state.interrupt_payload;
  console.log(`[HITL] 图执行流挂起，等待客户端发送 resume。 payload:`, payload);

  // Trace event: interrupt sent
  if (span && span !== NOOP_TRACE) {
    try { span.event({ name: 'HITL_Interrupt', input: payload?.reason, metadata: { type: payload?.type } }); } catch {}
  }

  // FC 循环内的 ask_user 中断：payload 已有 question + options，不需要补全
  const isFcClarification = payload?.type === 'fc_clarification' || payload?.source === 'fc_loop';

  // 缺任务参数时，查询任务列表作为候选（非 FC 内部中断）
  if (!isFcClarification && payload?.type === 'missing_task_ref') {
    try {
      const taskCrud = require('../../../modules/task/crud/taskCrud');
      const tasks = await taskCrud.getTaskList({ statuses: ['dispatched', 'active'] });
      if (tasks.length > 0) {
        let rates = {};
        try {
          const queryEngine = require('../../../modules/dashboard/services/queryEngine');
          const results = await Promise.allSettled(
            tasks.slice(0, 8).map(t => queryEngine.getOverviewBoardData({ taskId: t.task_publish_id }).catch(() => null))
          );
          results.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) rates[tasks[i].task_publish_id] = r.value.completionRate; });
        } catch (_) {}

        payload = {
          ...payload,
          prompt: payload.question || '请问要查询哪个任务？',
          options: tasks.slice(0, 8).map(t => ({
            id: t.task_publish_id,
            label: t.task_title,
            value: t.task_publish_id,
            subtitle: `${t.urgency_level || ''} · 截止 ${t.due_date ? new Date(t.due_date).toISOString().slice(0,10) : '--'}`,
            completionRate: rates[t.task_publish_id] ?? null,
            platform: (() => { try { return JSON.parse(t.platform_scope || '[]')[0] || null; } catch (_) { return null; } })(),
          })),
          resume_type: 'slot_fill',
        };
        console.log(`[HITL] 已补全任务候选列表，共 ${payload.options.length} 个任务`);
      }
    } catch (err) {
      console.error('[HITL] 查询任务候选失败:', err.message);
    }
  }

  const userResponse = interrupt(payload);
  console.log(`[HITL] 已收到用户选择/确认:`, userResponse);

  // Trace event: resume received
  if (span && span !== NOOP_TRACE) {
    try { span.event({ name: 'HITL_Resume', input: JSON.stringify(userResponse).slice(0, 200) }); } catch {}
  }
  const normalized = userResponse?.resumePayload || userResponse?.resume_payload || userResponse?.value || userResponse;
  const resumeType = normalized?.resume_type
    || normalized?.type
    || (normalized?.selected_option_id?.startsWith('clarify_') ? 'intent_shift' : 'slot_fill');
  const isIntentShift = resumeType === 'intent_shift';
  const isCancel = resumeType === 'cancel';

  const userText = typeof normalized?.user_text === 'string' && normalized.user_text.trim()
    ? normalized.user_text.trim()
    : (typeof normalized?.value === 'string' ? normalized.value.trim() : '');

  // FC 循环内 HITL：resume 后把用户回答注入 FC 循环继续
  if (isFcClarification) {
    if (isCancel) {
      endSpan(span, { output: 'fc_hitl_cancel' });
      return {
        hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized,
        pending_tool_calls: [], fc_next_action: 'finalize',
        messages: [new AIMessage({ content: '用户取消了本次澄清。请根据已有数据直接总结回答。' })]
      };
    }
    endSpan(span, { output: 'fc_hitl_continue' });
    const selectedText = typeof normalized?.value === 'string' && normalized.value.trim()
      ? normalized.value.trim()
      : (normalized?.selected_option_id || JSON.stringify(normalized));
    const replyMsg = `用户回复: ${selectedText}。请基于这个信息继续刚才的工具调用，完成用户最初的问题。`;
    return {
      hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized,
      fc_next_action: '', // 由 fc_CheckSteps 递增 step 后继续
      messages: [new HumanMessage(replyMsg)]
    };
  }

  if (isCancel) {
    endSpan(span, { output: 'cancel' });
    const cancelMsg = '已取消本次查询。如需继续，请告诉我新的问题。';
    return {
      hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized,
      pending_tool_calls: [], reply_markdown: cancelMsg, finalResponse: cancelMsg,
      fc_next_action: 'finalize', messages: [new AIMessage({ content: cancelMsg })]
    };
  }

  if (isIntentShift) {
    endSpan(span, { output: 'intent_shift' });
    const nextUserMessage = userText || state.userMessage;
    const cancelMessages = (state.pending_tool_calls || []).map(tc =>
      makeToolMessage({ id: tc.id || 'unknown', name: tc.name || 'clarify_intent' }, JSON.stringify({ error: 'User cancelled this operation due to intent shift.' }))
    );
    return {
      hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized,
      userMessage: nextUserMessage, intent: '', entities: {}, entities_confidence: {},
      candidateTools: [], pending_tool_calls: [], fc_next_action: 're_route',
      messages: [...cancelMessages, new HumanMessage(nextUserMessage)]
    };
  }

  endSpan(span, { output: resumeType });

  // 提取用户选择的参数值（slot_fill）
  const selectedValue = normalized?.value ?? normalized?.selected_option_id ?? normalized;
  const selectedLabel = typeof normalized?.label === 'string' ? normalized.label : (selectedValue?.label || '');

  const messageContent = selectedLabel
    ? `用户已选择任务: ${selectedLabel} (task_id: ${selectedValue?.value || selectedValue?.id || selectedValue})。请立即用这个 task_id 重新调用之前失败的工具，继续完成用户最初的问题。`
    : `用户补充了信息: ${JSON.stringify(selectedValue)}。请用这些参数重新调用工具，继续完成用户最初的问题。`;

  // 用 HumanMessage 而非 ToolMessage：HITL 路径未经过 FC 循环，无 tool_calls 历史，ToolMessage 会导致 API 400 错误
  return {
    hitl_status: 'resumed', interrupt_payload: null, hitl_resume_payload: normalized,
    fc_next_action: 'validate', userMessage: messageContent,
    messages: [new HumanMessage(messageContent)]
  };
};

module.exports = { humanInTheLoopGate };
