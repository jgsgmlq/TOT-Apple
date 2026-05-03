'use strict';

const { runAnalysis } = require('../services/chatAnalyticsService');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'runAnalytics',
      description: '执行高阶统计分析（分位数、分布、相关性等），返回结构化统计结果',
      parameters: {
        type: 'object',
        required: ['analysisType'],
        properties: {
          analysisType: {
            type: 'string',
            description:
              '统计类型：quantile_duration | completion_time_distribution | metric_correlation | progress_variance_by_channel | completion_rate_forecast | trimmed_mean_duration',
          },
          taskId: { type: 'string', description: '可选：按任务ID过滤' },
          region: { type: 'string', description: '可选：按区域过滤（如 华东）' },
          storeId: { type: 'string', description: '可选：按门店ID过滤' },
          targetTime: {
            type: 'string',
            description: '可选：预测截止时间（ISO 时间字符串，仅 completion_rate_forecast 生效）',
          },
          trimRatio: {
            type: 'number',
            description: '可选：截尾比例（0~0.2，仅 trimmed_mean_duration 生效，默认 0.05）',
          },
        },
      },
    },
  },
  meta: {
    enabled: true,
    requiredRole: ['executive'],
    scopePolicy: 'any',
    timeoutMs: 8000,
  },
  handler: async (args, regionScope) => {
    return runAnalysis(args, regionScope);
  },
};
