'use strict';

/**
 * compare — 两组数据对比
 * 委托给原 compareMetrics handler
 */

const schema = {
  type: 'function',
  function: {
    name: 'compare',
    description: '对两组数据做对比：horizontal=同时段不同维度，vertical=同维度不同时段。task_id 必填。',
    parameters: {
      type: 'object',
      required: ['task_id', 'metrics', 'mode'],
      properties: {
        task_id:   { type: 'string', description: '任务 ID。' },
        metrics:   { type: 'array', items: { type: 'string' }, description: '要对比的指标列表。' },
        mode:      { type: 'string', enum: ['horizontal', 'vertical'], description: 'horizontal=跨维度对比, vertical=跨时段对比。' },
        dimension: { type: 'string', enum: ['channel_l3', 'channel_l4', 'dealer', 'store'], description: 'horizontal 模式的对比维度。' },
        values:    { type: 'array', items: { type: 'string' }, description: 'horizontal 模式：要对比的具体值，如 ["Monobrand","Multibrand"]。' },
        period_a_start: { type: 'string', description: 'vertical 模式：时段A起点 (ISO 8601)。' },
        period_a_end:   { type: 'string', description: 'vertical 模式：时段A终点。' },
        period_b_start: { type: 'string', description: 'vertical 模式：时段B起点。' },
        period_b_end:   { type: 'string', description: 'vertical 模式：时段B终点。' },
      },
    },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 12000,
};

// 委托给原 compareMetrics handler（其内部有 runHorizontal / runVertical 专用逻辑）
const originalHandler = require('./tool_compareMetrics').handler;

async function handler(args, regionScope) {
  return await originalHandler({
    taskId: args.task_id,
    metrics: args.metrics,
    mode: args.mode,
    horizontal_dim: args.dimension,
    horizontal_values: args.values,
    vertical_periods: args.mode === 'vertical'
      ? [{ label: 'A', start: args.period_a_start, end: args.period_a_end },
         { label: 'B', start: args.period_b_start, end: args.period_b_end }]
      : undefined,
  }, regionScope);
}

module.exports = { schema, meta, handler };
