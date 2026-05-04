'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * rank — 排名（TopN / BottomN）
 *
 * 从 queryMetrics 中拆出的独立聚合工具。
 * FC Agent 应先调 queryMetrics 拿到完整数据，需要排名时再调本工具。
 * 或者直接调本工具（内部会先查数据再排序）。
 */

const schema = {
  type: 'function',
  function: {
    name: 'rank',
    description: '对某个维度上的指标值做 TopN 或 BottomN 排名。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id', 'metric', 'n'],
      properties: {
        task_id: {
          type: 'string',
          description: '任务 ID（如 TASK_A）。',
        },
        metric: {
          type: 'string',
          description: '按哪个指标排名。如 complete_rate, p0_warning_count。',
        },
        dimension: {
          type: 'string',
          enum: ['channel_l3', 'channel_l4', 'dealer', 'store'],
          description: '在哪个维度上排名。channel_l3=RTM L3, channel_l4=业态 L4, dealer=经销商, store=门店。',
        },
        n: {
          type: 'number',
          description: '返回前 N 名。正数=TopN（降序），负数=BottomN（升序）。如 5=前5名, -10=后10名。',
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
  const n = args.n || 5;
  const isBottomN = n < 0;
  const absN = Math.abs(n);

  const params = {
    taskId: args.task_id,
    metrics: [args.metric],
    dimensions: args.dimension ? [args.dimension] : ['all'],
    sort: { sortBy: args.metric, order: isBottomN ? 'asc' : 'desc' },
    aggregation: {
      type: isBottomN ? 'bottomn' : 'topn',
      n: Math.min(Math.max(1, absN), 1000),
      target_metric: args.metric,
    },
  };

  return await executiveMetricsQueryService.query(params, regionScope);
}

module.exports = { schema, meta, handler };
