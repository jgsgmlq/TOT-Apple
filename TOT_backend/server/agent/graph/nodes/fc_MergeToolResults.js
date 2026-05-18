'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const { getLastAiToolCalls, buildToolSignature, safeJsonContent, makeToolMessage } = require('../toolCallUtils');
const chatSessionStateService = require('../../../services/chatSessionStateService');
const chatToolsService = require('../../../services/chatToolsService');

const computeToolCallSignature = buildToolSignature;

const isErrorPayload = (data) => {
  if (typeof data !== 'string') return false;
  try {
    const parsed = JSON.parse(data);
    return Boolean(parsed && parsed.error && parsed.error.code);
  } catch {
    return false;
  }
};

const fc_MergeToolResults = async (state) => {
  const span = startNodeSpan(state, 'FC_MergeToolResults', { toolResultKeys: Object.keys(state.toolResults || {}) });

  let anchor = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m && m._getType && m._getType() === 'ai' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      anchor = m;
      break;
    }
  }
  if (!anchor) return { fc_next_action: '' };

  const anchorIdx = state.messages.lastIndexOf(anchor);
  const alreadyEmitted = new Set();
  for (let i = anchorIdx + 1; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m && m._getType && m._getType() === 'tool' && m.tool_call_id) {
      alreadyEmitted.add(m.tool_call_id);
    }
  }

  const newMessages = [];
  const scopeFp = chatSessionStateService.buildScopeFingerprint(state.regionScope);
  let fallbackBump = 0;

  for (const toolCall of anchor.tool_calls) {
    if (alreadyEmitted.has(toolCall.id)) continue;

    let resultObj = state.toolResults?.[toolCall.id];
    if (resultObj && resultObj.alias_of && !resultObj.data) {
      const sibling = state.toolResults?.[resultObj.alias_of];
      if (sibling?.data) {
        resultObj = { signature: resultObj.signature, data: sibling.data, error: !!sibling.error };
      }
    }

    let resultData = resultObj?.data;
    let isError = !!resultObj?.error;
    if (!resultData) {
      resultData = JSON.stringify({ error: { code: 'NO_TOOL_RESULT', message: 'No data returned' } });
      isError = true;
      fallbackBump += 1;
    } else if (!isError && isErrorPayload(resultData)) {
      isError = true;
    }

    newMessages.push(makeToolMessage(toolCall, resultData));

    if (resultObj && !resultObj.signature && !isError) {
      const freshnessBucketMs = chatToolsService.getToolFreshnessBucketMs(toolCall.name);
      const signature = computeToolCallSignature(toolCall.name, toolCall.args, scopeFp, { bucketMs: freshnessBucketMs });
      chatSessionStateService.addRecord(state.sessionId, { signature, data: resultData }, state.regionScope);
    }
  }

  const updates = { messages: newMessages, pending_tool_calls: [], fc_next_action: '' };
  if (fallbackBump > 0) {
    updates.meta_fallback_count = (state.meta_fallback_count || 0) + fallbackBump;
  }
  endSpan(span, { output: `${newMessages.length} messages merged` });
  return updates;
};

module.exports = { fc_MergeToolResults };
