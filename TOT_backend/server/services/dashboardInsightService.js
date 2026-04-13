'use strict';

const { nanoid } = require('nanoid');
const { db } = require('../db');
const { parseStoreDrill } = require('../utils/storeDrill');
const { generateText, generateTextDeepSeek } = require('../utils/ai');
const { createError } = require('../middleware/errorHandler');

const MODULE_TYPES = [
  'north_star',
  'completion_weekly',
  'completion_daily',
  'channel_north_star',
  'funnel_alerts',
];
const INSIGHT_TYPES = [
  'north_star',
  'completion_weekly',
  'completion_daily',
  'channel_north_star',
  'funnel_alerts',
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

function taScope(taskId, drill) {
  const taConditions = ['1=1'];
  const taParams = [];
  if (taskId) {
    taConditions.push('ta.task_id = ?');
    taParams.push(taskId);
  }
  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';
  const allParams = [...taParams, ...drill.params];
  return { taConditions, joinStore, storeWhere, allParams };
}

async function generateInsightText(userPrompt, systemPrompt, options = {}) {
  try {
    return await generateTextDeepSeek(userPrompt, {
      system: systemPrompt,
      temperature: options.temperature == null ? 0.25 : options.temperature,
      maxTokens: options.maxTokens || 900,
    });
  } catch (err) {
    console.warn('[dashboardInsight] DeepSeek failed, fallback Gemini:', err.message);
    return generateText(`${systemPrompt}\n\n---\n\n${userPrompt}`);
  }
}

function buildNorthStarFacts(body) {
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));
  const { taConditions, joinStore, storeWhere, allParams } = taScope(taskId, drill);

  const base = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ta.status = 'pending' THEN 1 ELSE 0 END) AS not_started_count,
       SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
       SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL
             AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time_count,
       AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL
             THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_hours,
       SUM(CASE WHEN ta.status != 'completed' AND datetime('now') > datetime(t.ddl_at) THEN 1 ELSE 0 END) AS overdue
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${joinStore}
     WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
    allParams
  );

  const total = base.total || 0;
  const notStarted = base.not_started_count || 0;
  const inProgress = base.in_progress_count || 0;
  const completed = base.completed_count || 0;
  const onTime = base.on_time_count || 0;
  const completionRate = toPct(completed, total);
  const onTimeRate = toPct(onTime, total);
  const avgH = base.avg_hours != null ? Number(base.avg_hours.toFixed(1)) : 0;
  const task = taskId ? db.get('SELECT id, title FROM tasks WHERE id = ?', [taskId]) : null;

  return {
    scope: taskId ? `taskId=${taskId}` : '全任务汇总',
    taskId: taskId || null,
    taskName: task ? task.title : null,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    totalCount: total,
    notStartedCount: notStarted,
    inProgressCount: inProgress,
    completedCount: completed,
    overdueCount: base.overdue || 0,
    completionRate,
    onTimeRate,
    avgCompletionHours: avgH,
  };
}

function buildFunnelFacts(body) {
  const baseFacts = buildNorthStarFacts(body);
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));
  const { taConditions, joinStore, storeWhere, allParams } = taScope(taskId, drill);
  const total = baseFacts.totalCount;

  let push = 0;
  let reads = 0;
  if (drill.hasDrill && taskId) {
    const pr = db.get(
      `SELECT COUNT(DISTINCT ne.target_user_id) AS c FROM notification_events ne
       JOIN stores s ON s.id = ne.store_id
       WHERE ne.task_id = ? AND ne.event_type = 'task_assigned' ${drill.sql}`,
      [taskId, ...drill.params]
    );
    push = pr && pr.c ? pr.c : 0;
    const rr = db.get(
      `SELECT COUNT(DISTINCT rr.user_id) AS c FROM read_receipts rr
       JOIN notification_events ne ON ne.id = rr.event_id
       JOIN stores s ON s.id = ne.store_id
       WHERE ne.task_id = ? AND rr.source = 'task_detail_open' ${drill.sql}`,
      [taskId, ...drill.params]
    );
    reads = rr && rr.c ? rr.c : 0;
  } else if (taskId) {
    const pr = db.get(
      `SELECT COUNT(DISTINCT ne.target_user_id) AS c FROM notification_events ne
       WHERE ne.task_id = ? AND ne.event_type = 'task_assigned'`,
      [taskId]
    );
    push = pr && pr.c ? pr.c : 0;
    const rr = db.get(
      `SELECT COUNT(DISTINCT rr.user_id) AS c FROM read_receipts rr
       JOIN notification_events ne ON ne.id = rr.event_id
       WHERE ne.task_id = ? AND rr.source = 'task_detail_open'`,
      [taskId]
    );
    reads = rr && rr.c ? rr.c : 0;
  }

  const reachRow = db.get(
    `SELECT COUNT(ta.id) AS reached_count
     FROM task_assignments ta
     JOIN users u ON ta.user_id = u.employee_id
     ${joinStore}
     WHERE ${taConditions.join(' AND ')} ${storeWhere}
       AND (
         (u.last_login_at IS NOT NULL AND u.last_login_at >= ta.created_at)
         OR ta.received_at IS NOT NULL
       )`,
    allParams
  );

  const nudgeRow = db.get(
    `SELECT
       COUNT(ta.id) AS total_nudged,
       SUM(CASE WHEN ta.started_at IS NOT NULL OR ta.status = 'completed' THEN 1 ELSE 0 END) AS converted_nudged
     FROM task_assignments ta
     ${joinStore}
     WHERE ${taConditions.join(' AND ')} ${storeWhere} AND ta.nudge_count > 0`,
    allParams
  );

  const warnStatsRow = db.get(
    `SELECT
       SUM(CASE WHEN ne.dedupe_key LIKE '%startDelay%' THEN 1 ELSE 0 END) AS start_delay_cnt,
       SUM(CASE WHEN ne.dedupe_key LIKE '%deadlineCrisisP0%' THEN 1 ELSE 0 END) AS p0_cnt,
       SUM(CASE WHEN ne.dedupe_key LIKE '%deadlineCrisisP1%' THEN 1 ELSE 0 END) AS p1_cnt
     FROM notification_events ne
     JOIN task_assignments ta ON ne.assignment_id = ta.id
     ${joinStore}
     WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
    allParams
  ) || {};

  return {
    scope: baseFacts.scope,
    taskId: baseFacts.taskId,
    taskName: baseFacts.taskName,
    drill: baseFacts.drill,
    totalAssignments: total,
    taskReachRate: toPct((reachRow && reachRow.reached_count) || 0, total),
    taskReadRate: toPct(reads, total),
    nudgeConversionRate: toPct(
      (nudgeRow && nudgeRow.converted_nudged) || 0,
      (nudgeRow && nudgeRow.total_nudged) || 0
    ),
    startDelayRate: toPct(warnStatsRow.start_delay_cnt || 0, total),
    crisisP1Rate: toPct(warnStatsRow.p1_cnt || 0, total),
    crisisP0Rate: toPct(warnStatsRow.p0_cnt || 0, total),
    pushUserCount: push,
    readUserDistinct: reads,
  };
}

function buildWeeklyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_weekly 需要 taskId', 'INSIGHT_001');
  const drill = parseStoreDrill(normalizeQuery(body));
  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';
  const task = db.get('SELECT id, title FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  const totalRow = db.get(
    `SELECT COUNT(*) AS total FROM task_assignments ta ${joinStore}
     WHERE ta.task_id = ? ${storeWhere}`,
    [taskId, ...drill.params]
  );
  const rows = db.all(
    `SELECT date(ta.completed_at) AS k, COUNT(ta.id) AS n
     FROM task_assignments ta ${joinStore}
     WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL ${storeWhere}
     GROUP BY date(ta.completed_at) ORDER BY date(ta.completed_at) ASC`,
    [taskId, ...drill.params]
  );
  const latestRows = rows.slice(-7);
  let cumulative = 0;
  const progressData = latestRows.map((r, idx) => {
    cumulative += r.n || 0;
    return {
      day: `第${idx + 1}天`,
      new_completions: r.n || 0,
      cumulative_completions: cumulative,
    };
  });
  return {
    taskName: task.title,
    taskId,
    totalUsers: (totalRow && totalRow.total) || 0,
    currentDay: progressData.length,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    progressData,
  };
}

function buildDailyCompletionFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'completion_daily 需要 taskId', 'INSIGHT_001');
  const targetDate = body.date || new Date().toISOString().slice(0, 10);
  const drill = parseStoreDrill(normalizeQuery(body));
  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';
  const task = db.get('SELECT id, title FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  const totalRow = db.get(
    `SELECT COUNT(*) AS total FROM task_assignments ta ${joinStore}
     WHERE ta.task_id = ? ${storeWhere}`,
    [taskId, ...drill.params]
  );
  const rows = db.all(
    `SELECT strftime('%H', ta.completed_at) AS hour_key, COUNT(ta.id) AS n
     FROM task_assignments ta ${joinStore}
     WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL
       AND date(ta.completed_at) = ? ${storeWhere}
     GROUP BY strftime('%H', ta.completed_at) ORDER BY strftime('%H', ta.completed_at) ASC`,
    [taskId, targetDate, ...drill.params]
  );
  const byHour = {};
  for (const r of rows) byHour[Number(r.hour_key)] = r.n || 0;

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
    taskName: task.title,
    taskId,
    totalUsers: (totalRow && totalRow.total) || 0,
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
  const heatParams = [taskId, ...drill.params];

  const level = rtmLevel;
  let selectDim;
  let groupByDim;
  if (level === 'store') {
    selectDim = 'MAX(s.name) AS dim';
    groupByDim = 's.id';
  } else if (level === 'dealer' || level === 'dealer_name' || level === 'dealername') {
    selectDim = 'COALESCE(NULLIF(TRIM(s.dealer_name), \'\'), \'(未知)\') AS dim';
    groupByDim = 'COALESCE(NULLIF(TRIM(s.dealer_name), \'\'), \'\')';
  } else {
    const colMap = {
      rtm: 's.rtm',
      region: 's.region',
      format: 's.format',
      subrtm: 's.rtm',
    };
    const col = colMap[level] || 's.rtm';
    selectDim = `${col} AS dim`;
    groupByDim = col;
  }

  const heatRows = db.all(
    `SELECT ${selectDim},
            COUNT(ta.id) AS assignment_count,
            ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 1) AS rate
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.task_id = ? ${drill.sql}
     GROUP BY ${groupByDim}
     ORDER BY rate DESC`,
    heatParams
  );

  const rankTop = db.all(
    `SELECT s.id AS store_id, s.name AS store_name,
            ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 1) AS rate,
            COUNT(ta.id) AS n
     FROM task_assignments ta JOIN stores s ON s.id = ta.store_id
     WHERE ta.task_id = ? ${drill.sql}
     GROUP BY ta.store_id
     ORDER BY rate DESC, s.id ASC LIMIT 3`,
    heatParams
  );

  const rankBottom = db.all(
    `SELECT s.id AS store_id, s.name AS store_name,
            ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 1) AS rate,
            COUNT(ta.id) AS n
     FROM task_assignments ta JOIN stores s ON s.id = ta.store_id
     WHERE ta.task_id = ? ${drill.sql}
     GROUP BY ta.store_id
     HAVING rate < 100
     ORDER BY rate ASC, s.id ASC LIMIT 3`,
    heatParams
  );

  return {
    taskId,
    rtmLevel: body.rtmLevel || 'rtm',
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    heatmapBuckets: heatRows.map((r) => ({
      name: r.dim || '(未知)',
      assignmentCount: r.assignment_count,
      completionRate: r.rate,
    })),
    topStores: rankTop.map((r) => ({
      storeId: r.store_id,
      storeName: r.store_name,
      completionRate: r.rate,
      assignmentCount: r.n,
    })),
    bottomStores: rankBottom.map((r) => ({
      storeId: r.store_id,
      storeName: r.store_name,
      completionRate: r.rate,
      assignmentCount: r.n,
    })),
  };
}

function buildWarningStatsFacts(body) {
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));
  const conditions = ['1=1'];
  const params = [];
  if (taskId) {
    conditions.push('ta.task_id = ?');
    params.push(taskId);
  }
  if (drill.hasDrill) {
    conditions.push(drill.sql.replace(/^\s*AND\s+/, ''));
    params.push(...drill.params);
  }
  const whereClause = conditions.join(' AND ');

  const aggregateSql = `
    SELECT ta.task_id, ta.store_id, s.name AS store_name, t.ddl_at,
      COUNT(ta.id) AS total_count,
      ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate
    FROM task_assignments ta
    JOIN stores s ON s.id = ta.store_id
    JOIN tasks t ON t.id = ta.task_id
    WHERE ${whereClause}
    GROUP BY ta.store_id, ta.task_id
    HAVING completion_rate < 80
  `;
  const subRows = db.all(aggregateSql, params);
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
  const channelRows = db.all(
    `SELECT
       s.rtm AS channel,
       COUNT(ta.id) AS total_count,
       SUM(CASE WHEN ta.status='completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time_count,
       AVG(CASE WHEN ta.status='completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL
                THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 * 60 END) AS avg_minutes
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.task_id = ? ${drill.sql}
     GROUP BY s.rtm`,
    [taskId, ...drill.params]
  );

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
      completion_rate: {
        mean: `${meanRate.toFixed(1)}%`,
        median: `${toMedian(rates).toFixed(1)}%`,
      },
      completion_time_minutes: {
        mean: meanMin,
        median: toMedian(mins),
      },
    },
    channel_data: channelData,
  };
}

function resolveInsightType(body) {
  const raw = (body.insightType || '').trim();
  if (INSIGHT_TYPES.includes(raw)) return raw;
  if (body.module === 'funnel') return 'north_star';
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
      user: `请围绕“按时完成率、人均完成耗时”输出结构化洞察，150字以内，含少量 emoji。\n数据：${JSON.stringify(facts, null, 2)}`,
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

  return {
    system: '你是资深零售链路分析师。只输出客观洞察与归因，禁止建议、禁止行动方案、禁止评估催办时间点。',
    user:
      `请严格按结构输出：\n` +
      `### 📊一、 全局链路健康度洞察\n### 🔍二、 核心数据洞察与深度归因\n` +
      `数据：${JSON.stringify(facts, null, 2)}`,
    options: { maxTokens: 1100, temperature: 0.2 },
  };
}

/**
 * @param {object} body
 * @param {number} userId
 */
async function createInsight(body, userId) {
  const insightType = resolveInsightType(body);
  if (!insightType) {
    throw createError(
      400,
      `insightType 必填且为: ${INSIGHT_TYPES.join(', ')}（或使用旧 module 兼容入参）`,
      'INSIGHT_002'
    );
  }
  const module = insightType;

  let facts;
  if (insightType === 'north_star') facts = buildNorthStarFacts(body);
  else if (insightType === 'completion_weekly') facts = buildWeeklyCompletionFacts(body);
  else if (insightType === 'completion_daily') facts = buildDailyCompletionFacts(body);
  else if (insightType === 'channel_north_star') facts = buildChannelNorthStarFacts(body);
  else facts = buildFunnelFacts(body);

  const promptPack = buildPromptByInsightType(insightType, facts);
  const content = (
    await generateInsightText(promptPack.user, promptPack.system, promptPack.options)
  ).trim();
  if (!content) throw createError(503, '智能洞察生成失败，请稍后重试', 'INSIGHT_503');

  const id = nanoid();
  const taskId = body.taskId || null;
  const q = normalizeQuery(body);
  const extra = {
    insightType,
    trendType: body.trendType,
    date: body.date,
    rtmLevel: body.rtmLevel,
  };

  try {
    db.run(
      `INSERT INTO dashboard_insights (
         id, module_type, task_id, filter_rtm, filter_format, filter_dealer_name, filter_store_id,
         extra_params_json, content, context_json, up_count, down_count, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        id,
        module,
        taskId,
        q.rtm || null,
        q.format || null,
        q.dealerName || null,
        q.storeId || null,
        JSON.stringify(extra),
        content,
        JSON.stringify(facts),
        userId,
      ]
    );
  } catch (e) {
    if (e && (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || e.code === 'SQLITE_CONSTRAINT')) {
      throw createError(400, 'taskId 或 storeId 等外键不存在', 'INSIGHT_004');
    }
    throw e;
  }

  return {
    insightId: id,
    insightType,
    module,
    taskId,
    filters: q,
    content,
    createdAt: db.get('SELECT created_at AS t FROM dashboard_insights WHERE id = ?', [id]).t,
    voteSummary: { up: 0, down: 0 },
  };
}

/** 仅累加汇总计数，不记录投票人。 */
function recordVote(insightId, voteStr) {
  if (voteStr !== 'up' && voteStr !== 'down') {
    throw createError(400, 'vote 必须为 up 或 down', 'INSIGHT_003');
  }
  const row = db.get('SELECT id FROM dashboard_insights WHERE id = ?', [insightId]);
  if (!row) throw createError(404, '洞察不存在', 'INSIGHT_404');

  if (voteStr === 'up') {
    db.run('UPDATE dashboard_insights SET up_count = up_count + 1 WHERE id = ?', [insightId]);
  } else {
    db.run('UPDATE dashboard_insights SET down_count = down_count + 1 WHERE id = ?', [insightId]);
  }

  const after = db.get(
    'SELECT up_count AS up, down_count AS down FROM dashboard_insights WHERE id = ?',
    [insightId]
  );
  return {
    insightId,
    up: after.up || 0,
    down: after.down || 0,
  };
}

module.exports = {
  MODULE_TYPES,
  INSIGHT_TYPES,
  createInsight,
  recordVote,
};
