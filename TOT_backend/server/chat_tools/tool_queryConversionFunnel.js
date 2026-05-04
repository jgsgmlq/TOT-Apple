'use strict';

const { query: matrixQuery } = require('../services/executiveMetricsQueryService');

/**
 * tool_queryConversionFunnel.js (v1.0)
 *
 * 催办漏斗专用工具：一次性返回 P2 → P1 → P0 → 未完成 四阶段人数 + 三级转化指标。
 *
 * 用法：
 * - 当用户问"催办效果"、"挽回了多少人"、"漏斗"、"P 级转化"等场景，优先使用此工具。
 * - 必须以一个任务为基本单位（taskName / productName / taskId 三选一）。
 * - 输出按维度（默认全量 Total）一行一组 funnel + conversion。
 *
 * 转化口径（已确认 D3：只返回新口径，分母 = 总人数）：
 *   p2_conversion_rate = (p2_warning_count - p1_warning_count) / total_count × 100
 *   p1_conversion_rate = (p1_warning_count - p0_warning_count) / total_count × 100
 *   p0_conversion_rate = (p0_warning_count - incomplete_count)  / total_count × 100
 * 转化人数 clamp ≥ 0（ddl 之前 P 级未触发时自动屏蔽）。
 */

const schema = {
  type: 'function',
  function: {
    name: 'queryConversionFunnel',
    description:
      '查询单任务的催办转化漏斗（P2 → P1 → P0 → 未完成）。返回各级预警人数 + 三级转化人数与转化率（分母 = 总人数）。当用户问"催办效果"、"转化率"、"挽回了多少人"、"漏斗"、"P 级"等场景时优先使用此工具。**必须提供 taskName / productName / taskId 之一**。',
    parameters: {
      type: 'object',
      properties: {
        taskName: { type: 'string', description: '培训任务标题关键词（如 "iPhone 17 新品"）' },
        productName: { type: 'string', description: '关联的 MyPAL 产品名' },
        taskId: { type: 'string', description: '任务 ID（如 TASK_A）；若提供则跳过名称解析' },
        dimensions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['channel_l3', 'channel_l4', 'dealer', 'store'],
          },
          description: '聚合维度。空数组或不传 = 全量汇总（一行 Total）。',
        },
        filters: {
          type: 'object',
          properties: {
            rtm: { type: 'string' },
            format: { type: 'string' },
            dealerName: { type: 'string' },
            storeId: { type: 'string' },
            time: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
                field: {
                  type: 'string',
                  enum: ['received_at', 'completed_at', 'started_at', 'created_at'],
                },
              },
            },
          },
        },
        sort: {
          type: 'object',
          properties: {
            sortBy: {
              type: 'string',
              description:
                '排序指标（推荐 p0_conversion_rate / p1_conversion_rate / p2_conversion_rate / p0_warning_rate）',
            },
            order: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
      },
    },
  },
};

const meta = {
  enabled: false,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 8000,
};

const FUNNEL_METRICS = [
  'total_count',
  'incomplete_count',
  'p2_warning_count', 'p2_warning_rate',
  'p1_warning_count', 'p1_warning_rate',
  'p0_warning_count', 'p0_warning_rate',
  'p2_conversion_count', 'p2_conversion_rate',
  'p1_conversion_count', 'p1_conversion_rate',
  'p0_conversion_count', 'p0_conversion_rate',
];

async function handler(args, regionScope) {
  try {
    if (!args.taskName && !args.productName && !args.taskId) {
      return {
        success: false,
        errorCode: 'TASK_REQUIRED',
        message: '取数以"一个任务"为基本单位。请提供 taskName / productName / taskId 之一。',
        recommendation: '先用任务名称提问，或调用 searchEntities 搜索任务后再次查询。',
        appliedParams: args,
      };
    }

    const result = await matrixQuery(
      {
        taskName: args.taskName,
        productName: args.productName,
        taskId: args.taskId,
        dimensions: args.dimensions || [],
        filters: args.filters || {},
        sort: args.sort,
        metrics: FUNNEL_METRICS,
      },
      regionScope
    );

    if (result.error) {
      return {
        success: false,
        errorCode: result.error,
        message: result.message,
        hint: result.hint,
        appliedParams: args,
      };
    }

    // 重组为 funnel 视图
    const funnelRows = result.rows.map((r) => ({
      dimensions: r.dimensions,
      funnel: {
        total_count: r.total_count,
        p2_warning_count: r.p2_warning_count,
        p2_warning_rate: r.p2_warning_rate,
        p1_warning_count: r.p1_warning_count,
        p1_warning_rate: r.p1_warning_rate,
        p0_warning_count: r.p0_warning_count,
        p0_warning_rate: r.p0_warning_rate,
        incomplete_count: r.incomplete_count,
      },
      conversion: {
        p2_conversion_count: r.p2_conversion_count,
        p2_conversion_rate: r.p2_conversion_rate,
        p1_conversion_count: r.p1_conversion_count,
        p1_conversion_rate: r.p1_conversion_rate,
        p0_conversion_count: r.p0_conversion_count,
        p0_conversion_rate: r.p0_conversion_rate,
      },
    }));

    return {
      success: true,
      taskId: result.taskId,
      data: funnelRows,
      summary: {
        rowCount: funnelRows.length,
        dimensions: result.dimensions,
        timestamp: result.summary?.timestamp,
      },
      metricGlossary: {
        p2_conversion_rate:
          'P2 催办挽回的人数占任务总人数比例：(P2 触发预警人数 - P1 触发预警人数) / 总人数 × 100%',
        p1_conversion_rate:
          'P1 催办挽回的人数占任务总人数比例：(P1 触发预警人数 - P0 触发预警人数) / 总人数 × 100%',
        p0_conversion_rate:
          'P0 催办挽回的人数占任务总人数比例：(P0 触发预警人数 - 未完成人数)   / 总人数 × 100%',
      },
      dataSource: 'task_assignments + notification_events (distinct user_id)',
      appliedParams: result.appliedParams,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `催办漏斗查询失败: ${err.message}`,
      appliedParams: args,
    };
  }
}

module.exports = { schema, meta, handler };
