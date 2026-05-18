'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan, getClient, endGeneration, maskPII, preview, NOOP_TRACE } = require('../../../utils/tracer');
const chatToolsService = require('../../../services/chatToolsService');
const chatSessionStateService = require('../../../services/chatSessionStateService');
const { makeToolMessage } = require('../toolCallUtils');

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

  const toolResults = {};
  const calledTools = [];
  let denyShortCircuit = null;

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

    let toolSpan = null;
    if (traceId) {
      try {
        const lf = getClient();
        toolSpan = lf ? lf.span({ traceId, name: `Tool_${internalToolName}` }) : null;
      } catch { toolSpan = null; }
    }

    let finalResult;
    let inspect;
    try {
      const rawResult = await chatToolsService.executeByName(internalToolName, toolCall.args, state.regionScope);
      inspect = inspectToolResult(rawResult);
      finalResult = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      endSpan(toolSpan, {
        output: maskPII(preview(finalResult, 500)),
        metadata: { status: inspect.ok ? 'success' : 'error', errorCode: inspect.errorCode || undefined, toolCallId: toolCall.id },
      });
    } catch (err) {
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
    };
    calledTools.push(internalToolName);

    if (!inspect.ok && inspect.errorCode === 'PERMISSION_DENIED') {
      denyShortCircuit = { toolCallId: toolCall.id, errorCode: inspect.errorCode };
    }
  }

  return { toolResults, calledTools, fc_next_action: 'merge' };
};

module.exports = { fc_ExecuteTool, inspectToolResult };
