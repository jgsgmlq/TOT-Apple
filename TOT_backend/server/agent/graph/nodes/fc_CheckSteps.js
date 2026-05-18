'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');

const fc_CheckSteps = async (state) => {
  const span = startNodeSpan(state, 'FC_CheckSteps', { step: (state.fc_super_step_count || 0) + 1, tier: state.selected_tier });
  endSpan(span, { output: `step ${(state.fc_super_step_count || 0) + 1}` });
  return {
    fc_super_step_count: (state.fc_super_step_count || 0) + 1,
    fc_next_action: '',
  };
};

module.exports = { fc_CheckSteps };
