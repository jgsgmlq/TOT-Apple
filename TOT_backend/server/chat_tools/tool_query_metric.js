'use strict';

const executiveMetricsService = require('../modules/dashboard/services/executiveMetricsService');
const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'query_metric',
      description: '按维度查询指标值，支持 Top/Bottom N 排序。当用户问排名、对比、按维度下钻时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'metrics'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          metrics: { type: 'array', items: { type: 'string' }, description: '指标名称: completion_rate, learning_rate, delivered_rate, total_count, completed_count, uncompleted_count, p0_count, p1_count, p2_count, p0_rate, p1_rate, p2_rate, avg_duration' },
          dimension: { type: 'string', enum: ['hq', 'l3', 'l4', 'dealer', 'store', 'alert_level'], description: '分组维度，不传则只返回总计' },
          dimension_value: { type: 'string', description: '维度具体值，不传则返回该维度下所有分类' },
          scope_filter: { type: 'object', description: '限定排名范围，如 {l3: "华东大区"}' },
          sort_by: { type: 'string', description: '排序指标，默认按第一个 metrics 降序' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], description: '排序方向' },
          top_n: { type: 'integer', description: '返回 Top/Bottom N 条，不传 dimension_value 时默认 50' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 15000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    let taskName = taskId;

    const params = {
      taskName,
      metrics: args.metrics || [],
      dimensions: args.dimension ? [args.dimension] : [],
      filters: args.scope_filter || {},
      sort: args.sort_by ? { sortBy: args.sort_by, order: args.sort_order || 'desc' } : undefined
    };

    if (args.dimension_value) {
      params.filters[args.dimension] = args.dimension_value;
    }

    const result = await executiveMetricsService.query(params, regionScope);

    if (result.error) {
      return { success: false, errorCode: 'QUERY_ERROR', message: result.message || result.error };
    }

    let rows = result.rows || [];
    if (args.top_n && rows.length > args.top_n) {
      rows = rows.slice(0, args.top_n);
    }

    // dimensions/metrics 是新版structured格式，task_name/platform/priority 保持向后兼容
    return {
      success: true,
      data: {
        task_id: result.taskId || taskId,
        task_name: result.taskName || args.task_id,
        platform: result.platform || null,
        priority: result.priority || null,
        dimension: args.dimension,
        dimensions: result.dimensions,
        metrics: result.metrics,
        rows,
        summary: result.summary || null
      }
    };
  }
};
