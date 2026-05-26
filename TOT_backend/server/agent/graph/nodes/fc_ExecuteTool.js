'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient, endGeneration, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const chatToolsService = require('../../../services/chatToolsService');
const chatSessionStateService = require('../../../services/chatSessionStateService');
const { makeToolMessage } = require('../toolCallUtils');
const trace = require('../shared/runTrace');
const { logAgentTrace } = require('../shared/agentTraceLog');

const inspectToolResult = (rawResult) => {
  if (rawResult && typeof rawResult === 'object') {
    if (rawResult.error && typeof rawResult.error === 'object') {
      return {
        ok: false,
        errorCode: rawResult.error.code || 'EXECUTION_ERROR',
        errorMessage: rawResult.error.message || '工具执行失败',
      };
    }
    if (rawResult.success === false) {
      return {
        ok: false,
        errorCode: rawResult.errorCode || 'EXECUTION_ERROR',
        errorMessage: rawResult.message || '工具执行失败',
      };
    }
  }
  return { ok: true, errorCode: null, errorMessage: null };
};

const fc_ExecuteTool = async (state, config) => {
  const emitter = config?.configurable?.sseEmitter;
  const traceId = config?.configurable?.traceId;
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) return { fc_next_action: 'merge' };

  // ask_user 工具 → 中断 FC 循环，走 HITL
  const askUserCall = pendingToolCalls.find(tc => {
    const n = chatToolsService.normalizeToolName(tc?.name || '');
    return n === 'ask_user';
  });
  if (askUserCall) {
    const args = askUserCall.args || {};
    console.log(`[fc_ExecuteTool] ask_user: ${args.question?.slice(0, 80)}`);
    return {
      fc_next_action: 'hitl',
      hitl_status: 'pending_interrupt',
      interrupt_payload: {
        type: 'fc_clarification',
        question: args.question || '请补充更多信息',
        candidates: [],
        options: Array.isArray(args.options) ? args.options : [],
        source: 'fc_loop',
      },
      // 将 ask_user 的 tool_call 结果也写入，方便 merge
      toolResults: { [askUserCall.id]: { data: JSON.stringify({ asked: true }), signature: null } },
      pending_tool_calls: [],
    };
  }

  const toolResults = {};
  const calledTools = [];
  let denyShortCircuit = null;

  trace.nodeEnter(emitter, state, 'fc_ExecuteTool', { tools: pendingToolCalls.map(tc => chatToolsService.normalizeToolName(tc.name)) });

  for (const toolCall of pendingToolCalls) {
    const toolName = chatToolsService.normalizeToolName(toolCall.name);
    const internalToolName = toolName.startsWith(`${state.tool_namespace}.`)
      ? toolName.replace(`${state.tool_namespace}.`, '')
      : toolName;

    if (denyShortCircuit) {
      const skipResult = JSON.stringify({
        error: {
          code: 'SKIPPED_AFTER_DENY',
          message: `因前序工具被拒绝（${denyShortCircuit.errorCode}），本工具未执行。`,
          blockedBy: denyShortCircuit.toolCallId,
        },
      });
      toolResults[toolCall.id] = { data: skipResult, signature: null, error: true };
      if (emitter && typeof emitter.handleToolStart === 'function') {
        emitter.handleToolStart({ name: internalToolName, status: 'skipped' });
      }
      if (emitter && typeof emitter.handleToolEnd === 'function') {
        emitter.handleToolEnd(skipResult, { status: 'skipped' });
      }
      continue;
    }

    if (emitter && typeof emitter.handleToolStart === 'function') {
      emitter.handleToolStart({ name: internalToolName });
    }

    trace.toolCall(emitter, state, internalToolName, toolCall.args);

    let toolSpan = null;
    if (traceId) {
      try {
        const lf = getClient();
        toolSpan = lf ? lf.span({ traceId, name: `Tool_${internalToolName}` }) : null;
      } catch { toolSpan = null; }
    }

    let finalResult;
    let inspect;
    let executedAt;
    try {
      const rawResult = await chatToolsService.executeByName(internalToolName, toolCall.args, state.regionScope);
      executedAt = rawResult?._meta?.executedAt || new Date().toISOString();
      inspect = inspectToolResult(rawResult);
      finalResult = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      trace.toolResult(emitter, state, internalToolName, trace.summarizeToolResult(typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult));
      endSpan(toolSpan, {
        output: maskPII(preview(finalResult, 500)),
        metadata: { status: inspect.ok ? 'success' : 'error', errorCode: inspect.errorCode || undefined, toolCallId: toolCall.id },
      });
    } catch (err) {
      executedAt = new Date().toISOString();
      inspect = { ok: false, errorCode: 'EXECUTION_ERROR', errorMessage: err.message || '内部工具执行异常' };
      finalResult = JSON.stringify({ error: { code: 'EXECUTION_ERROR', message: inspect.errorMessage } });
      endSpan(toolSpan, {
        output: maskPII(preview(finalResult, 500)),
        level: 'ERROR',
        statusMessage: err.message,
        metadata: { status: 'error', toolCallId: toolCall.id, errorCode: err.code || 'EXECUTION_ERROR' },
      });
    }

    if (emitter && typeof emitter.handleToolEnd === 'function') {
      emitter.handleToolEnd(finalResult, {
        status: inspect.ok ? 'success' : 'error',
        errorCode: inspect.errorCode || undefined,
      });
    }

    toolResults[toolCall.id] = {
      data: finalResult,
      signature: null,
      error: !inspect.ok,
      errorCode: inspect.errorCode || null,
      executedAt,
    };
    calledTools.push(internalToolName);

    logAgentTrace(state.sessionId, {
      step: 'tool_execute',
      tool: internalToolName,
      args: toolCall.args,
      ok: inspect.ok,
      resultPreview: (typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult)).slice(0, 300),
    });

    if (!inspect.ok && inspect.errorCode === 'PERMISSION_DENIED') {
      denyShortCircuit = { toolCallId: toolCall.id, errorCode: inspect.errorCode };
    }
  }

  trace.nodeExit(emitter, state, 'fc_ExecuteTool', { executed: calledTools.length, tools: calledTools });
  return { toolResults, calledTools, fc_next_action: 'merge' };
};

module.exports = { fc_ExecuteTool, inspectToolResult };
