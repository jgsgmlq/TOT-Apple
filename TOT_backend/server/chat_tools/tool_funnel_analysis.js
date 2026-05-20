'use strict';

const queryEngine = require('../modules/dashboard/services/queryEngine');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'funnel_analysis',
      description: '查询任务完成漏斗或预警催办漏斗。当用户问"各阶段流失""转化率"时使用。',
      parameters: {
        type: 'object',
        required: ['task_id', 'funnel_type'],
        properties: {
          task_id: { type: 'string', description: '任务标识（名称模糊匹配或 ID 精确匹配）' },
          funnel_type: { type: 'string', enum: ['completion', 'alert'], description: 'completion 任务完成漏斗，alert 预警催办漏斗' },
          dimension: { type: 'string', enum: ['hq', 'l3', 'l4', 'dealer', 'store'], description: '按维度拆分，不传返回整体' },
          dimension_value: { type: 'string', description: '特定维度值' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'regional_scoped',
    timeoutMs: 12000
  },
  handler: async (args, regionScope) => {
    const taskId = (args.task_id || '').trim();
    if (!taskId) {
      return { success: false, errorCode: 'MISSING_PARAM', message: '参数 task_id 是必填的' };
    }

    if (args.funnel_type === 'completion') {
      const funnelData = await queryEngine.getFunnelData({ taskId });
      return { success: true, data: { funnel_type: 'completion', ...(funnelData || {}) } };
    }

    const alertFunnel = await queryEngine.getAlertFunnelData({ taskId });
    return { success: true, data: { funnel_type: 'alert', ...(alertFunnel || {}) } };
  }
};
