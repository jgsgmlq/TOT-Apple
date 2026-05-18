'use strict';

const { startNodeSpan } = require('../shared/spanHelper');
const { endSpan } = require('../../../utils/tracer');

const fc_Escalate = async (state) => {
  const span = startNodeSpan(state, 'FC_Escalate', { step: state.fc_super_step_count });
  endSpan(span, { output: `escalate` });
  return {
    fc_next_action: '',
  };
};

module.exports = { fc_Escalate };
