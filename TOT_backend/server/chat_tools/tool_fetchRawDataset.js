'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * tool_fetchRawDataset.js (v4.0)
 * 为 Code Interpreter 提供脱敏的原始数据集。
 */

const schema = {
  type: 'function',
  function: {
    name: 'fetchRawDataset',
    description: '获取用于高阶分析的原始脱敏数据集（CSV 格式）。包含员工 ID、所属大区、完成时间、分数等。',
    parameters: {
      type: 'object',
      properties: {
        taskName: { type: 'string', description: '任务关键词' },
        filters: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            rtm: { type: 'string' }
          }
        }
      }
    }
  }
};

const meta = {
  enabled: false,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 5000
};

async function handler(args, regionScope) {
  // 这里直接复用现有的 queryService，但要求它返回原始行
  // 实际生产中应专门优化一个导出原始行的接口
  try {
    const params = {
      ...args,
      dimensions: ['all'], // 强制全量
      metrics: ['completion_rate', 'avg_completion_time_hours'] // 示例度量
    };
    const result = await executiveMetricsQueryService.query(params, regionScope);
    
    if (result.error) return result;

    // 模拟转换为 CSV
    const header = "store_id,region,completion_rate,avg_time\n";
    const csv = result.rows.map(r => `${r.dimensions.store || 'ALL'},${r.dimensions.channel_l3 || 'ALL'},${r.completion_rate},${r.avg_completion_time_hours}`).join('\n');

    return {
      success: true,
      csv: header + csv,
      rowCount: result.rows.length
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { schema, meta, handler };
