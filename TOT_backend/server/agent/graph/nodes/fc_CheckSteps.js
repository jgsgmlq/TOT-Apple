'use strict';

const { startNodeSpan } = require("../shared/spanHelper");
const { endSpan } = require("../../../utils/tracer");

const fc_CheckSteps = async (state) => {
  // FC 内 HITL 恢复后不递增步数（ask_user 不消耗 FC 轮次）
  const fromHitl = !!state.hitl_resume_payload;
  const nextStep = fromHitl ? state.fc_super_step_count : (state.fc_super_step_count || 0) + 1;
  const span = startNodeSpan(state, 'FC_CheckSteps', { step: nextStep, fromHitl });
  endSpan(span, { output: `step ${nextStep}` });
  return {
    fc_super_step_count: nextStep,
    fc_next_action: '',
  };
};

module.exports = { fc_CheckSteps };
