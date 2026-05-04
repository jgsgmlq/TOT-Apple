'use strict';

const executiveMetricsQueryService = require('../services/executiveMetricsQueryService');

/**
 * tool_queryExecutiveMetrics.js (v4.0)
 *
 * 矩阵查询主力工具：
 * - 19 指标全集（reach / complete / incomplete / avg_duration / 6 个 P 级 warning / 6 个转化）
 * - 维度下钻：channel_l3 / channel_l4 / dealer / store（支持多维组合）
 * - 时间窗口过滤：filters.time = { start, end, field }
 * - 聚合算子：raw / topn / bottomn / mean / distribution
 * - **强制以"一个任务"为基本单位**：taskName / productName / taskId 至少必填一项
 */

const schema = {
  type: 'function',
  function: {
    name: 'queryExecutiveMetrics',
    description:
      '高管度量矩阵查询。当需要查询完成率、触达率、未完成率、P0/P1/P2 预警率、催办转化率、平均耗时等指标，且涉及大区/业态/经销商/门店对比、排序、TopN/BottomN 等场景时优先使用此工具。**必须以一个具体任务为基本单位**：taskName / productName / taskId 至少提供一项，否则将返回 task_required 错误。',
    parameters: {
      type: 'object',
      properties: {
        // ─── 任务定位（三选一必填）───
        taskName: {
          type: 'string',
          description: '培训任务标题关键词（如 "iPhone 17 新品"）。与 productName / taskId 三选一。',
        },
        productName: {
          type: 'string',
          description: '关联的 MyPAL 产品名。与 taskName / taskId 三选一。',
        },
        taskId: {
          type: 'string',
          description: '任务 ID（如 TASK_A），最高优先级；若提供则跳过名称解析。',
        },

        // ─── 分组维度 ───
        dimensions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['all', 'channel_l3', 'channel_l4', 'dealer', 'store'],
            description: 'all=不分组；channel_l3=大区；channel_l4=业态；dealer=经销商；store=门店',
          },
          description: '聚合维度。空数组或 ["all"] 表示全量汇总；可传多个组合（如 ["channel_l3","dealer"]）。',
        },

        // ─── 指标 ───
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              // 基础（assignment）
              'total_count',
              'reach_count', 'reach_rate',
              'complete_count', 'complete_rate',
              'incomplete_count', 'incomplete_rate',
              'avg_duration_sec',
              // 预警（notification_events 历史去重）
              'p0_warning_count', 'p0_warning_rate',
              'p1_warning_count', 'p1_warning_rate',
              'p2_warning_count', 'p2_warning_rate',
              // 催办转化（分母 = 总人数）
              'p0_conversion_count', 'p0_conversion_rate',
              'p1_conversion_count', 'p1_conversion_rate',
              'p2_conversion_count', 'p2_conversion_rate',
              // 旧别名（兼容）
              'completion_rate', 'completed_count',
              'avg_completion_time_hours',
              'crisis_p0_rate', 'crisis_p1_rate',
              'crisis_p0_count', 'crisis_p1_count',
            ],
          },
          description: '度量指标列表。至少 1 个。',
        },

        // ─── 过滤 ───
        filters: {
          type: 'object',
          properties: {
            rtm: { type: 'string', description: '渠道（"Carrier"/"Monobrand"/"Multibrand"/"Education"）' },
            format: { type: 'string', description: '业态（"MONO"/"Mass Merchant"/"Lifestyle"/"Campus"）' },
            dealerName: { type: 'string', description: '经销商名' },
            storeId: { type: 'string', description: '门店 ID' },
            time: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'ISO 8601 起始时间' },
                end: { type: 'string', description: 'ISO 8601 截止时间' },
                field: {
                  type: 'string',
                  enum: ['received_at', 'completed_at', 'started_at', 'created_at'],
                  description: '时间字段（默认 received_at）',
                },
              },
              description: '时间窗口过滤（可选）。',
            },
          },
          description: '过滤条件。',
        },

        // ─── 排序 ───
        sort: {
          type: 'object',
          properties: {
            sortBy: { type: 'string', description: '排序指标名（如 "complete_rate"）' },
            order: { type: 'string', enum: ['asc', 'desc'], description: '默认 desc' },
          },
          description: '排序设置。',
        },

        // ─── 聚合算子 ───
        aggregation: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['raw', 'topn', 'bottomn', 'mean', 'distribution'],
              description: 'raw=原始；topn/bottomn=取前后 N；mean=均值；distribution=区间分布',
            },
            n: {
              type: 'number',
              description: 'topn/bottomn 的 N 值（1–1000）',
            },
            bins: {
              type: 'array',
              items: { type: 'number' },
              description: 'distribution 的区间边界（如 [0,25,50,75,100]）',
            },
            target_metric: {
              type: 'string',
              description: '聚合的目标指标名（默认取 sort.sortBy 或 metrics[0]）',
            },
          },
          description: '聚合 / 二次计算方式。',
        },
      },
      required: ['metrics'],
    },
  },
};

const meta = {
  enabled: false,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 8000,
};

async function handler(args, regionScope) {
  try {
    // 入口 guard：task 强必填
    if (!args.taskName && !args.productName && !args.taskId) {
      return {
        success: false,
        errorCode: 'TASK_REQUIRED',
        message: '取数以"一个任务"为基本单位。请提供 taskName、productName 或 taskId 之一（建议先调用 searchEntities 消歧）。',
        recommendation: '先用任务名称关键字提问，或调用 searchEntities 工具搜索任务列表后再次查询。',
        appliedParams: args,
      };
    }

    const result = await executiveMetricsQueryService.query(args, regionScope);

    if (result.error) {
      return {
        success: false,
        errorCode: result.error,
        message: result.message || `执行失败: ${result.error}`,
        hint: result.hint,
        appliedParams: args,
      };
    }

    return {
      success: true,
      data: result.rows,
      summary: {
        taskId: result.taskId,
        dimensions: result.dimensions,
        metrics: result.metrics,
        rowCount: result.rows.length,
        aggregation: result.summary?.aggregation,
        timestamp: result.summary?.timestamp,
      },
      dataSource: result.dataSource,
      appliedParams: result.appliedParams || args,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `矩阵查询执行发生系统异常: ${err.message}`,
      appliedParams: args,
    };
  }
}

module.exports = {
  schema,
  meta,
  handler,
};
