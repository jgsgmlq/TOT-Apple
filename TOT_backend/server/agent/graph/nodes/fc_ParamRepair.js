'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');
const { flattenEntitiesForRepair } = require('../shared/entities');

const fc_ParamRepair = async (state) => {
  const span = startNodeSpan(state, 'FC_ParamRepair', { attempts: state.fc_repair_attempts, reason: (state.repair_error_reason || '').slice(0, 200) });
  const pendingToolCalls = state.pending_tool_calls || [];
  if (pendingToolCalls.length === 0) {
    endSpan(span, { output: 'no pending calls → skip' });
    return { fc_next_action: 'validate' };
  }

  let violationsByToolCall = {};
  try {
    violationsByToolCall = JSON.parse(state.repair_error_reason || '{}');
    if (!violationsByToolCall || typeof violationsByToolCall !== 'object') {
      violationsByToolCall = {};
    }
  } catch {
    violationsByToolCall = {};
  }

  const entityMap = flattenEntitiesForRepair(state.entities);

  const repaired = pendingToolCalls.map((toolCall) => {
    const violations = Array.isArray(violationsByToolCall[toolCall.id])
      ? violationsByToolCall[toolCall.id]
      : [];
    const args = typeof toolCall.args === 'object' && toolCall.args ? { ...toolCall.args } : {};
    for (const v of violations) {
      if (!v || !v.field) continue;
      if (v.repairValue !== undefined) {
        args[v.field] = v.repairValue;
        continue;
      }
      if (v.code === 'MISSING_PARAM' && entityMap[v.field] !== undefined) {
        args[v.field] = entityMap[v.field];
        continue;
      }
    }
    return { ...toolCall, args };
  });

  endSpan(span, { output: `repaired ${repaired.length} calls` });
  return {
    pending_tool_calls: repaired,
    fc_next_action: 'validate'
  };
};

module.exports = { fc_ParamRepair };
