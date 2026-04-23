'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * tool_queryExecutiveMetrics.js (v3.0)
 * 矩阵查询工具：支持多维聚合、多度量选择、多维度过滤与排序。
 */

const schema = {
  type: 'function',
  function: {
    name: 'queryExecutiveMetrics',
    description: '执行高管度量查询。当需要查询完成率、预警率、耗时等指标，且涉及大区/业态/经销商/门店对比或排序时，优先使用此工具。支持模糊匹配任务或产品。',
    parameters: {
      type: 'object',
      properties: {
        dimensions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['channel_l3', 'channel_l4', 'dealer', 'store'],
            description: '维度。channel_l3=大区, channel_l4=业态/Format, dealer=经销商, store=门店'
          },
          description: '聚合维度。传空或 ["all"] 表示全量汇总。'
        },
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'completion_rate', 
              'completed_count', 
              'total_count', 
              'avg_completion_time_hours', 
              'read_rate',
              'start_delay_rate', 
              'crisis_p0_rate', 
              'crisis_p1_rate',
              'crisis_p0_count',
              'crisis_p1_count'
            ]
          },
          description: '度量指标列表。'
        },
        taskName: {
          type: 'string',
          description: '培训任务标题的关键词（如“iPhone新品”）。与 productName 二选一。'
        },
        productName: {
          type: 'string',
          description: '关联的 MyPAL 产品名。与 taskName 二选一。'
        },
        filters: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '大区名，如“华东”' },
            rtm: { type: 'string', description: '渠道名，如“Carrier”, “Monobrand”, “Multibrand”, “Education”' },
            format: { type: 'string', description: '业态名，如“MONO”, “Mass Merchant”, “Lifestyle”, “Campus”' },
            dealerName: { type: 'string', description: '经销商名' },
            storeId: { type: 'string', description: '门店 ID' }
          },
          description: '过滤条件。'
        },
        sort: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', description: '排序度量名' },
            order: { type: 'string', enum: ['asc', 'desc'], description: '顺序' }
          },
          description: '排序设置。'
        }
      },
      required: ['metrics']
    }
  }
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 8000
};

/**
 * Handler
 */
async function handler(args, regionScope) {
  try {
    const result = await executiveMetricsQueryService.query(args, regionScope);
    
    if (result.error) {
      return {
        success: false,
        errorCode: result.error,
        message: result.message || `执行失败: ${result.error}`,
        appliedParams: args
      };
    }

    return {
      success: true,
      data: result.rows,
      summary: {
        taskId: result.taskId,
        dimensions: result.dimensions,
        metrics: result.metrics,
        rowCount: result.rows.length
      },
      dataSource: 'aggregated_matrix',
      appliedParams: result.appliedParams || args
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `矩阵查询执行发生系统异常: ${err.message}`,
      appliedParams: args
    };
  }
}

module.exports = {
  schema,
  meta,
  handler
};
