'use strict';

const { db } = require('../db');
const { parseStoreDrill } = require('../utils/storeDrill');
const {
  resolveTaskId,
  buildRegionFilter,
} = require('../services/executiveMetricsQueryService');

/**
 * tool_queryMetricsTimeseries.js (v1.0)
 *
 * 时间序列趋势工具：按 hour / day / week / month 粒度聚合事件计数。
 *
 * 适用场景：
 * - "近 7 天每日完成数趋势"
 * - "P0 预警按周触发分布"
 * - "本月各大区每日完成情况（多线图）"
 *
 * 仅支持基于事件时间戳的"累计型"指标：
 *   reach_count       (received_at)
 *   complete_count    (completed_at)
 *   p0_warning_count  (notification_events.created_at WHERE event_type='nudge_red')
 *   p1_warning_count  (... 'nudge_orange')
 *   p2_warning_count  (... 'nudge_yellow')
 *
 * **强制以"一个任务"为基本单位**。
 */

// 注：SQLite strftime 安全：granularity 限定枚举值，不存在 SQL 注入风险
const GRANULARITY_EXPR = {
  hour: "strftime('%Y-%m-%d %H:00:00', __FIELD__)",
  day: "strftime('%Y-%m-%d', __FIELD__)",
  week: "strftime('%Y-W%W', __FIELD__)",
  month: "strftime('%Y-%m', __FIELD__)",
};

const SUPPORTED_TS_METRICS = {
  reach_count: {
    source: 'task_assignments',
    field: 'received_at',
    extraFilter: 'received_at IS NOT NULL',
  },
  complete_count: {
    source: 'task_assignments',
    field: 'completed_at',
    extraFilter: "status='completed' AND completed_at IS NOT NULL",
  },
  p0_warning_count: {
    source: 'notification_events',
    field: 'created_at',
    extraFilter: "event_type='nudge_red'",
  },
  p1_warning_count: {
    source: 'notification_events',
    field: 'created_at',
    extraFilter: "event_type='nudge_orange'",
  },
  p2_warning_count: {
    source: 'notification_events',
    field: 'created_at',
    extraFilter: "event_type='nudge_yellow'",
  },
};

const DIMENSION_MAP = {
  channel_l3: 's.rtm',
  channel_l4: 's.format',
  dealer: 's.dealer_name',
  store: 's.id',
};

const schema = {
  type: 'function',
  function: {
    name: 'queryMetricsTimeseries',
    description:
      '按时间粒度（hour/day/week/month）聚合任务的指标随时间变化，用于绘制趋势折线图。**必须提供 taskName / productName / taskId 之一**。仅支持基于事件时间戳的累计型指标：reach_count、complete_count、p0_warning_count、p1_warning_count、p2_warning_count。',
    parameters: {
      type: 'object',
      properties: {
        taskName: { type: 'string' },
        productName: { type: 'string' },
        taskId: { type: 'string' },
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: Object.keys(SUPPORTED_TS_METRICS),
          },
          description: '一个或多个时间序列指标',
        },
        granularity: {
          type: 'string',
          enum: ['hour', 'day', 'week', 'month'],
          description: '时间粒度',
        },
        time: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'ISO 8601 起始时间' },
            end: { type: 'string', description: 'ISO 8601 截止时间' },
          },
          description: '时间窗口（可选；不传则覆盖任务整个生命周期）',
        },
        filters: {
          type: 'object',
          properties: {
            rtm: { type: 'string' },
            format: { type: 'string' },
            dealerName: { type: 'string' },
            storeId: { type: 'string' },
          },
        },
        group_by: {
          type: 'string',
          enum: ['channel_l3', 'channel_l4', 'dealer', 'store'],
          description: '可选：每个时间桶内再按维度分组（生成多线图）',
        },
      },
      required: ['metrics', 'granularity'],
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
    if (!args.taskName && !args.productName && !args.taskId) {
      return {
        success: false,
        errorCode: 'TASK_REQUIRED',
        message: '取数以"一个任务"为基本单位。请提供 taskName / productName / taskId 之一。',
        appliedParams: args,
      };
    }

    const taskId = resolveTaskId(args.taskName, args.productName, args.taskId);
    if (!taskId) {
      return {
        success: false,
        errorCode: 'TASK_NOT_FOUND',
        message: '无法解析为具体任务，请尝试更精确的任务名称或直接提供 taskId。',
        appliedParams: args,
      };
    }

    const granularity = args.granularity;
    const granExprTpl = GRANULARITY_EXPR[granularity];
    if (!granExprTpl) {
      return {
        success: false,
        errorCode: 'INVALID_PARAMETERS',
        message: `不支持的时间粒度: ${granularity}`,
      };
    }

    if (!Array.isArray(args.metrics) || args.metrics.length === 0) {
      return {
        success: false,
        errorCode: 'INVALID_PARAMETERS',
        message: '请指定至少一个时间序列指标',
      };
    }

    const drill = parseStoreDrill(args.filters || {});
    const scope = buildRegionFilter(regionScope);
    const groupCol = args.group_by ? DIMENSION_MAP[args.group_by] : null;

    const series = [];
    for (const metric of args.metrics) {
      const cfg = SUPPORTED_TS_METRICS[metric];
      if (!cfg) {
        return {
          success: false,
          errorCode: 'INVALID_PARAMETERS',
          message: `不支持的时间序列指标: ${metric}`,
        };
      }

      const isAssignment = cfg.source === 'task_assignments';
      const tablePrefix = isAssignment ? 'ta' : 'ne';
      const fieldExpr = `${tablePrefix}.${cfg.field}`;
      const bucketExpr = granExprTpl.replace('__FIELD__', fieldExpr);

      const hasTimeWindow = args.time && args.time.start && args.time.end;
      const timeFilter = hasTimeWindow ? `AND ${fieldExpr} BETWEEN ? AND ?` : '';
      const timeParams = hasTimeWindow ? [args.time.start, args.time.end] : [];

      let sql;
      if (isAssignment) {
        sql = `
          SELECT
            ${bucketExpr} AS bucket
            ${groupCol ? `, ${groupCol} AS group_key` : ''},
            COUNT(*) AS value
          FROM task_assignments ta
          JOIN stores s ON s.id = ta.store_id
          WHERE ta.task_id = ?
            AND ${cfg.extraFilter}
            ${timeFilter}
            ${drill.sql} ${scope.sql}
          GROUP BY bucket ${groupCol ? ', group_key' : ''}
          ORDER BY bucket ASC
        `;
      } else {
        sql = `
          SELECT
            ${bucketExpr} AS bucket
            ${groupCol ? `, ${groupCol} AS group_key` : ''},
            COUNT(DISTINCT ne.target_user_id) AS value
          FROM notification_events ne
          JOIN stores s ON s.id = ne.store_id
          WHERE ne.task_id = ?
            AND ${cfg.extraFilter}
            ${timeFilter}
            ${drill.sql} ${scope.sql}
          GROUP BY bucket ${groupCol ? ', group_key' : ''}
          ORDER BY bucket ASC
        `;
      }
      const params = [taskId, ...timeParams, ...drill.params, ...scope.params];
      const rows = db.all(sql, params);

      // Reshape to series
      if (groupCol) {
        const grouped = new Map();
        for (const r of rows) {
          const key = String(r.group_key ?? 'Total');
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push({ t: r.bucket, value: Number(r.value) });
        }
        for (const [key, points] of grouped.entries()) {
          series.push({ metric, label: key, points });
        }
      } else {
        series.push({
          metric,
          label: metric,
          points: rows.map((r) => ({ t: r.bucket, value: Number(r.value) })),
        });
      }
    }

    return {
      success: true,
      taskId,
      granularity,
      group_by: args.group_by || null,
      series,
      summary: {
        seriesCount: series.length,
        totalPoints: series.reduce((acc, s) => acc + s.points.length, 0),
        timestamp: new Date().toISOString(),
      },
      dataSource: 'task_assignments / notification_events (time-bucketed)',
      appliedParams: args,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `时间序列查询失败: ${err.message}`,
      appliedParams: args,
    };
  }
}

module.exports = { schema, meta, handler };
