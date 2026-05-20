'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'query_trend',
      description: '查询某任务指标的时间序列。当用户问"每天怎么变""趋势"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'mode'],
        properties: {
          task_id: { type: 'string', description: '任务标识' },
          mode: { type: 'string', enum: ['completion', 'learning'], description: 'completion 返回完成率趋势，learning 返回学习率趋势' },
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
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    const qType = args.mode === 'completion' ? 'daily' : 'daily';
    const trendData = await queryEngine.getTrendBoardData({ taskId, type: qType });

    return {
      success: true,
      data: {
        task_id: taskId,
        mode: args.mode,
        granularity: args.granularity || 'day',
        timeline: Array.isArray(trendData) ? trendData : (trendData?.trendData || [])
      }
    };
  }
};
