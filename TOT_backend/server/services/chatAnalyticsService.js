'use strict';

const mysqlCrud = require('../modules/dashboard/crud/dashboardMysqlCrud');
const { fetchTaskContext, classifyStatus, completionTimeHours } = require('../modules/dashboard/services/queryEngine');

const SUPPORTED_ANALYSIS_TYPES = new Set([
  'quantile_duration',
  'completion_time_distribution',
  'metric_correlation',
  'progress_variance_by_channel',
  'completion_rate_forecast',
  'trimmed_mean_duration',
]);

function filterByRegionScope(queues, regionScope) {
  if (!regionScope || regionScope.type === 'national') return queues;
  if (regionScope.type === 'regional') {
    if (!regionScope.regions || regionScope.regions.length === 0) return [];
    const allowed = new Set(regionScope.regions);
    return queues.filter(q => allowed.has(q.sub_region_code));
  }
  if (regionScope.type === 'rtm' && regionScope.rtm) {
    return queues.filter(q => q.rtm4_name === regionScope.rtm);
  }
  return queues;
}

async function fetchAggregatedData(args, regionScope) {
  let tasks = [];
  if (args.taskId) {
    const t = await mysqlCrud.getTaskById(args.taskId);
    if (t) tasks.push(t);
  } else {
    tasks = await mysqlCrud.getActiveDispatchedTasks();
  }

  let allQueues = [];
  const drill = {};
  if (args.storeId) drill.storeId = args.storeId;
  if (args.region) drill.format = args.region; 

  const contexts = await Promise.all(tasks.map(t => fetchTaskContext(t.task_publish_id, drill)));

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const ctx = contexts[i];
    const queues = filterByRegionScope(ctx.queues, regionScope);

    for (const q of queues) {
      const status = classifyStatus(q.email_id, ctx.mpsRows);
      
      let durationHours = null;
      let completedAtMs = null;
      if (status === 'completed') {
         durationHours = completionTimeHours(t, ctx.mpsRows, q.email_id);
         const learnerRows = ctx.mpsRows.filter(r => r.email_id === q.email_id && r.required_flag === 1 && r.passed_time);
         if (learnerRows.length > 0) {
           completedAtMs = Math.max(...learnerRows.map(r => new Date(r.passed_time).getTime()));
         }
      }

      allQueues.push({
        status,
        duration_hours: durationHours,
        completed_at_ms: completedAtMs,
        progress: status === 'completed' ? 100 : (status === 'pending' ? 0 : 50),
        nudge_count: 0, 
        channel: q.rtm4_name || 'UNKNOWN',
      });
    }
  }

  return allQueues;
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

async function runQuantileDuration(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);
  const durations = allQueues
    .filter(q => q.status === 'completed' && q.duration_hours !== null)
    .map(q => q.duration_hours);

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

async function runCompletionTimeDistribution(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);
  const durations = allQueues
    .filter(q => q.status === 'completed' && q.duration_hours !== null)
    .map(q => q.duration_hours);

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

async function runMetricCorrelation(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);
  const pairs = allQueues
    .filter(q => q.status === 'completed')
    .map(q => ({ x: q.nudge_count, y: q.progress }));

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

async function runProgressVarianceByChannel(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);

  if (!allQueues.length) {
    return {
      analysisType: 'progress_variance_by_channel',
      sampleSize: 0,
      variance: null,
      channels: [],
      note: '当前筛选条件下无可用渠道样本。',
    };
  }

  const byChannel = new Map();
  for (const q of allQueues) {
    const ch = q.channel;
    if (!byChannel.has(ch)) byChannel.set(ch, { total: 0, completed: 0 });
    const st = byChannel.get(ch);
    st.total++;
    if (q.status === 'completed') st.completed++;
  }

  const channels = [];
  for (const [channel, st] of byChannel.entries()) {
    channels.push({
      channel,
      completionRate: Number(((st.completed / st.total) * 100).toFixed(2)),
      totalCount: st.total,
    });
  }

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

async function runCompletionRateForecast(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);

  const total = allQueues.length;
  const completed = allQueues.filter(q => q.status === 'completed').length;

  if (!total) {
    return {
      analysisType: 'completion_rate_forecast',
      sampleSize: 0,
      forecastCompletionRate: null,
      note: '当前筛选条件下无样本，无法预测。',
    };
  }

  const recentCompleted = allQueues.filter(q => {
    if (q.status !== 'completed' || !q.completed_at_ms) return false;
    return (Date.now() - q.completed_at_ms) <= 24 * 60 * 60 * 1000;
  }).length;

  const avgCompletedPerHour = recentCompleted / 24;

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

async function runTrimmedMeanDuration(args, regionScope) {
  const allQueues = await fetchAggregatedData(args, regionScope);
  const durations = allQueues
    .filter(q => q.status === 'completed' && q.duration_hours !== null)
    .map(q => q.duration_hours)
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

async function runAnalysis(args, regionScope) {
  const analysisType = args.analysisType;
  if (!SUPPORTED_ANALYSIS_TYPES.has(analysisType)) {
    throw new Error(`Unsupported analysisType: ${analysisType}`);
  }

  switch (analysisType) {
    case 'quantile_duration':
      return await runQuantileDuration(args, regionScope);
    case 'completion_time_distribution':
      return await runCompletionTimeDistribution(args, regionScope);
    case 'metric_correlation':
      return await runMetricCorrelation(args, regionScope);
    case 'progress_variance_by_channel':
      return await runProgressVarianceByChannel(args, regionScope);
    case 'completion_rate_forecast':
      return await runCompletionRateForecast(args, regionScope);
    case 'trimmed_mean_duration':
      return await runTrimmedMeanDuration(args, regionScope);
    default:
      return formatUnsupported(analysisType);
  }
}

module.exports = {
  SUPPORTED_ANALYSIS_TYPES,
  runAnalysis,
};