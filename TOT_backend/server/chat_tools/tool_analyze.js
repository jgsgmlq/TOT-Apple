'use strict';

const { db } = require('../db');
const logger = require('../utils/logger');

/**
 * analyze — 高阶统计分析
 * 原 runAnalytics，改名+精简参数
 */

const schema = {
  type: 'function',
  function: {
    name: 'analyze',
    description: '执行高阶统计分析（分位数、分布、相关性、预测）。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id', 'analysis_type'],
      properties: {
        task_id:       { type: 'string', description: '任务 ID。' },
        analysis_type: { type: 'string', enum: ['quantile', 'distribution', 'correlation', 'forecast'], description: '分析类型。quantile=分位数, distribution=分布, correlation=相关性, forecast=预测。' },
        region:        { type: 'string', description: '可选：按区域过滤。' },
        store_id:      { type: 'string', description: '可选：按门店 ID 过滤。' },
        target_time:   { type: 'string', description: '仅 forecast 生效：预测截止时间 (ISO 8601)。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 15000,
};

// 复用原 runAnalytics handler 的底层逻辑
const originalAnalytics = require('./tool_runAnalytics');

async function handler(args, regionScope) {
  // 参数映射到原始 runAnalytics 格式
  const typeMap = {
    quantile: 'quantile_duration',
    distribution: 'completion_time_distribution',
    correlation: 'metric_correlation',
    forecast: 'completion_rate_forecast',
  };
  const mappedArgs = {
    analysisType: typeMap[args.analysis_type] || args.analysis_type,
    taskId: args.task_id,
    region: args.region,
    storeId: args.store_id,
    targetTime: args.target_time,
  };
  return await originalAnalytics.handler(mappedArgs, regionScope);
}

module.exports = { schema, meta, handler };
