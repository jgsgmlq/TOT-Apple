'use strict';

/**
 * funnel — 催办漏斗
 * 委托给原 queryConversionFunnel handler
 */

const schema = {
  type: 'function',
  function: {
    name: 'funnel',
    description: '查单任务的催办漏斗（P2→P1→P0→未完成）。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id:    { type: 'string', description: '任务 ID。' },
        dimensions: { type: 'array', items: { type: 'string' }, description: '分组维度（可选）。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 8000,
};

// 委托给原 queryConversionFunnel handler
const originalHandler = require('./tool_queryConversionFunnel').handler;

async function handler(args, regionScope) {
  return await originalHandler({
    taskId: args.task_id,
    dimensions: args.dimensions || [],
  }, regionScope);
}

module.exports = { schema, meta, handler };
