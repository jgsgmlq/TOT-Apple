'use strict';

/**
 * 从 toolResults 中提取所有可画图的结构化数据集。
 * 纯函数，零 LLM 参与，同一输入永远返回相同输出。
 *
 * 返回 [{ id, kind, title, rows/points/stages, dimensions, metrics }]
 * - kind: "ranking" | "trend" | "funnel" | "comparison" | "distribution"
 * - id: 稳定标识符，供 LLM 在 selectedCharts 中引用
 */

// ─── 解析 ────────────────────────────────────────────────────────────

function safeParse(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function flattenRows(toolResults) {
  const datasets = [];
  for (const [callId, entry] of Object.entries(toolResults || {})) {
    if (!entry || entry.error) continue;
    const parsed = safeParse(entry.data);
    if (!parsed) continue;

    // { data: [...] }
    if (Array.isArray(parsed.data)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed.data, meta: parsed });
      continue;
    }
    // { data: { ... } } 单条对象
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: [parsed.data], meta: parsed });
      continue;
    }
    // 裸 array
    if (Array.isArray(parsed)) {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: parsed, meta: {} });
      continue;
    }
    // 裸对象
    if (typeof parsed === 'object') {
      datasets.push({ id: callId, toolName: entry.toolName || '', rows: [parsed], meta: parsed });
    }
  }
  return datasets;
}

// ─── 数据集检测 ────────────────────────────────────────────────────────

function detectMetricNames(rows) {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const candidates = [
    'completion_rate', 'completionRate', 'completed_count', 'completedCount',
    'total_count', 'totalCount', 'learning_rate', 'crisis_p0_rate', 'crisis_p1_rate',
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
    'day', 'date', 'month', 'week', 'stage', 'metric', 'dimension',
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
    title: `${dimKey === 'store' || dimKey === 'store_name' ? '门店' : dimKey}完成率排名`,
    preferChartType: isDistribution ? 'pie' : 'bar',
    xAxis: sorted.map((r) => getDimValue(r, dimKey).slice(0, 12)),
    series: [{
      name: metricKey,
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
    preferChartType: 'funnel',
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
      name: metricKey,
      data: points.map((r) => getMetricValue(r, metricKey)),
    }],
    rawRows: points,
  };
}

function buildComparison(rows, dims, metrics, shortId) {
  if (dims.length < 2 || metrics.length < 1) return null;
  const dimKey = dims[0];
  const metricKeys = metrics.slice(0, 3);
  if (rows.length < 2) return null;

  const xAxis = rows.map((r) => getDimValue(r, dimKey).slice(0, 12));
  const series = metricKeys.map((mk) => ({
    name: mk,
    data: rows.map((r) => getMetricValue(r, mk)),
  }));

  return {
    id: `cmp_${shortId}`,
    kind: 'comparison',
    title: '指标对比',
    preferChartType: 'bar',
    xAxis,
    series,
    rawRows: rows.slice(0, 8),
  };
}

// ─── Main Export ──────────────────────────────────────────────────────

const KIND_BUILDERS = [
  { detect: (_, meta) => meta?.completion_funnel?.stages?.length > 0, build: (rows, dims, metrics, meta, shortId) => buildFunnel(meta) },
  { detect: (rows, _, __, ___) => rows.length >= 2, build: (rows, dims, metrics, meta, shortId) => buildRanking(rows, dims, metrics, shortId) },
];

function extractPlottableData(toolResults) {
  const datasets = flattenRows(toolResults);
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

    // Comparison (多维度 + 多指标)
    if (dims.length >= 1 && metrics.length >= 2 && ds.rows.length >= 2) {
      const cmp = buildComparison(ds.rows, dims, metrics, shortId);
      if (cmp) plottable.push(cmp);
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
          xAxis: kvEntries.map(([k]) => k),
          series: [{ name: '值', data: kvEntries.map(([, v]) => Number(v) || 0) }],
          rawRows: [row],
        });
      }
    }
  }

  return plottable;
}

module.exports = { extractPlottableData };
