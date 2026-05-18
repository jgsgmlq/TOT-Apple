'use strict';

const { getClient, endSpan } = require('../../../utils/tracer');

const startNodeSpan = (state, name, input) => {
  const traceId = state.meta_trace_id;
  if (!traceId) return null;
  try {
    const client = getClient();
    return client ? client.span({ traceId, name, input }) : null;
  } catch { return null; }
};

module.exports = { startNodeSpan };
