'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const { getLastAiToolCalls, buildToolSignature } = require('../toolCallUtils');
const chatToolsService = require('../../../services/chatToolsService');
const chatSessionStateService = require('../../../services/chatSessionStateService');

const fc_CheckDuplicate = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckDuplicate', {});
  const { toolCalls } = getLastAiToolCalls(state);
  if (toolCalls.length === 0) {
    return { fc_next_action: 'finalize' };
  }

  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  const pendingToolCalls = [];
  const toolResults = {};
  const sigToToolCallId = new Map();

  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    const freshnessBucketMs = chatToolsService.getToolFreshnessBucketMs(toolName);
    const signature = buildToolSignature(toolName, toolCall.args, scopeFp, { bucketMs: freshnessBucketMs });

    const dupId = sigToToolCallId.get(signature);
    if (dupId) {
      console.log(`[CheckDuplicate] 同 batch 重复 tool_call: ${toolName} (复用 ${dupId})`);
      toolResults[toolCall.id] = { signature, data: null, alias_of: dupId };
      continue;
    }
    sigToToolCallId.set(signature, toolCall.id);

    const existingResult = Object.values(state.toolResults || {}).find(r => r && r.signature === signature && r.data);
    if (existingResult) {
      console.log(`[CheckDuplicate] 命中同图缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: existingResult.data };
      continue;
    }

    const sessionCached = chatSessionStateService.getLatestBySignature(state.sessionId, signature, state.regionScope);
    if (sessionCached) {
      console.log(`[CheckDuplicate] 命中 Session 缓存: ${toolName}`);
      toolResults[toolCall.id] = { signature, data: sessionCached.data };
      continue;
    }

    pendingToolCalls.push(toolCall);
  }

  if (pendingToolCalls.length === 0) {
    endSpan(span, { output: 'all deduped → merge' });
    return { toolResults, fc_next_action: 'merge' };
  }

  endSpan(span, { output: `${pendingToolCalls.length} new calls → validate` });
  return {
    toolResults,
    pending_tool_calls: pendingToolCalls,
    fc_next_action: 'validate'
  };
};

module.exports = { fc_CheckDuplicate };
