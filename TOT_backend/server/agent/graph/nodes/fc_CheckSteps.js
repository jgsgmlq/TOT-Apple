'use strict';

const { startNodeSpan } = require("../shared/spanHelper");
const { endSpan } = require("../../../utils/tracer");

const fc_CheckSteps = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckSteps', { step: (state.fc_super_step_count || 0) + 1 });
  const nextStep = (state.fc_super_step_count || 0) + 1;
  endSpan(span, { output: `step ${nextStep}` });
  return {
    fc_super_step_count: nextStep,
    fc_next_action: '',
  };
};

module.exports = { fc_CheckSteps };
