'use strict';

/**
 * decideChart — 纯函数，从工具查询结果生成 ECharts 配置。
 * 零 LLM 参与，给定相同的 toolResults + intent 永远输出相同的图表。
 *
 * 返回 null 表示"不需要画图"（单值、无数据、意图不适用）。
 * LLM 可以在 Markdown 中自由追加额外的 ```echarts 代码块来覆盖或补充。
 */

const { normalizeToolResults } = require('./shared/normalizeToolResults');

const MAX_BARS = 12; // 柱状图最多显示条数

// ─── helpers ──────────────────────────────────────────────────────────

function _parseResults(toolResults) {
  const datasets = normalizeToolResults(toolResults);
  return datasets.flatMap(ds => ds.rows);
}

function _fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : v;
}

function _shortLabel(text, max = 12) {
  if (typeof text !== 'string') return String(text ?? '');
  return text.length <= max ? text : text.slice(0, max) + '…';
}

// ─── per-intent chart builders ────────────────────────────────────────

function chartForQueryMetrics(rows) {
  if (rows.length === 0 || rows.length > MAX_BARS * 2) return null;

  // 找维度字段和指标字段
  const sample = rows[0];
  const dimKeys = ['channel_l3', 'channel_l4', 'dealer_name', 'store_name', 'region', 'format', 'dimension'];
  const metricKeys = ['completion_rate', 'completed_count', 'total_count', 'avg_completion_time_hours', 'crisis_p0_rate', 'crisis_p1_rate', 'read_rate', 'start_delay_rate'];

  const dimKey = dimKeys.find(k => sample[k] !== undefined || (sample.dimensions && sample.dimensions[k] !== undefined));
  const metricKey = metricKeys.find(k => sample[k] !== undefined);

  if (!metricKey) return null;

  const xAxis = [];
  const data = [];

  for (const r of rows) {
    let label = '';
    if (dimKey) {
      label = sample.dimensions ? (r.dimensions?.[dimKey] || '') : (r[dimKey] || '');
    }
    if (!label) label = r.name || r.title || r.label || '';
    if (!label) label = '记录 ' + xAxis.length;
    xAxis.push(_shortLabel(label));
    data.push(_fmt(r[metricKey]));
  }

  const isPercent = metricKey.includes('rate') || metricKey.includes('completion');
  return {
    type: 'bar',
    title: dimKey ? `各${_shortLabel(dimKey === 'channel_l3' ? '大区' : dimKey === 'channel_l4' ? '业态' : dimKey === 'dealer_name' ? '经销商' : dimKey === 'store_name' ? '门店' : dimKey)}完成率对比` : '指标对比',
    xAxis,
    series: [{ name: isPercent ? '完成率 (%)' : '数值', data }],
  };
}

function chartForDrillDown(rows) {
  if (rows.length === 0) return null;

  // drill_down 常有 store_leader / store_laggard 或 ranking
  const hasRate = rows.some(r => r.completionRate !== undefined || r.completion_rate !== undefined);

  if (!hasRate) return null;

  const sorted = [...rows]
    .filter(r => (r.completionRate ?? r.completion_rate) !== undefined)
    .sort((a, b) => (a.completionRate ?? a.completion_rate) - (b.completionRate ?? b.completion_rate))
    .slice(0, MAX_BARS);

  if (sorted.length === 0) return null;

  const xAxis = sorted.map(r => _shortLabel(r.storeName || r.store_name || r.name || r.region || '—'));
  const data = sorted.map(r => _fmt(r.completionRate ?? r.completion_rate));
  const highlights = [];

  sorted.forEach((r, i) => {
    const rate = r.completionRate ?? r.completion_rate;
    if (rate < 30) highlights.push(i);
  });

  return {
    type: 'bar',
    title: '完成率最低门店排名',
    xAxis,
    series: [{ name: '完成率 (%)', data }],
    highlights: highlights.length > 0 ? highlights : undefined,
  };
}

function chartForWarnings(rows) {
  if (rows.length === 0) return null;

  const hasRate = rows.some(r => r.completionRate !== undefined || r.completion_rate !== undefined);
  if (!hasRate) return null;

  const preview = rows.slice(0, MAX_BARS);
  const xAxis = preview.map(r => _shortLabel(r.storeName || r.store_name || r.name || '—'));
  const data = preview.map(r => _fmt(r.completionRate ?? r.completion_rate));
  const highlights = [];

  preview.forEach((r, i) => {
    const rate = r.completionRate ?? r.completion_rate;
    if (rate < 30) highlights.push(i);
  });

  return {
    type: 'bar',
    title: '⚠️ 预警门店完成率',
    xAxis,
    series: [{ name: '完成率 (%)', data }],
    highlights: highlights.length > 0 ? highlights : undefined,
  };
}

function chartForAnalytics(rows) {
  // analytics 常返回 { summary, findings }，不适合画图
  // 但如果有趋势数据（含 date/day 字段），可以画折线图
  const hasDate = rows.some(r => r.day || r.date);
  const hasValue = rows.some(r => r.value !== undefined || r.count !== undefined || r.completedCount !== undefined);

  if (!hasDate || !hasValue) return null;

  const xAxis = rows.map(r => r.day || r.date || '');
  const valKey = rows[0].value !== undefined ? 'value' : (rows[0].count !== undefined ? 'count' : 'completedCount');
  const data = rows.map(r => _fmt(r[valKey]));

  return {
    type: 'line',
    title: '趋势分析',
    xAxis,
    series: [{ name: '数值', data }],
  };
}

// ─── main dispatch ────────────────────────────────────────────────────

const CHART_BUILDERS = {
  query_metrics:   chartForQueryMetrics,
  progress_query:  chartForQueryMetrics,
  drill_down:      chartForDrillDown,
  warning_query:   chartForWarnings,
  analytics_query: chartForAnalytics,
};

/**
 * @param {object} toolResults — state.toolResults
 * @param {string} intent — canonical intent
 * @returns {object|null} — ChartData (bar/line/pie/scatter + xAxis + series + title) or null
 */
function decideChart(toolResults, intent) {
  if (!toolResults || Object.keys(toolResults).length === 0) return null;

  const rows = _parseResults(toolResults);
  if (rows.length === 0) return null;

  const builder = CHART_BUILDERS[intent];
  if (!builder) return null;

  try {
    return builder(rows) || null;
  } catch {
    return null;
  }
}

module.exports = { decideChart };
