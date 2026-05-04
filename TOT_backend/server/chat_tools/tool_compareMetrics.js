'use strict';

const { query: matrixQuery } = require('../services/executiveMetricsQueryService');

/**
 * tool_compareMetrics.js (v1.0)
 *
 * 横纵对比工具：让 CEO 一句话拿到对比表，不再让 LLM 串两次查询自行减法。
 *
 * 两种模式：
 * - horizontal：同时段不同维度（例如 华东 vs 华南 / 经销商 A vs 经销商 B）
 * - vertical  ：同维度不同时段（例如 本周 vs 上周）
 *
 * 输出：每组的指标值 + 差值（abs / 相对百分比 / 方向）。
 *
 * **强制以"一个任务"为基本单位**。
 */

const HORIZONTAL_DIM_ENUM = ['channel_l3', 'channel_l4', 'dealer', 'store'];

const schema = {
  type: 'function',
  function: {
    name: 'compareMetrics',
    description:
      '对两组数据做对比：horizontal=同时段不同维度（如华东 vs 华南）；vertical=同维度不同时段（如本周 vs 上周）。返回每组指标 + 差值与变化率。**必须提供 taskName / productName / taskId 之一**。',
    parameters: {
      type: 'object',
      properties: {
        taskName: { type: 'string' },
        productName: { type: 'string' },
        taskId: { type: 'string' },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description:
            '要对比的指标列表（与 queryExecutiveMetrics 的 metrics enum 一致）',
        },
        mode: {
          type: 'string',
          enum: ['horizontal', 'vertical'],
          description: 'horizontal=同时段不同维度；vertical=同维度不同时段',
        },
        // horizontal mode
        horizontal_dim: {
          type: 'string',
          enum: HORIZONTAL_DIM_ENUM,
          description: '横向对比的维度（mode=horizontal 必填）',
        },
        horizontal_values: {
          type: 'array',
          items: { type: 'string' },
          description:
            '要对比的具体维度值列表（如 ["华东","华南"]），至少 2 个（mode=horizontal 必填）',
        },
        // vertical mode
        vertical_periods: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '时段标签（如 "本周"）' },
              start: { type: 'string', description: 'ISO 8601 起始时间' },
              end: { type: 'string', description: 'ISO 8601 截止时间' },
            },
          },
          description: '纵向对比的时间段，**固定 2 段**（mode=vertical 必填）',
        },
        time_field: {
          type: 'string',
          enum: ['received_at', 'completed_at', 'started_at', 'created_at'],
          description: 'vertical 模式下时间窗口绑定的字段（默认 received_at）',
        },
        // 公共过滤
        filters: {
          type: 'object',
          properties: {
            rtm: { type: 'string' },
            format: { type: 'string' },
            dealerName: { type: 'string' },
            storeId: { type: 'string' },
          },
          description: '公共过滤（应用于两组数据）',
        },
      },
      required: ['metrics', 'mode'],
    },
  },
};

const meta = {
  enabled: false,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 10000,
};

function computeDiff(groupA, groupB, metrics) {
  const diff = {};
  for (const m of metrics) {
    const a = Number(groupA?.metrics?.[m]);
    const b = Number(groupB?.metrics?.[m]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      diff[m] = { abs: null, rel_pct: null, direction: 'unknown' };
      continue;
    }
    const abs = parseFloat((a - b).toFixed(2));
    const rel = b !== 0 ? parseFloat(((100.0 * (a - b)) / b).toFixed(2)) : null;
    const direction = abs > 0 ? 'a_higher' : abs < 0 ? 'b_higher' : 'equal';
    diff[m] = { abs, rel_pct: rel, direction };
  }
  return diff;
}

async function runHorizontal(args, regionScope) {
  if (!args.horizontal_dim || !Array.isArray(args.horizontal_values) || args.horizontal_values.length < 2) {
    return {
      success: false,
      errorCode: 'INVALID_PARAMETERS',
      message: 'mode=horizontal 时需要 horizontal_dim + horizontal_values（至少 2 个值）',
    };
  }

  // 一次按 horizontal_dim 分组拿到全部值，再在内存里筛 horizontal_values
  const result = await matrixQuery(
    {
      taskName: args.taskName,
      productName: args.productName,
      taskId: args.taskId,
      metrics: args.metrics,
      dimensions: [args.horizontal_dim],
      filters: args.filters || {},
    },
    regionScope
  );

  if (result.error) {
    return { success: false, errorCode: result.error, message: result.message };
  }

  const dimKey = args.horizontal_dim;
  const groups = args.horizontal_values.map((val) => {
    const matched = result.rows.find((r) => String(r.dimensions?.[dimKey]) === String(val));
    const metricsObj = {};
    for (const m of args.metrics) {
      metricsObj[m] = matched ? matched[m] : null;
    }
    return { label: val, dim: dimKey, metrics: metricsObj, missing: !matched };
  });

  const diff = computeDiff(groups[0], groups[1], args.metrics);

  return {
    success: true,
    mode: 'horizontal',
    horizontal_dim: dimKey,
    taskId: result.taskId,
    groups,
    diff,
    diffNote:
      'diff 描述 groups[0] 相对 groups[1] 的变化：a_higher = 第一组更高；b_higher = 第二组更高；rel_pct = (a-b)/b × 100%。',
    summary: {
      groupCount: groups.length,
      missingCount: groups.filter((g) => g.missing).length,
      timestamp: new Date().toISOString(),
    },
    appliedParams: args,
  };
}

async function runVertical(args, regionScope) {
  if (!Array.isArray(args.vertical_periods) || args.vertical_periods.length !== 2) {
    return {
      success: false,
      errorCode: 'INVALID_PARAMETERS',
      message: 'mode=vertical 时 vertical_periods 必须为 2 段',
    };
  }
  for (const p of args.vertical_periods) {
    if (!p.label || !p.start || !p.end) {
      return {
        success: false,
        errorCode: 'INVALID_PARAMETERS',
        message: 'vertical_periods 每段必须包含 label / start / end',
      };
    }
  }

  const timeField = args.time_field || 'received_at';
  const groups = [];
  for (const period of args.vertical_periods) {
    const result = await matrixQuery(
      {
        taskName: args.taskName,
        productName: args.productName,
        taskId: args.taskId,
        metrics: args.metrics,
        dimensions: ['all'],
        filters: {
          ...(args.filters || {}),
          time: { start: period.start, end: period.end, field: timeField },
        },
      },
      regionScope
    );

    if (result.error) {
      return { success: false, errorCode: result.error, message: result.message };
    }

    const row = result.rows[0] || {};
    const metricsObj = {};
    for (const m of args.metrics) {
      metricsObj[m] = row[m] !== undefined ? row[m] : null;
    }
    groups.push({
      label: period.label,
      period: { start: period.start, end: period.end, field: timeField },
      metrics: metricsObj,
    });
  }

  const diff = computeDiff(groups[0], groups[1], args.metrics);

  return {
    success: true,
    mode: 'vertical',
    time_field: timeField,
    taskId: groups[0]?.metrics ? args.taskId || null : null,
    groups,
    diff,
    diffNote:
      'diff 描述 groups[0] 相对 groups[1] 的变化（即第一段相对第二段）：a_higher = 第一段更高。',
    summary: {
      groupCount: groups.length,
      timestamp: new Date().toISOString(),
    },
    appliedParams: args,
  };
}

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
    if (!Array.isArray(args.metrics) || args.metrics.length === 0) {
      return {
        success: false,
        errorCode: 'INVALID_PARAMETERS',
        message: '请指定至少一个指标',
      };
    }

    if (args.mode === 'horizontal') return await runHorizontal(args, regionScope);
    if (args.mode === 'vertical') return await runVertical(args, regionScope);

    return {
      success: false,
      errorCode: 'INVALID_PARAMETERS',
      message: `不支持的 mode: ${args.mode}`,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: `对比查询失败: ${err.message}`,
      appliedParams: args,
    };
  }
}

module.exports = { schema, meta, handler };
