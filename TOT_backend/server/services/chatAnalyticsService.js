'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

const SUPPORTED_ANALYSIS_TYPES = new Set([
  'quantile_duration',
  'completion_time_distribution',
  'metric_correlation',
  'progress_variance_by_channel',
  'completion_rate_forecast',
  'trimmed_mean_duration',
]);

function buildAssignmentWhere(args, regionScope) {
  const filter = buildRegionFilter(regionScope);
  const clauses = ["t.status = 'dispatched'"];
  const params = [];

  if (args.taskId) {
    clauses.push('ta.task_id = ?');
    params.push(args.taskId);
  }
  if (args.region) {
    clauses.push('s.region = ?');
    params.push(args.region);
  }
  if (args.storeId) {
    clauses.push('ta.store_id = ?');
    params.push(args.storeId);
  }

  return {
    sql: `${clauses.join(' AND ')} ${filter.sql}`.trim(),
    params: [...params, ...filter.params],
  };
}

function computeQuantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function computeCorrelation(pairs) {
  if (!pairs.length) return null;
  const n = pairs.length;
  const sumX = pairs.reduce((acc, p) => acc + p.x, 0);
  const sumY = pairs.reduce((acc, p) => acc + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (const { x, y } of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX === 0 || denomY === 0) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

function formatUnsupported(analysisType) {
  return {
    analysisType,
    status: 'not_open',
    ecTier: 'EC-P1',
    message: `${analysisType} 已纳入后续批次，当前环境暂未开放。`,
    recommendation: '可先查询 EC-P0 的分位数、分布、相关性结果。',
  };
}

function fetchDurationRows(args, regionScope) {
  const where = buildAssignmentWhere(args, regionScope);
  return db.all(
    `SELECT
       ta.id,
       ta.progress,
       ta.nudge_count,
       ta.store_id,
       s.region,
       s.rtm,
       (
         julianday(ta.completed_at) - julianday(COALESCE(ta.started_at, ta.received_at, ta.created_at))
       ) * 24.0 AS duration_hours
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN stores s ON s.id = ta.store_id
     WHERE ${where.sql}
       AND ta.status = 'completed'
       AND ta.completed_at IS NOT NULL`,
    where.params
  );
}

function runQuantileDuration(args, regionScope) {
  const rows = fetchDurationRows(args, regionScope);
  const durations = rows
    .map((r) => Number(r.duration_hours))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (!durations.length) {
    return {
      analysisType: 'quantile_duration',
      sampleSize: 0,
      p90Hours: null,
      minHours: null,
      maxHours: null,
      note: '当前筛选条件下无可用完成时长样本。',
    };
  }

  return {
    analysisType: 'quantile_duration',
    sampleSize: durations.length,
    p90Hours: Number(computeQuantile(durations, 0.9).toFixed(2)),
    minHours: Number(Math.min(...durations).toFixed(2)),
    maxHours: Number(Math.max(...durations).toFixed(2)),
  };
}

function runCompletionTimeDistribution(args, regionScope) {
  const rows = fetchDurationRows(args, regionScope);
  const durations = rows
    .map((r) => Number(r.duration_hours))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const buckets = [
    { label: '0-4h', min: 0, max: 4, count: 0 },
    { label: '4-8h', min: 4, max: 8, count: 0 },
    { label: '8-24h', min: 8, max: 24, count: 0 },
    { label: '24h+', min: 24, max: Infinity, count: 0 },
  ];

  for (const d of durations) {
    const b = buckets.find((bucket) => d >= bucket.min && d < bucket.max);
    if (b) b.count += 1;
  }

  return {
    analysisType: 'completion_time_distribution',
    sampleSize: durations.length,
    buckets: buckets.map((b) => ({
      label: b.label,
      count: b.count,
      ratio: durations.length ? Number((b.count / durations.length).toFixed(4)) : 0,
    })),
  };
}

function runMetricCorrelation(args, regionScope) {
  const rows = fetchDurationRows(args, regionScope);
  const pairs = rows
    .map((r) => ({
      x: Number(r.nudge_count),
      y: Number(r.progress),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const corr = computeCorrelation(pairs);
  return {
    analysisType: 'metric_correlation',
    metricX: 'nudge_count',
    metricY: 'progress',
    sampleSize: pairs.length,
    pearsonCorrelation: corr === null ? null : Number(corr.toFixed(4)),
    interpretation:
      corr === null
        ? '样本不足或无波动，无法计算相关性。'
        : corr > 0
          ? '正相关'
          : corr < 0
            ? '负相关'
            : '近似无相关',
  };
}

function runProgressVarianceByChannel(args, regionScope) {
  const where = buildAssignmentWhere(args, regionScope);
  const rows = db.all(
    `SELECT
       COALESCE(s.rtm, 'UNKNOWN') AS channel,
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN stores s ON s.id = ta.store_id
     WHERE ${where.sql}
     GROUP BY COALESCE(s.rtm, 'UNKNOWN')`,
    where.params
  );

  if (!rows.length) {
    return {
      analysisType: 'progress_variance_by_channel',
      sampleSize: 0,
      variance: null,
      channels: [],
      note: '当前筛选条件下无可用渠道样本。',
    };
  }

  const channels = rows.map((r) => ({
    channel: r.channel,
    completionRate: Number(((Number(r.completed || 0) / Number(r.total || 1)) * 100).toFixed(2)),
    totalCount: Number(r.total),
  }));
  const mean = channels.reduce((acc, c) => acc + c.completionRate, 0) / channels.length;
  const variance = channels.reduce((acc, c) => acc + ((c.completionRate - mean) ** 2), 0) / channels.length;

  return {
    analysisType: 'progress_variance_by_channel',
    sampleSize: channels.length,
    meanCompletionRate: Number(mean.toFixed(2)),
    variance: Number(variance.toFixed(4)),
    channels,
  };
}

function runCompletionRateForecast(args, regionScope) {
  const where = buildAssignmentWhere(args, regionScope);
  const base = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN stores s ON s.id = ta.store_id
     WHERE ${where.sql}`,
    where.params
  );

  const total = Number(base?.total || 0);
  const completed = Number(base?.completed || 0);
  if (!total) {
    return {
      analysisType: 'completion_rate_forecast',
      sampleSize: 0,
      forecastCompletionRate: null,
      note: '当前筛选条件下无样本，无法预测。',
    };
  }

  // use trailing 24h completion velocity as naive forecast baseline
  const velocityRows = db.all(
    `SELECT strftime('%Y-%m-%d %H:00:00', ta.completed_at) AS hourBucket, COUNT(*) AS completedCount
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN stores s ON s.id = ta.store_id
     WHERE ${where.sql}
       AND ta.status = 'completed'
       AND ta.completed_at >= datetime('now', '-24 hours', 'localtime')
     GROUP BY hourBucket`,
    where.params
  );
  const totalRecentCompleted = velocityRows.reduce((acc, r) => acc + Number(r.completedCount || 0), 0);
  const avgCompletedPerHour = velocityRows.length ? (totalRecentCompleted / 24) : 0;

  const forecastTarget = args.targetTime
    ? new Date(args.targetTime)
    : new Date(new Date().setHours(23, 59, 59, 999));
  const hoursLeft = Math.max(0, (forecastTarget.getTime() - Date.now()) / (1000 * 60 * 60));
  const predictedCompleted = Math.min(total, completed + avgCompletedPerHour * hoursLeft);
  const rate = total ? (predictedCompleted / total) * 100 : null;

  return {
    analysisType: 'completion_rate_forecast',
    sampleSize: total,
    currentCompletionRate: Number(((completed / total) * 100).toFixed(2)),
    forecastCompletionRate: rate === null ? null : Number(rate.toFixed(2)),
    assumption: '使用最近24小时完成速度做线性外推，仅供运营预估。',
  };
}

function runTrimmedMeanDuration(args, regionScope) {
  const rows = fetchDurationRows(args, regionScope);
  const durations = rows
    .map((r) => Number(r.duration_hours))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  if (!durations.length) {
    return {
      analysisType: 'trimmed_mean_duration',
      sampleSize: 0,
      trimmedMeanHours: null,
      trimRatio: 0.05,
      note: '当前筛选条件下无可用完成时长样本。',
    };
  }

  const trimRatio = Math.max(0, Math.min(0.2, Number(args.trimRatio || 0.05)));
  const trimCount = Math.floor(durations.length * trimRatio);
  const trimmed = durations.slice(trimCount, durations.length - trimCount || durations.length);
  const mean = trimmed.reduce((acc, n) => acc + n, 0) / trimmed.length;

  return {
    analysisType: 'trimmed_mean_duration',
    sampleSize: durations.length,
    trimmedSampleSize: trimmed.length,
    trimRatio,
    trimmedMeanHours: Number(mean.toFixed(2)),
  };
}

function runAnalysis(args, regionScope) {
  const analysisType = args.analysisType;
  if (!SUPPORTED_ANALYSIS_TYPES.has(analysisType)) {
    throw new Error(`Unsupported analysisType: ${analysisType}`);
  }

  switch (analysisType) {
    case 'quantile_duration':
      return runQuantileDuration(args, regionScope);
    case 'completion_time_distribution':
      return runCompletionTimeDistribution(args, regionScope);
    case 'metric_correlation':
      return runMetricCorrelation(args, regionScope);
    case 'progress_variance_by_channel':
      return runProgressVarianceByChannel(args, regionScope);
    case 'completion_rate_forecast':
      return runCompletionRateForecast(args, regionScope);
    case 'trimmed_mean_duration':
      return runTrimmedMeanDuration(args, regionScope);
    default:
      return formatUnsupported(analysisType);
  }
}

module.exports = {
  SUPPORTED_ANALYSIS_TYPES,
  runAnalysis,
};
