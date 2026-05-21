'use strict';

/**
 * 从 toolResults 中提取所有可画图的结构化数据集。
 * 纯函数，零 LLM 参与，同一输入永远返回相同输出。
 *
 * 返回 [{ id, kind, title, rows/points/stages, dimensions, metrics }]
 * - kind: "ranking" | "trend" | "funnel" | "comparison" | "distribution"
 * - id: 稳定标识符，供 LLM 在 selectedCharts 中引用
 */

const { normalizeToolResults } = require('./normalizeToolResults');

// ─── 中文标签映射（统一出口，避免英文字段名泄漏到用户界面）─────────

const FIELD_LABEL_MAP = {
  // 维度
  store: '门店', store_name: '门店', region: '区域', rtm: 'RTM',
  channel_l3: '大区', channel_l4: '业态', dealer_name: '经销商',
  task_name: '任务名称', task_id: '任务ID', priority: '优先级', platform: '平台',
  deadline: '截止日期', day: '日期', date: '日期', month: '月份', week: '周',
  stage: '阶段', label: '标签', name: '名称', metric: '指标', dimension: '维度',
  // 指标
  completion_rate: '完成率%', completed_count: '已完成', total_count: '总计',
  learning_rate: '学习率%', learning_count: '学习人数',
  crisis_p0_rate: 'P0预警%', crisis_p1_rate: 'P1预警%', crisis_p2_rate: 'P2预警%',
  read_rate: '阅读率%', avg_completion_time_hours: '平均耗时h',
  count: '人数', value: '数值',
  sharePercent: '占比%', dropPercent: '流失率%', dropWidth: '流失宽度',
};

function labelOf(key) {
  // camelCase → snake_case 再查
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  return FIELD_LABEL_MAP[key] || FIELD_LABEL_MAP[snake] || key;
}

// ─── 数据集检测 ────────────────────────────────────────────────────────

function detectMetricNames(rows) {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const candidates = [
    'completion_rate', 'completionRate', 'completed_count', 'completedCount',
    'total_count', 'totalCount', 'learning_rate', 'learning_count',
    'crisis_p0_rate', 'crisis_p1_rate',
    'read_rate', 'avg_completion_time_hours', 'value', 'count',
  ];
  return candidates.filter((k) => {
    if (sample[k] !== undefined) return true;
    if (sample.dimensions && sample.dimensions[k] !== undefined) return true;
    return false;
  });
}

function detectDimensionNames(rows) {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const candidates = [
    'store', 'store_name', 'storeName', 'region', 'rtm',
    'channel_l3', 'channel_l4', 'dealer_name', 'format',
    'task_name', 'task_id', 'priority', 'platform',
    'day', 'date', 'month', 'week', 'deadline', 'stage', 'metric', 'dimension',
  ];
  return candidates.filter((k) => {
    if (sample[k] !== undefined) return true;
    if (sample.dimensions && sample.dimensions[k] !== undefined) return true;
    return false;
  });
}

function getDimValue(row, dimKey) {
  if (row.dimensions && row.dimensions[dimKey] !== undefined) return String(row.dimensions[dimKey]);
  if (row[dimKey] !== undefined) return String(row[dimKey]);
  return '';
}

function getMetricValue(row, metricKey) {
  if (row.dimensions && row.dimensions[metricKey] !== undefined) return Number(row.dimensions[metricKey]);
  return Number(row[metricKey]);
}

// ─── 量纲分组（避免百分比和绝对人数混在同一张图）─────────────────────────

const SCALE_PERCENT = 'pct';
const SCALE_COUNT = 'cnt';
const SCALE_OTHER = 'other';

const METRIC_SCALE_MAP = {
  completion_rate: SCALE_PERCENT, learning_rate: SCALE_PERCENT, read_rate: SCALE_PERCENT,
  crisis_p0_rate: SCALE_PERCENT, crisis_p1_rate: SCALE_PERCENT, crisis_p2_rate: SCALE_PERCENT,
  start_delay_rate: SCALE_PERCENT, sharePercent: SCALE_PERCENT, dropPercent: SCALE_PERCENT,
  completed_count: SCALE_COUNT, total_count: SCALE_COUNT, learning_count: SCALE_COUNT,
  read_count: SCALE_COUNT, count: SCALE_COUNT,
  completionRate: SCALE_PERCENT, completedCount: SCALE_COUNT, totalCount: SCALE_COUNT,
  learningRate: SCALE_PERCENT, learningCount: SCALE_COUNT,
};

function metricScale(key) {
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  return METRIC_SCALE_MAP[key] || METRIC_SCALE_MAP[snake] || SCALE_OTHER;
}

function splitMetricsByScale(metrics) {
  const groups = {};
  for (const m of metrics) {
    const s = metricScale(m);
    if (!groups[s]) groups[s] = [];
    groups[s].push(m);
  }
  return groups;
}

// ─── Builder ───────────────────────────────────────────────────────────

function buildRanking(rows, dims, metrics, shortId) {
  const dimKey = dims[0];
  const metricKey = metrics.find((m) => m.includes('rate') || m.includes('completion')) || metrics[0];
  if (!dimKey || !metricKey) return null;

  const sorted = [...rows]
    .filter((r) => {
      const v = getMetricValue(r, metricKey);
      return Number.isFinite(v);
    })
    .sort((a, b) => getMetricValue(a, metricKey) - getMetricValue(b, metricKey))
    .slice(0, 12);

  if (sorted.length === 0) return null;

  const isDistribution = sorted.length <= 6;

  return {
    id: `rank_${shortId}`,
    kind: 'ranking',
    title: `${labelOf(dimKey)}排名`,
    preferChartType: isDistribution ? 'pie' : 'bar',
    xAxis: sorted.map((r) => getDimValue(r, dimKey).slice(0, 20)),
    series: [{
      name: labelOf(metricKey),
      data: sorted.map((r) => getMetricValue(r, metricKey)),
    }],
    rawRows: sorted.slice(0, 8),
  };
}

function buildFunnel(meta) {
  if (!meta?.completion_funnel?.stages || !Array.isArray(meta.completion_funnel.stages)) return null;
  const stages = meta.completion_funnel.stages;
  if (stages.length < 2) return null;

  return {
    id: `funnel_${stages[0]?.stage || 'main'}`,
    kind: 'funnel',
    title: '学习完成漏斗',
    preferChartType: 'pie',
    xAxis: stages.map((s) => s.label || s.stage),
    series: [{
      name: '人数',
      data: stages.map((s) => s.count || 0),
    }],
    rawRows: stages,
  };
}

function buildTrend(rows, dims, metrics, shortId) {
  const timeDim = dims.find((d) => ['day', 'date', 'month', 'week'].includes(d));
  const metricKey = metrics[0];
  if (!timeDim || !metricKey) return null;

  const points = rows
    .filter((r) => {
      const v = getMetricValue(r, metricKey);
      return Number.isFinite(v);
    })
    .sort((a, b) => String(getDimValue(a, timeDim)).localeCompare(String(getDimValue(b, timeDim))));

  if (points.length < 2) return null;

  return {
    id: `trend_${shortId}`,
    kind: 'trend',
    title: '趋势变化',
    preferChartType: 'line',
    xAxis: points.map((r) => getDimValue(r, timeDim)),
    series: [{
      name: labelOf(metricKey),
      data: points.map((r) => getMetricValue(r, metricKey)),
    }],
    rawRows: points,
  };
}

function buildComparison(rows, dims, metrics, shortId, opts = {}) {
  if (dims.length < 1 || metrics.length < 1) return null;
  const dimKey = dims[0];
  const metricKeys = metrics.slice(0, 4);
  if (rows.length < 2) return null;

  const scaleGroup = opts.scaleGroup || SCALE_OTHER;
  const isCountScale = scaleGroup === SCALE_COUNT;
  const isMixed = scaleGroup === 'mixed';
  const hasSingles = metrics.length === 1;
  const titleSuffix = hasSingles
    ? `（${labelOf(metrics[0])}）`
    : isCountScale ? '（人数）' : isMixed ? '（多量纲）' : '（比率）';

  const xAxis = rows.map((r) => getDimValue(r, dimKey).slice(0, 20));
  const series = metricKeys.map((mk) => {
    const mkScale = metricScale(mk);
    const s = {
      name: labelOf(mk),
      data: rows.map((r) => getMetricValue(r, mk)),
    };
    if (isMixed && mkScale === SCALE_COUNT) s.yAxisIndex = 1;
    else if (isCountScale) s.yAxisIndex = 1;
    return s;
  });

  return {
    id: `cmp_${scaleGroup}_${shortId}`,
    kind: 'comparison',
    title: `指标对比${titleSuffix}`,
    preferChartType: 'bar',
    xAxis,
    series,
    rawRows: rows.slice(0, 8),
  };
}

// ─── Main Export ──────────────────────────────────────────────────────

function extractPlottableData(toolResults) {
  const datasets = normalizeToolResults(toolResults);
  const plottable = [];

  for (const ds of datasets) {
    if (ds.rows.length === 0) continue;
    const dims = detectDimensionNames(ds.rows);
    const metrics = detectMetricNames(ds.rows);
    const shortId = ds.id.slice(-8);
    const meta = ds.meta?.data || ds.meta;
    const funnelSrc = meta?.completion_funnel || ds.meta?.data?.completion_funnel || ds.meta?.completion_funnel;

    // Funnel — 不依赖 metrics（漏斗数据嵌在 summary 里，不是 row 级别指标）
    if (funnelSrc?.stages?.length > 0) {
      const funnel = buildFunnel({ completion_funnel: funnelSrc });
      if (funnel) plottable.push(funnel);
    }

    if (metrics.length === 0 && ds.rows.length <= 1 && !funnelSrc) continue;

    // Ranking (有维度 + 有指标)
    if (dims.length > 0 && metrics.length > 0) {
      const ranking = buildRanking(ds.rows, dims, metrics, shortId);
      if (ranking) plottable.push(ranking);
    }

    // Trend (有时间维度)
    const timeDims = dims.filter((d) => ['day', 'date', 'month', 'week'].includes(d));
    if (timeDims.length > 0 && metrics.length > 0 && ds.rows.length >= 2) {
      const trend = buildTrend(ds.rows, dims, metrics, shortId);
      if (trend) plottable.push(trend);
    }

    // Comparison (多维度 + 多指标) — 按量纲分组，避免百分比和人数混合
    if (dims.length >= 1 && metrics.length >= 2 && ds.rows.length >= 2) {
      const scaleGroups = splitMetricsByScale(metrics);
      const usedMetrics = new Set();
      // Rule 1: 每量纲组 >= 2 个同纲指标 → 单独成图
      for (const [scale, groupMetrics] of Object.entries(scaleGroups)) {
        if (groupMetrics.length >= 2) {
          const cmp = buildComparison(ds.rows, dims, groupMetrics, shortId, { scaleGroup: scale });
          if (cmp) { plottable.push(cmp); groupMetrics.forEach(m => usedMetrics.add(m)); }
        }
      }
      // Rule 2: 剩余未使用的指标，跨量纲合并到混合图（双Y轴）
      const leftoverMetrics = metrics.filter(m => !usedMetrics.has(m));
      if (leftoverMetrics.length >= 1) {
        // 单指标也出图（可能和主图互补，如比率图+人数图）
        const cmp = buildComparison(ds.rows, dims, leftoverMetrics, shortId, { scaleGroup: 'mixed' });
        if (cmp) plottable.push(cmp);
      }
    }

    // 单条对象也当作 row 提取，避免漏掉（无 metrics 时也能进到这里）
    if (plottable.length === 0 && ds.rows.length === 1) {
      const row = ds.rows[0];
      const kvEntries = Object.entries(row)
        .filter(([k]) => !k.startsWith('_') && k !== 'error' && k !== 'success' && typeof row[k] !== 'object')
        .slice(0, 10);
      if (kvEntries.length >= 2) {
        plottable.push({
          id: `kv_${shortId}`,
          kind: 'comparison',
          title: '查询结果概览',
          xAxis: kvEntries.map(([k]) => labelOf(k)),
          series: [{ name: '值', data: kvEntries.map(([, v]) => Number(v) || 0) }],
          rawRows: [row],
        });
      }
    }
  }

  return plottable;
}

module.exports = { extractPlottableData };
