'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * queryMetrics — 按 task_id 查指标矩阵（主力聚合查询）
 *
 * 设计原则：
 * - 参数全部扁平，无嵌套依赖
 * - task_id 必填（先通过 searchEntities 拿到 ID）
 * - 不含 aggregation（排名用 rank 工具，分布用 distribution 工具）
 * - 替代 queryExecutiveMetrics + getOverviewData
 */

const schema = {
  type: 'function',
  function: {
    name: 'queryMetrics',
    description: '按 task_id 查询指标矩阵。支持完成率/预警率/转化率等 19 个指标，可按 RTM/业态/经销商/门店分组，支持排序。task_id 必填——先用 searchEntities 拿到精确 ID。',
    parameters: {
      type: 'object',
      required: ['task_id', 'metrics'],
      properties: {
        task_id: {
          type: 'string',
          description: '任务 ID（如 TASK_A），由 searchEntities 返回。必填。',
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: '指标列表。可选: total_count, reach_count, reach_rate, complete_count, complete_rate, incomplete_count, incomplete_rate, avg_duration_sec, p0_warning_count, p0_warning_rate, p1_warning_count, p1_warning_rate, p2_warning_count, p2_warning_rate, p0_conversion_count, p0_conversion_rate, p1_conversion_count, p1_conversion_rate, p2_conversion_count, p2_conversion_rate',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: ['all', 'channel_l3', 'channel_l4', 'dealer', 'store'] },
          description: '分组维度。空数组或 ["all"] = 全量汇总。channel_l3=RTM L3(Monobrand/Multibrand/Carrier), channel_l4=业态 L4(MONO/Lifestyle/Mass Merchant), dealer=经销商, store=门店。',
        },
        time_start: { type: 'string', description: '时间范围起点 (ISO 8601)，可选。' },
        time_end:   { type: 'string', description: '时间范围终点 (ISO 8601)，可选。' },
        time_field: { type: 'string', enum: ['reach_time', 'complete_time', 'received_at', 'completed_at', 'started_at', 'created_at'], description: '时间过滤字段。默认 reach_time。' },
        sort_by:    { type: 'string', description: '排序字段（指标名）。' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: '升序 asc 或降序 desc。' },
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
  // 参数映射到 executiveMetricsQueryService.query() 的格式
  const params = {
    taskId: args.task_id,
    metrics: args.metrics,
    dimensions: args.dimensions || ['all'],
  };

  if (args.time_start || args.time_end) {
    params.filters = {
      time: {
        start: args.time_start,
        end: args.time_end,
        field: args.time_field || 'reach_time',
      },
    };
  }

  if (args.sort_by) {
    params.sort = { sortBy: args.sort_by, order: args.sort_order || 'desc' };
  }

  return await executiveMetricsQueryService.query(params, regionScope);
}

module.exports = { schema, meta, handler };
