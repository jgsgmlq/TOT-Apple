'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');
const mysqlCrud = require('../modules/dashboard/crud/dashboardMysqlCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'query_trend',
      description: '查询某任务指标的时间序列。当用户问每天怎么变/趋势/最近趋势/完成率变化时使用。mode:"completion"查完成率趋势，mode:"learning"查学习率趋势。',
      parameters: {
        type: 'object',
        required: ['task_id', 'mode'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          mode: { type: 'string', enum: ['completion', 'learning'], description: 'completion 完成率趋势，learning 学习率趋势' },
          granularity: { type: 'string', enum: ['day', 'week'], description: '粒度，默认 day' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 10000
  },
  handler: async (args, regionScope) => {
    const rawId = (args.task_id || '').trim();
    if (!rawId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const taskId = rawId;

    const trendData = await queryEngine.getTrendBoardData({ taskId, type: 'daily' });
    return {
      success: true,
      data: {
        task_id: taskId, mode: args.mode,
        granularity: args.granularity || 'day',
        timeline: Array.isArray(trendData) ? trendData : (trendData?.trendData || [])
      }
    };
  }
};
