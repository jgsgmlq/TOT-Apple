'use strict';

const { nanoid } = require('nanoid');
const crud = require('../crud/dashboardCrud');
const mysqlCrud = require('../crud/dashboardMysqlCrud');
const {
  classifyStatus,
  completionTimeHours,
  resolveDimensionKey,
  fetchTaskContext,
} = require('./queryEngine');
const { formatLocalDateYYYYMMDD } = require('../../common/utils/ddlAt');
const { generateTextDeepSeekStream } = require('../../common/utils/ai');
const { createError } = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

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

function toPct(numerator, denominator, digits) {
  if (!denominator || denominator <= 0) return 0;
  return Number(((100 * numerator) / denominator).toFixed(digits ?? 2));
}

function toMedian(nums) {
  if (!nums || nums.length === 0) return 0;
  const arr = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) return Number(((arr[mid - 1] + arr[mid]) / 2).toFixed(2));
  return Number(arr[mid].toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Facts builders — async, MySQL data source, pure JS aggregation
// Each builder is wrapped in try-catch at the call site so a single failure
// doesn't interrupt the SSE stream.
// ═══════════════════════════════════════════════════════════════════════════════

async function buildNorthStarFacts(body) {
  const taskId = body.taskId || null;
  const { task, queues, mpsRows } = await fetchTaskContext(taskId, body);

  if (!task || queues.length === 0) {
    return {
      scope: taskId ? `taskId=${taskId}` : '全任务汇总',
      taskId: taskId || null, taskName: null, drill: null,
      totalCount: 0, notStartedCount: 0, inProgressCount: 0,
      completedCount: 0, overdueCount: 0,
      completionRate: 0, onTimeRate: 0, avgCompletionHours: 0,
    };
  }

  const now = Date.now();
  const dueMs = new Date(task.due_date).getTime();
  const total = queues.length;
  let notStarted = 0, inProgress = 0, completed = 0, overdue = 0, onTime = 0;
  let timeTotal = 0, timeCount = 0;

  for (const q of queues) {
    const status = classifyStatus(q.email_id, mpsRows);
    if (status === 'completed') {
      completed++;
      const hrs = completionTimeHours(task, mpsRows, q.email_id);
      if (hrs !== null) { timeTotal += hrs; timeCount++; }
      const passedTimes = mpsRows
        .filter(r => r.email_id === q.email_id && r.required_flag === 1 && r.passed_time)
        .map(r => new Date(r.passed_time).getTime());
      if (passedTimes.length > 0 && Math.max(...passedTimes) <= dueMs) onTime++;
    } else if (status === 'in_progress') {
      inProgress++;
    } else {
      notStarted++;
    }
    if (status !== 'completed' && now > dueMs) overdue++;
  }

  return {
    scope: taskId ? `taskId=${taskId}` : '全任务汇总',
    taskId: taskId || null,
    taskName: task ? task.task_title : null,
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
    totalCount: total,
    notStartedCount: notStarted,
    inProgressCount: inProgress,
    completedCount: completed,
    overdueCount: overdue,
    completionRate: toPct(completed, total),
    onTimeRate: toPct(onTime, total),
    avgCompletionHours: timeCount > 0 ? Number((timeTotal / timeCount).toFixed(1)) : 0,
  };
}

async function buildFunnelFacts(body) {
  const baseFacts = await buildNorthStarFacts(body);
  const taskId = body.taskId || null;
  const { task, queues, mpsRows, confirmedSet, reminderMap } = await fetchTaskContext(taskId, body);

  const total = baseFacts.totalCount;
  const push = total;
  const reads = total;
  const reached = baseFacts.inProgressCount + baseFacts.completedCount;

  let newN = 0, p0N = 0, p1N = 0, p2N = 0, p3N = 0;
  if (task) {
    for (const q of queues) {
      const level = reminderMap.get(q.email_id) || 'new';
      if (level === 'new') newN++;
      else if (level === 'P0') p0N++;
      else if (level === 'P1') p1N++;
      else if (level === 'P2') p2N++;
      else if (level === 'P3') p3N++;
    }
  }

  const nudgeTotal = total;
  const nudgeConverted = baseFacts.completedCount;

  return {
    ...baseFacts,
    totalAssignments: total,
    taskReachRate: toPct(reached, total),
    taskReadRate: toPct(reads, total),
    nudgeConversionRate: toPct(nudgeConverted, nudgeTotal),
    crisisNewRate: toPct(newN, total),
    crisisP3Rate: toPct(p3N, total),
    crisisP2Rate: toPct(p2N, total),
    crisisP1Rate: toPct(p1N, total),
    crisisP0Rate: toPct(p0N, total),
    pushUserCount: push,
    readUserDistinct: reads,
  };
}

async function buildWeeklyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_weekly 需要 taskId', 'INSIGHT_001');

  const { task, mpsRows } = await fetchTaskContext(taskId, body);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const learnerCompletion = new Map();
  for (const r of mpsRows) {
    if (!r.passed_time || r.required_flag !== 1) continue;
    const t = new Date(r.passed_time).getTime();
    if (!learnerCompletion.has(r.email_id) || t < learnerCompletion.get(r.email_id)) {
      learnerCompletion.set(r.email_id, t);
    }
  }

  const dayBuckets = new Map();
  const pad2 = n => String(n).padStart(2, '0');
  for (const [, passedMs] of learnerCompletion) {
    const d = new Date(passedMs);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    dayBuckets.set(key, (dayBuckets.get(key) || 0) + 1);
  }

  const sortedDays = [...dayBuckets.keys()].sort();
  const latestDays = sortedDays.slice(-7);

  let cumulative = 0;
  const progressData = latestDays.map((day, idx) => {
    cumulative += dayBuckets.get(day) || 0;
    return {
      day: `第${idx + 1}天`,
      new_completions: dayBuckets.get(day) || 0,
      cumulative_completions: cumulative,
    };
  });

  return {
    taskName: task.task_title,
    taskId,
    totalUsers: (await mysqlCrud.getQueueEntries({ taskPublishId: taskId })).length,
    currentDay: progressData.length,
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
    progressData,
  };
}

async function buildDailyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_daily 需要 taskId', 'INSIGHT_001');

  const targetDate = body.date || formatLocalDateYYYYMMDD();
  const { task, mpsRows } = await fetchTaskContext(taskId, body);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const learnerCompletion = new Map();
  for (const r of mpsRows) {
    if (!r.passed_time || r.required_flag !== 1) continue;
    const t = new Date(r.passed_time).getTime();
    if (!learnerCompletion.has(r.email_id) || t < learnerCompletion.get(r.email_id)) {
      learnerCompletion.set(r.email_id, t);
    }
  }

  const byHour = {};
  const pad2 = n => String(n).padStart(2, '0');
  for (const [, passedMs] of learnerCompletion) {
    const d = new Date(passedMs);
    const dateKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (dateKey !== targetDate) continue;
    const h = d.getHours();
    byHour[h] = (byHour[h] || 0) + 1;
  }

  let cumulative = 0;
  const progressData = [];
  for (let h = 0; h < 24; h += 2) {
    const n = (byHour[h] || 0) + (byHour[h + 1] || 0);
    cumulative += n;
    progressData.push({
      time_slot: `${pad2(h)}:00-${pad2(h + 2)}:00`,
      new_completions: n,
      cumulative_completions: cumulative,
    });
  }

  return {
    taskName: task.task_title,
    taskId,
    totalUsers: (await mysqlCrud.getQueueEntries({ taskPublishId: taskId })).length,
    targetDate,
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
    intradayProgressData: progressData,
  };
}

async function buildHeatmapRankFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'heatmap_rank 模块需要 taskId', 'INSIGHT_001');

  const rtmLevel = (body.rtmLevel || 'rtm').toLowerCase();
  const { task, queues, mpsRows } = await fetchTaskContext(taskId, body);

  if (!task || queues.length === 0) {
    return {
      taskId,
      rtmLevel: body.rtmLevel || 'rtm',
      drill: null,
      heatmapBuckets: [],
      topStores: [],
      bottomStores: [],
    };
  }

  const groups = new Map();
  for (const q of queues) {
    const key = resolveDimensionKey(q, rtmLevel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const storeEntries = [];
  const heatmapBuckets = [];

  for (const [name, entries] of groups) {
    let completedCount = 0;
    for (const e of entries) {
      if (classifyStatus(e.email_id, mpsRows) === 'completed') completedCount++;
    }
    const rate = toPct(completedCount, entries.length);
    heatmapBuckets.push({
      name: name || '(未知)',
      assignmentCount: entries.length,
      completionRate: rate,
    });
    storeEntries.push({ name, assignmentCount: entries.length, completionRate: rate });
  }

  storeEntries.sort((a, b) => b.completionRate - a.completionRate);
  const topStores = storeEntries.slice(0, 3).map(r => ({
    storeId: r.name, storeName: r.name,
    completionRate: r.completionRate, assignmentCount: r.assignmentCount,
  }));
  const bottomStores = storeEntries.slice(-3).reverse().map(r => ({
    storeId: r.name, storeName: r.name,
    completionRate: r.completionRate, assignmentCount: r.assignmentCount,
  }));

  return {
    taskId,
    rtmLevel: body.rtmLevel || 'rtm',
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
    heatmapBuckets,
    topStores,
    bottomStores,
  };
}

async function buildWarningStatsFacts(body) {
  const taskId = body.taskId || null;
  const { task, queues, mpsRows, reminderMap } = await fetchTaskContext(taskId, body);

  let p1 = 0, p2 = 0, p3 = 0;
  const storeWarnings = new Map();

  if (task && queues.length > 0) {
    for (const q of queues) {
      const level = (reminderMap.get(q.email_id) || 'new').toLowerCase();
      const storeKey = q.store_name || '(未知)';

      if (level === 'p0' || level === 'p1') {
        if (!storeWarnings.has(storeKey)) storeWarnings.set(storeKey, { p1: false, p2: false, p3: false });
        storeWarnings.get(storeKey).p1 = true;
      } else if (level === 'p2') {
        if (!storeWarnings.has(storeKey)) storeWarnings.set(storeKey, { p1: false, p2: false, p3: false });
        storeWarnings.get(storeKey).p2 = true;
      } else if (level === 'p3') {
        if (!storeWarnings.has(storeKey)) storeWarnings.set(storeKey, { p1: false, p2: false, p3: false });
        storeWarnings.get(storeKey).p3 = true;
      }
    }

    for (const [, w] of storeWarnings) {
      if (w.p1) p1++;
      else if (w.p2) p2++;
      else if (w.p3) p3++;
    }
  }

  const funnel = await buildFunnelFacts(body);

  return {
    taskId,
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
    warningStoreRowsUnder80: p1 + p2 + p3,
    estimatedP1Buckets: p1,
    estimatedP2Buckets: p2,
    estimatedP3Buckets: p3,
    funnelSnapshot: {
      completionRate: funnel.completionRate,
      onTimeCompletionRate: funnel.onTimeCompletionRate,
      overdueCount: funnel.overdueCount,
    },
  };
}

async function buildChannelNorthStarFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'channel_north_star 需要 taskId', 'INSIGHT_001');

  const { task, queues, mpsRows } = await fetchTaskContext(taskId, body);

  if (!task || queues.length === 0) {
    return {
      taskId, drill: null,
      overall_statistics: {
        completion_rate: { mean: '0.0%', median: '0.0%' },
        completion_time_minutes: { mean: 0, median: 0 },
      },
      channel_data: {},
    };
  }

  const channelGroups = new Map();
  for (const q of queues) {
    const channel = q.rtm4_name || 'Other';
    if (!channelGroups.has(channel)) channelGroups.set(channel, []);
    channelGroups.get(channel).push(q);
  }

  const channels = [...channelGroups.keys()].sort();
  const channelData = {};
  const rates = [];
  const mins = [];

  for (const channel of channels) {
    const entries = channelGroups.get(channel);
    let onTimeCount = 0;
    let timeTotal = 0, timeCount = 0;

    for (const e of entries) {
      const status = classifyStatus(e.email_id, mpsRows);
      if (status === 'completed') {
        const hrs = completionTimeHours(task, mpsRows, e.email_id);
        if (hrs !== null) { timeTotal += hrs; timeCount++; }
        const passedTimes = mpsRows
          .filter(r => r.email_id === e.email_id && r.required_flag === 1 && r.passed_time)
          .map(r => new Date(r.passed_time).getTime());
        if (passedTimes.length > 0 && Math.max(...passedTimes) <= new Date(task.due_date).getTime()) {
          onTimeCount++;
        }
      }
    }

    const rate = toPct(onTimeCount, entries.length, 1);
    const avgMin = timeCount > 0 ? Number((timeTotal / timeCount * 60).toFixed(1)) : 0;

    channelData[channel] = {
      completion_rate: `${rate.toFixed(1)}%`,
      completion_time_minutes: avgMin,
      sample_size: entries.length,
    };
    rates.push(rate);
    mins.push(avgMin);
  }

  const meanRate = rates.length
    ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1))
    : 0;
  const meanMin = mins.length
    ? Number((mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1))
    : 0;

  return {
    taskId,
    drill: body.storeId || body.rtm || body.format || body.dealerName ? normalizeQuery(body) : null,
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

const BUILDER_MAP = {
  north_star:          buildNorthStarFacts,
  completion_weekly:   buildWeeklyCompletionFacts,
  completion_daily:    buildDailyCompletionFacts,
  channel_north_star:  buildChannelNorthStarFacts,
  conversion_funnel:   buildFunnelFacts,
  funnel_alerts:       buildWarningStatsFacts,
};

async function prepareInsightContext(body) {
  const insightType = resolveInsightType(body);
  if (!insightType) {
    throw createError(400,
      `insightType 必填且为: ${INSIGHT_TYPES.join(', ')}（或使用旧 module 兼容入参）`,
      'INSIGHT_002');
  }
  const reasoning = parseReasoningFlag(body);
  const llmModel = reasoning ? 'deepseek-reasoner' : 'deepseek-chat';
  const module = insightType;

  const builder = BUILDER_MAP[insightType] || buildFunnelFacts;
  let facts;
  try {
    facts = await builder(body);
  } catch (e) {
    logger.error(`[insightService] builder ${insightType} failed: ${e.message}`);
    const taskId = body.taskId || null;
    facts = {
      scope: taskId ? `taskId=${taskId}` : '全任务汇总',
      taskId, taskName: null, drill: null,
      totalCount: 0, notStartedCount: 0, inProgressCount: 0,
      completedCount: 0, overdueCount: 0,
      completionRate: 0, onTimeRate: 0, avgCompletionHours: 0,
    };
  }

  const promptPack = buildPromptByInsightType(insightType, facts);
  const taskId = body.taskId || null;
  const q = normalizeQuery(body);
  const extra = {
    insightType, trendType: body.trendType, date: body.date,
    rtmLevel: body.rtmLevel, reasoning, model: llmModel,
  };
  return { insightType, module, facts, promptPack, taskId, q, extra, reasoning, llmModel };
}

async function persistInsightRecord(id, module, taskId, q, extra, content, facts, userId) {
  await mysqlCrud.insertInsight({
    id, moduleType: module, taskPublishId: taskId,
    filterRtm: q.rtm, filterFormat: q.format, filterDealerName: q.dealerName, filterStoreId: q.storeId,
    extraParams: extra, content, context: facts, createdBy: userId,
  });
}

/**
 * Generate an AI insight via SSE streaming.
 *
 * @param {Object} body — request body with insight params
 * @param {string} userId — creating user id
 * @param {function} onEvent — callback({ type, ... }) for streaming events; type is 'delta' or 'error'
 * @returns {Promise<Object|null>} result payload for the final 'done' SSE event, or null on failure
 *
 * NOTE: This function does NOT touch req/res — the caller (route) owns SSE headers,
 * send(), and res.end(). See insightRoutes.js.
 */
async function createInsight(body, userId, onEvent) {
  const ctx = await prepareInsightContext(body);

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
        onEvent({ type: 'delta', text: delta, phase: meta && meta.phase ? meta.phase : 'content' });
      }
    );
  } catch (err) {
    logger.error('[dashboardInsight] stream failed:', err.message);
    onEvent({ type: 'error', message: err.message || '智能洞察流式生成失败', code: 'INSIGHT_503' });
    return null;
  }

  full = (full || '').trim();
  if (!full) {
    onEvent({ type: 'error', message: '智能洞察生成失败，请稍后重试', code: 'INSIGHT_503' });
    return null;
  }

  const id = nanoid();
  try {
    await persistInsightRecord(id, ctx.module, ctx.taskId, ctx.q, ctx.extra, full, ctx.facts, userId);
  } catch (e) {
    onEvent({ type: 'error', message: e.message || 'persist failed', code: e.errorCode || 'INSIGHT_004' });
    return null;
  }

  const saved = await mysqlCrud.getInsightById(id);
  return {
    insightId: id,
    insightType: ctx.insightType,
    module: ctx.module,
    taskId: ctx.taskId,
    filters: ctx.q,
    content: full,
    createdAt: saved ? saved.created_at : null,
    voteSummary: { up: 0, down: 0 },
    model: ctx.llmModel,
    reasoning: ctx.reasoning,
  };
}

async function recordVote(insightId, body) {
  const raw = typeof body === 'string' ? { vote: body } : body || {};
  const voteStr = String(raw.vote || '').trim();
  const action = raw.action === 'remove' ? 'remove' : 'add';

  if (voteStr !== 'up' && voteStr !== 'down') {
    throw createError(400, 'vote 必须为 up 或 down', 'INSIGHT_003');
  }
  const row = await mysqlCrud.getInsightById(insightId);
  if (!row) throw createError(404, '洞察不存在', 'INSIGHT_404');

  if (voteStr === 'up') {
    action === 'add' ? await mysqlCrud.incrementInsightVote(insightId, 'up') : await mysqlCrud.decrementInsightVote(insightId, 'up');
  } else {
    action === 'add' ? await mysqlCrud.incrementInsightVote(insightId, 'down') : await mysqlCrud.decrementInsightVote(insightId, 'down');
  }

  const after = await mysqlCrud.getInsightVotes(insightId);
  return { insightId, up: after.up || 0, down: after.down || 0 };
}

module.exports = {
  MODULE_TYPES,
  INSIGHT_TYPES,
  createInsight,
  recordVote,
};
