'use strict';

const { nanoid } = require('nanoid');
const { db } = require('../db');
const { parseStoreDrill } = require('../utils/storeDrill');
const { generateText, generateTextDeepSeek } = require('../utils/ai');
const { createError } = require('../middleware/errorHandler');

const MODULE_TYPES = ['trend', 'heatmap_rank', 'funnel', 'warning_stats'];

const SYSTEM_PROMPT =
  '你是 Apple 零售培训督导助手，面向总部管理者。根据下方结构化数据输出一段「智能洞察」：\n' +
  '1) 用 2～4 句中文，语气专业、可执行；\n' +
  '2) 只依据给定数据推断，无数据则说「数据不足」勿编造；\n' +
  '3) 不要 Markdown 标题符号，不要列出原始 JSON。';

function normalizeQuery(body) {
  return {
    rtm: body.rtm,
    format: body.format,
    dealerName: body.dealerName,
    storeId: body.storeId,
  };
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

async function generateInsightText(userPrompt) {
  try {
    return await generateTextDeepSeek(userPrompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.25,
      maxTokens: 900,
    });
  } catch (err) {
    console.warn('[dashboardInsight] DeepSeek failed, fallback Gemini:', err.message);
    return generateText(`${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`);
  }
}

function buildFunnelFacts(body) {
  const taskId = body.taskId || null;
  const drill = parseStoreDrill(normalizeQuery(body));
  const { taConditions, joinStore, storeWhere, allParams } = taScope(taskId, drill);

  const base = db.get(
    `SELECT
       COUNT(*) AS total,
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
  const completed = base.completed_count || 0;
  const onTime = base.on_time_count || 0;
  const completionRate = total > 0 ? Math.round((100 * completed) / total) : 0;
  const onTimeRate = total > 0 ? Math.round((100 * onTime) / total) : 0;
  const avgH = base.avg_hours != null ? Number(base.avg_hours.toFixed(1)) : 0;

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

  const facts = {
    scope: taskId ? `taskId=${taskId}` : '全任务汇总',
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    totalAssignments: total,
    completionRate,
    onTimeCompletionRate: onTimeRate,
    avgCompletionTimeHours: avgH,
    overdueCount: base.overdue || 0,
    pushUserCount: push,
    readUserDistinct: reads,
  };
  return facts;
}

function buildTrendFacts(body) {
  const taskId = body.taskId;
  if (!taskId) throw createError(400, 'trend 模块需要 taskId', 'INSIGHT_001');
  const trendType = body.trendType === 'hourly' ? 'hourly' : 'daily';
  const date = body.date || new Date().toISOString().slice(0, 10);
  const drill = parseStoreDrill(normalizeQuery(body));
  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';

  let rows;
  if (trendType === 'daily') {
    rows = db.all(
      `SELECT date(ta.completed_at) AS k, COUNT(ta.id) AS n
       FROM task_assignments ta ${joinStore}
       WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL ${storeWhere}
       GROUP BY date(ta.completed_at) ORDER BY date(ta.completed_at) ASC`,
      [taskId, ...drill.params]
    );
  } else {
    rows = db.all(
      `SELECT strftime('%H', ta.completed_at) AS k, COUNT(ta.id) AS n
       FROM task_assignments ta ${joinStore}
       WHERE ta.task_id = ? AND ta.status = 'completed' AND ta.completed_at IS NOT NULL
         AND date(ta.completed_at) = ? ${storeWhere}
       GROUP BY strftime('%H', ta.completed_at) ORDER BY strftime('%H', ta.completed_at) ASC`,
      [taskId, date, ...drill.params]
    );
  }

  const totalCompleted = rows.reduce((a, r) => a + (r.n || 0), 0);
  const facts = {
    module: 'trend',
    taskId,
    trendType,
    date: trendType === 'hourly' ? date : null,
    drill: drill.hasDrill ? normalizeQuery(body) : null,
    series: rows.map((r) => ({ timeKey: r.k, newCompleted: r.n })),
    totalCompletedInSeries: totalCompleted,
  };
  return facts;
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

function factsToPrompt(module, facts) {
  return `【模块】${module}\n【数据】\n${JSON.stringify(facts, null, 2)}`;
}

/**
 * @param {object} body
 * @param {number} userId
 */
async function createInsight(body, userId) {
  const module = body.module;
  if (!module || !MODULE_TYPES.includes(module)) {
    throw createError(400, `module 必填且为: ${MODULE_TYPES.join(', ')}`, 'INSIGHT_002');
  }

  let facts;
  if (module === 'funnel') facts = buildFunnelFacts(body);
  else if (module === 'trend') facts = buildTrendFacts(body);
  else if (module === 'heatmap_rank') facts = buildHeatmapRankFacts(body);
  else facts = buildWarningStatsFacts(body);

  const userPrompt = factsToPrompt(module, facts);
  const content = (await generateInsightText(userPrompt)).trim();
  if (!content) throw createError(503, '智能洞察生成失败，请稍后重试', 'INSIGHT_503');

  const id = nanoid();
  const taskId = body.taskId || null;
  const q = normalizeQuery(body);
  const extra = {
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
  createInsight,
  recordVote,
};
