'use strict';

/**
 * timeseries — 按时间粒度看指标趋势
 * 委托给原 queryMetricsTimeseries handler
 */

const schema = {
  type: 'function',
  function: {
    name: 'timeseries',
    description: '按时间粒度（hour/day/week/month）看指标随时间变化。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id', 'metrics', 'granularity'],
      properties: {
        task_id:     { type: 'string', description: '任务 ID（如 TASK_A）。' },
        metrics:     { type: 'array', items: { type: 'string' }, description: '指标列表（推荐用 count 型指标）。' },
        granularity: { type: 'string', enum: ['hour', 'day', 'week', 'month'], description: '时间粒度。' },
        time_start:  { type: 'string', description: '时间范围起点 (ISO 8601)。' },
        time_end:    { type: 'string', description: '时间范围终点 (ISO 8601)。' },
        group_by:    { type: 'string', enum: ['channel_l3', 'channel_l4', 'dealer', 'store'], description: '每个时间桶内再按维度分组。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 10000,
};

// 委托给原 queryMetricsTimeseries handler
const originalHandler = require('./tool_queryMetricsTimeseries').handler;

async function handler(args, regionScope) {
  return await originalHandler({
    taskId: args.task_id,
    metrics: args.metrics,
    granularity: args.granularity,
    time: (args.time_start || args.time_end) ? { start: args.time_start, end: args.time_end } : undefined,
    group_by: args.group_by,
  }, regionScope);
}

module.exports = { schema, meta, handler };
