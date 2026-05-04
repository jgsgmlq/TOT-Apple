'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * distribution — 指标值分布统计
 */

const schema = {
  type: 'function',
  function: {
    name: 'distribution',
    description: '对某个指标按区间统计分布。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id', 'metric', 'bins'],
      properties: {
        task_id: {
          type: 'string',
          description: '任务 ID（如 TASK_A）。',
        },
        metric: {
          type: 'string',
          description: '要统计分布的指标名。如 complete_rate, avg_duration_sec。',
        },
        bins: {
          type: 'array',
          items: { type: 'number' },
          description: '分桶区间边界值。如 [0, 20, 40, 60, 80, 100] 表示 0-20, 20-40, ..., 80-100 六个桶。',
        },
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

async function handler(args, regionScope) {
  const params = {
    taskId: args.task_id,
    metrics: [args.metric],
    dimensions: ['all'],
    aggregation: {
      type: 'distribution',
      bins: args.bins,
      target_metric: args.metric,
    },
  };

  return await executiveMetricsQueryService.query(params, regionScope);
}

module.exports = { schema, meta, handler };
