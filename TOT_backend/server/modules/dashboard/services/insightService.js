'use strict';

const { nanoid } = require('nanoid');
const crud = require('../crud/dashboardCrud');
const { formatLocalDateYYYYMMDD } = require('../../common/utils/ddlAt');
const { parseStoreDrill } = require('../../common/utils/storeDrill');
const { generateTextDeepSeekStream } = require('../../common/utils/ai');
const { writeSseHeaders, createSseSender } = require('../../common/utils/sseResponse');
const { createError } = require('../../common/middleware/errorHandler');
const { computeAssignmentWarningRates } = require('../../common/utils/dashboardWarningRates');

const MODULE_TYPES = [
  'north_star', 'completion_weekly', 'completion_daily',
  'channel_north_star', 'funnel_alerts', 'conversion_funnel',
];
const INSIGHT_TYPES = [
  'north_star', 'completion_weekly', 'completion_daily',
  'channel_north_star', 'funnel_alerts', 'conversion_funnel',
];

function normalizeQuery(body) {
  return {
    rtm: body.rtm,
    format: body.format,
    dealerName: body.dealerName,
    storeId: body.storeId,
  };
}

function toPct(numerator, denominator, digits = 2) {
  if (!denominator || denominator <= 0) return 0;
  return Number(((100 * numerator) / denominator).toFixed(digits));
}

function toMedian(nums) {
  if (!nums || nums.length === 0) return 0;
  const arr = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) return Number(((arr[mid - 1] + arr[mid]) / 2).toFixed(2));
  return Number(arr[mid].toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Facts builders（数据通过 crud 获取，本层只做业务拼装）
// ═══════════════════════════════════════════════════════════════════════════════

function buildNorthStarFacts(body) {
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));

  const base = crud.queryAssignmentBaseAgg({ taskId, drill });
  const total = base ? base.total || 0 : 0;
  const notStarted = base ? base.pending_count || 0 : 0;
  const inProgress = base ? base.in_progress_count || 0 : 0;
  const completed = base ? base.completed_count || 0 : 0;
  const onTime = base ? base.completed_on_time_count || 0 : 0;
  const completionRate = toPct(completed, total);
  const onTimeRate = toPct(onTime, total);
  const avgH = base && base.avg_completion_time_hours != null ? Number(base.avg_completion_time_hours.toFixed(1)) : 0;
  const task = taskId ? crud.getTaskById(taskId) : null;
  const overdue = crud.countOverdueAssignments({ taskId, drill });

  return {
    scope: taskId ? `taskId=${taskId}` : '全任务汇总',
    taskId: taskId || null,
    taskName: task ? task.title : null,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    totalCount: total,
    notStartedCount: notStarted,
    inProgressCount: inProgress,
    completedCount: completed,
    overdueCount: overdue,
    completionRate,
    onTimeRate,
    avgCompletionHours: avgH,
  };
}

function buildFunnelFacts(body) {
  const baseFacts = buildNorthStarFacts(body);
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));
  const total = baseFacts.totalCount;

  const push = crud.countPushUsers({ taskId, drill });
  const reads = crud.countReadUsers({ taskId, drill, source: 'task_detail_open' });
  const reachedCount = crud.countReachedAssignments({ taskId, drill });
  const nudgeRow = crud.queryNudgeStats({ taskId, drill });
  const assignRows = crud.queryAssignmentDetails({ taskId, drill });
  const wr = computeAssignmentWarningRates(assignRows, total, Date.now());

  return {
    ...baseFacts,
    totalAssignments: total,
    taskReachRate: toPct(reachedCount, total),
    taskReadRate: toPct(reads, total),
    nudgeConversionRate: toPct(
      (nudgeRow && nudgeRow.converted_nudged) || 0,
      (nudgeRow && nudgeRow.total_nudged) || 0
    ),
    crisisP2Rate: wr.crisisP2Rate,
    crisisP1Rate: wr.crisisP1Rate,
    crisisP0Rate: wr.crisisP0Rate,
    pushUserCount: push,
    readUserDistinct: reads,
  };
}

function buildWeeklyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_weekly 需要 taskId', 'INSIGHT_001');
  const drill = parseStoreDrill(normalizeQuery(body));
  const task = crud.getTaskById(taskId);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  const total = crud.queryAssignmentScopeCount({ taskId, drill });
  const rows = crud.queryDailyCompletions({ taskId, drill, completedAtExpr: 'ta.completed_at' });
  const latestRows = rows.slice(-7);
  let cumulative = 0;
  const progressData = latestRows.map((r, idx) => {
    cumulative += r.new_completed || 0;
    return {
      day: `第${idx + 1}天`,
      new_completions: r.new_completed || 0,
      cumulative_completions: cumulative,
    };
  });
  return {
    taskName: task.title, taskId,
    totalUsers: total,
    currentDay: progressData.length,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    progressData,
  };
}

function buildDailyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_daily 需要 taskId', 'INSIGHT_001');
  const targetDate = body.date || formatLocalDateYYYYMMDD();
  const drill = parseStoreDrill(normalizeQuery(body));
  const task = crud.getTaskById(taskId);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  const total = crud.queryAssignmentScopeCount({ taskId, drill });
  const rows = crud.queryHourlyCompletions({ taskId, drill, date: targetDate, completedAtExpr: 'ta.completed_at' });
  const byHour = {};
  for (const r of rows) byHour[Number(r.time_key)] = r.new_completed || 0;

  let cumulative = 0;
  const progressData = [];
  for (let h = 0; h < 24; h += 2) {
    const n = (byHour[h] || 0) + (byHour[h + 1] || 0);
    cumulative += n;
    const pad = (v) => String(v).padStart(2, '0');
    progressData.push({
      time_slot: `${pad(h)}:00-${pad(h + 2)}:00`,
      new_completions: n,
      cumulative_completions: cumulative,
    });
  }

  return {
    taskName: task.title, taskId,
    totalUsers: total,
    targetDate,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    intradayProgressData: progressData,
  };
}

function buildHeatmapRankFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'heatmap_rank 模块需要 taskId', 'INSIGHT_001');
  const drill = parseStoreDrill(normalizeQuery(body));
  const rtmLevel = (body.rtmLevel || 'rtm').toLowerCase();
  const { selectDim, groupByDim } = crud.buildDimensionSelect(rtmLevel, 'dim');

  const heatRows = crud.queryAssignmentGroupedAgg({
    taskId, drill, selectDim, groupByDim,
    orderBy: 'ORDER BY rate DESC',
  });

  const rankTop = crud.queryStoreRank({ taskId, drill, order: 'DESC', limit: 3 });
  const rankBottom = crud.queryStoreRank({ taskId, drill, order: 'ASC', limit: 3 });

  return {
    taskId,
    rtmLevel: body.rtmLevel || 'rtm',
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    heatmapBuckets: heatRows.map((r) => ({
      name: r.dim || '(未知)',
      assignmentCount: r.assignment_count,
      completionRate: r.completion_rate,
    })),
    topStores: rankTop.map((r) => ({
      storeId: r.store_id, storeName: r.store_name,
      completionRate: r.rate, assignmentCount: r.n,
    })),
    bottomStores: rankBottom.map((r) => ({
      storeId: r.store_id, storeName: r.store_name,
      completionRate: r.rate, assignmentCount: r.n,
    })),
  };
}

function buildWarningStatsFacts(body) {
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));

  const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const subRows = crud.queryWarningAggregate({ taskId, drill, level: 'store', nowIso });
  let p1 = 0;
  let p2 = 0;
  const ddlNow = new Date();
  for (const r of subRows) {
    const rate = r.completion_rate || 0;
    const hoursLeft = (new Date(r.ddl_at) - ddlNow) / 3600000;
    const isP1 = rate < 50 || (rate < 80 && hoursLeft < 24);
    if (isP1) p1++;
    else if (rate < 80) p2++;
  }

  const funnel = buildFunnelFacts(body);
  return {
    taskId,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    warningStoreRowsUnder80: subRows.length,
    estimatedP1Buckets: p1,
    estimatedP2Buckets: p2,
    funnelSnapshot: {
      completionRate: funnel.completionRate,
      onTimeCompletionRate: funnel.onTimeCompletionRate,
      overdueCount: funnel.overdueCount,
    },
  };
}

function buildChannelNorthStarFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'channel_north_star 需要 taskId', 'INSIGHT_001');
  const drill = parseStoreDrill(normalizeQuery(body));
  const channelRows = crud.queryChannelStats({ taskId, drill });

  const channels = ['Multibrand', 'Monobrand', 'Enterprise', 'Education', 'Carrier'];
  const channelData = {};
  const rates = [];
  const mins = [];
  for (const ch of channels) {
    const row = channelRows.find((r) => (r.channel || '') === ch);
    const rate = row ? toPct(row.on_time_count || 0, row.total_count || 0, 1) : 0;
    const avgMin = row && row.avg_minutes != null ? Number(row.avg_minutes.toFixed(1)) : 0;
    channelData[ch] = {
      completion_rate: `${rate.toFixed(1)}%`,
      completion_time_minutes: avgMin,
      sample_size: row ? row.total_count : 0,
    };
    rates.push(rate);
    mins.push(avgMin);
  }

  const meanRate = rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)) : 0;
  const meanMin = mins.length ? Number((mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)) : 0;

  return {
    taskId,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    overall_statistics: {
      completion_rate: { mean: `${meanRate.toFixed(1)}%`, median: `${toMedian(rates).toFixed(1)}%` },
      completion_time_minutes: { mean: meanMin, median: toMedian(mins) },
    },
    channel_data: channelData,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Insight generation & persistence
// ═══════════════════════════════════════════════════════════════════════════════

function resolveInsightType(body) {
  const raw = (body.insightType || '').trim();
  if (INSIGHT_TYPES.includes(raw)) return raw;
  if (body.module === 'funnel') return 'north_star';
  if (body.module === 'conversion_funnel') return 'conversion_funnel';
  if (body.module === 'trend') {
    return body.trendType === 'hourly' ? 'completion_daily' : 'completion_weekly';
  }
  if (body.module === 'heatmap_rank') return 'channel_north_star';
  if (body.module === 'warning_stats') return 'funnel_alerts';
  return '';
}

function buildPromptByInsightType(insightType, facts) {
  if (insightType === 'north_star') {
    return {
      system: '你是资深零售培训运营专家。只基于输入数据输出客观洞察；禁止建议、禁止行动方案、禁止编造数据。',
      user: `请围绕"按时完成率、人均完成耗时"输出结构化洞察，150字以内，含少量 emoji。\n数据：${JSON.stringify(facts, null, 2)}`,
      options: { maxTokens: 500, temperature: 0.25 },
    };
  }
  if (insightType === 'completion_weekly') {
    return {
      system: '你是资深零售数据分析师。只做现状分析与归因诊断，禁止任何建议、优化策略、行动指导。',
      user:
        `请按以下结构输出：\n` +
        `### 📊 进度健康度诊断\n### 📈 数据趋势特征解析\n### 🔍 深层业务归因推测\n` +
        `数据：${JSON.stringify(facts, null, 2)}`,
      options: { maxTokens: 1100, temperature: 0.2 },
    };
  }
  if (insightType === 'completion_daily') {
    return {
      system: '你是资深零售数据分析师。只做时段分布与归因诊断，禁止建议，禁止评估催办效果。',
      user:
        `请按以下结构输出：\n` +
        `### 📊 时段分布与集中度特征\n### 🔍 深层业务归因推测\n` +
        `数据：${JSON.stringify(facts, null, 2)}`,
      options: { maxTokens: 900, temperature: 0.2 },
    };
  }
  if (insightType === 'channel_north_star') {
    return {
      system: '你是资深B端业务分析专家。基于中位数与均值相对比较做归因；禁止建议、禁止催办分析。',
      user:
        `请严格按结构输出：\n` +
        `## 📊 核心业务洞察 (Business Insights)\n` +
        `## 🔍 深度现象归因 (Deep Attribution)\n` +
        `数据：${JSON.stringify(facts, null, 2)}`,
      options: { maxTokens: 1200, temperature: 0.2 },
    };
  }
  if (insightType === 'conversion_funnel') {
    return {
      system: '你是资深零售漏斗转化分析师。只分析漏斗各层级转化率（推送->阅读->在学->完课），禁止建议、禁止评估催办预警。',
      user: `请严格按结构输出：\n### 📊 核心转化漏斗特征\n### 🔍 转化流失节点深度归因\n数据：${JSON.stringify(facts, null, 2)}`,
      options: { maxTokens: 800, temperature: 0.2 },
    };
  }
  return {
    system: '你是资深零售预警与催办数据分析师。只基于输入数据输出客观洞察与归因，禁止建议，聚焦逾期、各级预警率及催办有效性转化率。',
    user: `请严格按结构输出：\n### 🚨 预警健康度洞察\n### 🔔 催办有效性与深度归因\n数据：${JSON.stringify(facts, null, 2)}`,
    options: { maxTokens: 1100, temperature: 0.2 },
  };
}

function parseReasoningFlag(body) {
  const v = body && body.reasoning;
  return v === true || v === 'true' || v === 1;
}

function prepareInsightContext(body) {
  const insightType = resolveInsightType(body);
  if (!insightType) {
    throw createError(400,
      `insightType 必填且为: ${INSIGHT_TYPES.join(', ')}（或使用旧 module 兼容入参）`,
      'INSIGHT_002');
  }
  const reasoning = parseReasoningFlag(body);
  const llmModel = reasoning ? 'deepseek-reasoner' : 'deepseek-chat';
  const module = insightType;
  let facts;
  if (insightType === 'north_star') facts = buildNorthStarFacts(body);
  else if (insightType === 'completion_weekly') facts = buildWeeklyCompletionFacts(body);
  else if (insightType === 'completion_daily') facts = buildDailyCompletionFacts(body);
  else if (insightType === 'channel_north_star') facts = buildChannelNorthStarFacts(body);
  else if (insightType === 'conversion_funnel') facts = buildFunnelFacts(body);
  else facts = buildFunnelFacts(body);

  const promptPack = buildPromptByInsightType(insightType, facts);
  const taskId = body.taskId || null;
  const q = normalizeQuery(body);
  const extra = {
    insightType, trendType: body.trendType, date: body.date,
    rtmLevel: body.rtmLevel, reasoning, model: llmModel,
  };
  return { insightType, module, facts, promptPack, taskId, q, extra, reasoning, llmModel };
}

function persistInsightRecord(id, module, taskId, q, extra, content, facts, userId) {
  try {
    crud.insertInsight({
      id, moduleType: module, taskId,
      rtm: q.rtm, format: q.format, dealerName: q.dealerName, storeId: q.storeId,
      extraParams: extra, content, facts, userId,
    });
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      throw createError(400, 'taskId 或 storeId 等外键不存在', 'INSIGHT_004');
    }
    throw e;
  }
}

async function createInsight(body, userId, req, res) {
  const ctx = prepareInsightContext(body);

  writeSseHeaders(res);
  const send = createSseSender(res);

  const baseMax = ctx.promptPack.options.maxTokens ?? 900;
  const streamMaxTokens = ctx.reasoning ? Math.max(baseMax, 8192) : baseMax;

  let full = '';
  try {
    full = await generateTextDeepSeekStream(
      ctx.promptPack.user,
      {
        system: ctx.promptPack.system,
        model: ctx.llmModel,
        temperature: ctx.promptPack.options.temperature,
        maxTokens: streamMaxTokens,
      },
      (delta, meta) => {
        send('delta', { text: delta, phase: meta && meta.phase ? meta.phase : 'content' });
      }
    );
  } catch (err) {
    console.error('[dashboardInsight] stream failed:', err.message);
    send('error', { message: err.message || '智能洞察流式生成失败', code: 'INSIGHT_503' });
    res.end();
    return;
  }

  full = (full || '').trim();
  if (!full) {
    send('error', { message: '智能洞察生成失败，请稍后重试', code: 'INSIGHT_503' });
    res.end();
    return;
  }

  const id = nanoid();
  try {
    persistInsightRecord(id, ctx.module, ctx.taskId, ctx.q, ctx.extra, full, ctx.facts, userId);
  } catch (e) {
    send('error', { message: e.message || 'persist failed', code: e.errorCode || 'INSIGHT_004' });
    res.end();
    return;
  }

  const createdAt = crud.getInsightCreatedAt(id);
  send('done', {
    code: 200, message: 'success',
    data: {
      insightId: id, insightType: ctx.insightType, module: ctx.module,
      taskId: ctx.taskId, filters: ctx.q, content: full, createdAt,
      voteSummary: { up: 0, down: 0 },
      model: ctx.llmModel, reasoning: ctx.reasoning,
    },
    requestId: req.requestId,
  });
  res.end();
}

function recordVote(insightId, body) {
  const raw = typeof body === 'string' ? { vote: body } : body || {};
  const voteStr = String(raw.vote || '').trim();
  const action = raw.action === 'remove' ? 'remove' : 'add';

  if (voteStr !== 'up' && voteStr !== 'down') {
    throw createError(400, 'vote 必须为 up 或 down', 'INSIGHT_003');
  }
  const row = crud.getInsightById(insightId);
  if (!row) throw createError(404, '洞察不存在', 'INSIGHT_404');

  if (voteStr === 'up') {
    action === 'add' ? crud.incrementInsightVote(insightId, 'up') : crud.decrementInsightVote(insightId, 'up');
  } else {
    action === 'add' ? crud.incrementInsightVote(insightId, 'down') : crud.decrementInsightVote(insightId, 'down');
  }

  const after = crud.getInsightVotes(insightId);
  return { insightId, up: after.up || 0, down: after.down || 0 };
}

module.exports = {
  MODULE_TYPES,
  INSIGHT_TYPES,
  createInsight,
  recordVote,
};
