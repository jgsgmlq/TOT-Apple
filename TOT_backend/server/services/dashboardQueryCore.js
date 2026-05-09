'use strict';

/**
 * 与 GET /dashboard/overview、GET /dashboard/heatmap、GET /dashboard/trend 同源的数据拼装逻辑，
 * 供 HTTP 路由与看板诊断 Agent（dashboardAgentService）复用，避免口径漂移。
 */

const { db } = require('../db/index');
const { createError } = require('../middleware/errorHandler');
const { parseStoreDrill } = require('../utils/storeDrill');
const { formatLocalDateYYYYMMDD, formatNowSqliteLocal } = require('../utils/ddlAt');
const {
  parseAutoNudgeRules,
  classifyDeadlineCrisisBand,
  getDeadlineCrisisHours,
} = require('./autoNudgeRules');
const { getPlatformDefinition } = require('../utils/platforms');

function heatmapColor(rate) {
  if (rate >= 80) return '#4CAF50';
  if (rate >= 50) return '#FF9900';
  return '#F44336';
}

function parsePlatformFilter(query) {
  if (!query.platform) return null;
  const platform = getPlatformDefinition(query.platform);
  if (!platform) {
    throw createError(400, 'platform 非法', 'DASH_006');
  }
  return {
    ...platform,
    readSource: `task_detail_open:${platform.sourceLabel}`,
  };
}

function platformReadExistsSql(sourceParam, taAlias = 'ta') {
  return `EXISTS (
    SELECT 1
    FROM read_receipts rrp
    JOIN notification_events nep ON nep.id = rrp.event_id
    WHERE nep.assignment_id = ${taAlias}.id
      AND rrp.user_id = ${taAlias}.user_id
      AND rrp.source = ${sourceParam}
  )`;
}

function completedCondition(platform, taAlias = 'ta') {
  return platform ? `${taAlias}.${platform.completedColumn} = 1` : `${taAlias}.status = 'completed'`;
}

function uncompletedCondition(platform, taAlias = 'ta') {
  return platform
    ? `COALESCE(${taAlias}.${platform.completedColumn}, 0) != 1`
    : `${taAlias}.status != 'completed'`;
}

/**
 * 与 GET /api/v1/dashboard/overview 的 data 字段一致（不含 code/message/requestId）。
 * @param {Record<string, string>} query 等价于 req.query
 */
function getOverviewBoardData(query) {
  const { taskId } = query;
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  const taConditions = ['1=1'];
  const taParams = [];
  if (taskId) {
    taConditions.push('ta.task_id = ?');
    taParams.push(taskId);
  }

  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';
  const allParams = [...taParams, ...drill.params];
  const nowMs = Date.now();
  const completedCond = completedCondition(platform);
  const uncompletedCond = uncompletedCondition(platform);
  const inProgressCond = platform
    ? `${platformReadExistsSql('?')} AND ${uncompletedCond}`
    : "ta.status = 'in_progress'";
  const pendingCond = platform
    ? `NOT (${platformReadExistsSql('?')}) AND ${uncompletedCond}`
    : "ta.status = 'pending'";
  const platformSelectParams = platform ? [platform.readSource, platform.readSource] : [];

  const base = db.get(
    `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN ${inProgressCond} THEN 1 ELSE 0 END) AS in_progress_count,
         SUM(CASE WHEN ${pendingCond} THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN ${completedCond} AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS completed_on_time_count,
         AVG(CASE WHEN ${completedCond} AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours,
         MAX(ta.updated_at) AS last_updated
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}`,
    [...platformSelectParams, ...allParams]
  );

  const total = base.total || 0;
  const completedCnt = base.completed_count || 0;
  const inProgCnt = base.in_progress_count || 0;
  const pendingCnt = base.pending_count || 0;
  const completionRate = total > 0 ? parseFloat(((100 * completedCnt) / total).toFixed(2)) : 0;

  const completedOnTimeCnt = base.completed_on_time_count || 0;
  const onTimeCompletionRate =
    total > 0 ? parseFloat(((100 * completedOnTimeCnt) / total).toFixed(2)) : 0;
  const avgCompletionTimeHours =
    base.avg_completion_time_hours !== null && base.avg_completion_time_hours !== undefined
      ? parseFloat(base.avg_completion_time_hours)
      : 0;

  const overdueRow = db.get(
    `SELECT COUNT(*) AS cnt
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
         AND ${uncompletedCond}
         AND datetime('now', 'localtime') > t.ddl_at`,
    allParams
  );
  const overdueCount = (overdueRow && overdueRow.cnt) || 0;

  let pushUserCount = 0;
  if (drill.hasDrill && taskId) {
    const pr = db.get(
      `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt
         FROM notification_events ne
         JOIN stores s ON s.id = ne.store_id
         WHERE ne.task_id = ? AND ne.event_type = 'task_assigned' ${drill.sql}`,
      [taskId, ...drill.params]
    );
    pushUserCount = (pr && pr.cnt) || 0;
  } else {
    const pushRow = db.get(
      `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt
         FROM notification_events ne
         ${taskId ? "WHERE ne.task_id = ? AND ne.event_type = 'task_assigned'" : "WHERE ne.event_type = 'task_assigned'"}`,
      taskId ? [taskId] : []
    );
    pushUserCount = (pushRow && pushRow.cnt) || 0;
  }

  const baseNeCond = taskId ? 'ne.task_id = ?' : '1=1';
  const baseNeParam = taskId ? [taskId] : [];
  const readSource = platform ? platform.readSource : 'task_detail_open';

  let employeeReadCount = 0;
  let managerReadCount = 0;
  if (drill.hasDrill && taskId) {
    const readRow = db.get(
      `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         JOIN stores s ON s.id = ne.store_id
         WHERE ne.task_id = ? AND rr.source = ? ${drill.sql}`,
      [taskId, readSource, ...drill.params]
    );
    employeeReadCount = (readRow && readRow.cnt) || 0;
    managerReadCount = employeeReadCount;
  } else {
    const empReadRow = db.get(
      `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         WHERE ${baseNeCond}
           AND rr.source = ?`,
      [...baseNeParam, readSource]
    );
    employeeReadCount = (empReadRow && empReadRow.cnt) || 0;
    const mgrReadRow = db.get(
      `SELECT COUNT(DISTINCT rr.user_id) AS cnt
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         WHERE ${baseNeCond}
           AND rr.source = ?`,
      [...baseNeParam, readSource]
    );
    managerReadCount = (mgrReadRow && mgrReadRow.cnt) || 0;
  }
  const totalReadCount = employeeReadCount;

  const storeTaskRows = db.all(
    `SELECT
         ta.store_id,
         ta.task_id,
         t.ddl_at,
         t.created_at,
         t.auto_nudge_rules,
         SUM(CASE WHEN ${uncompletedCond} THEN 1 ELSE 0 END) AS uncompleted_count
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
       GROUP BY ta.store_id, ta.task_id`,
    allParams
  );
  let warnP1 = 0;
  let warnP0 = 0;
  let warnP2 = 0;
  for (const row of storeTaskRows) {
    if (!row.uncompleted_count) continue;
    const rules = parseAutoNudgeRules(row.auto_nudge_rules);
    const ddlAt = new Date(row.ddl_at).getTime();
    const hoursLeft = (ddlAt - nowMs) / (1000 * 60 * 60);
    const createdAtMs = new Date(row.task_created_at || row.created_at).getTime();
    const passedPct = ddlAt - createdAtMs > 0 ? ((nowMs - createdAtMs) / (ddlAt - createdAtMs)) * 100 : 100;
    const band = classifyDeadlineCrisisBand(rules, hoursLeft, passedPct);
    if (band === 'p0') warnP0++;
    else if (band === 'p1') warnP1++;
    else if (band === 'p2') warnP2++;
  }

  let total_nudged = 0;
  let converted_nudged = 0;
  try {
    const q = `
        SELECT
          COUNT(DISTINCT ne.target_user_id) AS total_nudged,
          COUNT(DISTINCT CASE 
            WHEN ${platform ? completedCondition(platform) : "ta.status = 'completed' AND ta.completed_at > ne.created_at"} THEN ne.target_user_id 
            ELSE NULL 
          END) AS converted_nudged
        FROM notification_events ne
        LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
        ${drill.hasDrill ? 'JOIN stores s ON s.id = ne.store_id' : ''}
        WHERE ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow')
          ${taskId ? 'AND ne.task_id = ?' : ''}
          ${drill.hasDrill ? `AND ${drill.sql.replace(/^\s*AND\s+/, '')}` : ''}
      `;
    const p = [...(taskId ? [taskId] : []), ...(drill.hasDrill ? drill.params : [])];
    const result = db.get(q, p);
    if (result) {
      total_nudged = result.total_nudged || 0;
      converted_nudged = result.converted_nudged || 0;
    }
  } catch (e) {
    /* ignore */
  }

  const nudgeRow = { total_nudged, converted_nudged };

  const nudgeConversionRate =
    nudgeRow.total_nudged > 0
      ? parseFloat(((100 * nudgeRow.converted_nudged) / nudgeRow.total_nudged).toFixed(2))
      : 0;

  const eventStats = db.all(
    `
      SELECT ne.severity, COUNT(DISTINCT ne.target_user_id) as cnt
      FROM notification_events ne
      JOIN task_assignments ta ON ne.assignment_id = ta.id
      ${joinStore}
      WHERE ${taConditions.join(' AND ')} ${storeWhere} 
        AND ne.event_type LIKE 'nudge_%'
      GROUP BY ne.severity
    `,
    allParams
  );

  let p0N = 0;
  let p1N = 0;
  let p2N = 0;
  for (const st of eventStats) {
    if (st.severity === 'red') p0N += st.cnt;
    if (st.severity === 'orange') p1N += st.cnt;
    if (st.severity === 'yellow') p2N += st.cnt;
  }

  const crisisP2Rate = total > 0 ? parseFloat(((100 * p2N) / total).toFixed(2)) : 0;
  const crisisP1Rate = total > 0 ? parseFloat(((100 * p1N) / total).toFixed(2)) : 0;
  const crisisP0Rate = total > 0 ? parseFloat(((100 * p0N) / total).toFixed(2)) : 0;

  const reachRow = db.get(
    `SELECT COUNT(ta.id) AS reached_count
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.employee_id
       ${joinStore}
       WHERE ${taConditions.join(' AND ')} ${storeWhere}
         AND (
           ${platform ? platformReadExistsSql('?') : '(u.last_login_at IS NOT NULL AND u.last_login_at >= ta.created_at) OR ta.received_at IS NOT NULL'}
         )`,
    platform ? [platform.readSource, ...allParams] : allParams
  );
  const reachedCount = (reachRow && reachRow.reached_count) || 0;
  const taskReachRate = total > 0 ? parseFloat(((reachedCount / total) * 100).toFixed(2)) : 0;

  return {
    totalAssignments: total,
    pushUserCount,
    employeeReadCount,
    managerReadCount,
    totalReadCount,

    completionRate,
    completedCount: completedCnt,
    onTimeCompletionRate,
    avgCompletionTimeHours,

    taskReachRate,
    taskReadRate: total > 0 ? parseFloat(((totalReadCount / total) * 100).toFixed(2)) : 0,
    nudgeConversionRate,

    crisisP2Rate,
    crisisP1Rate,
    crisisP0Rate,

    inProgressCount: inProgCnt,
    pendingCount: pendingCnt,
    overdueCount,
    warningCount: { p2: warnP2, p1: warnP1, p0: warnP0 },
    platform: platform ? platform.sourceLabel : null,
    updatedAt: base.last_updated || formatNowSqliteLocal(),
  };
}

/**
 * 与 GET /api/v1/dashboard/heatmap 的 data 字段一致。
 * @param {Record<string, string>} query 等价于 req.query（须含 taskId）
 */
function getHeatmapBoardData(query) {
  const { taskId, rtmLevel = 'rtm' } = query;
  if (!taskId) throw createError(400, 'taskId 为必填参数', 'DASH_001');

  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const level = String(rtmLevel).toLowerCase();

  const colMap = {
    rtm: 's.rtm',
    region: 's.region',
    format: 's.format',
    subrtm: 's.rtm',
    dealer: 's.dealer_name',
    dealer_name: 's.dealer_name',
    dealername: 's.dealer_name',
  };

  let selectDim;
  let groupByDim;
  if (level === 'store') {
    selectDim = 'MAX(s.name) AS rtm_value';
    groupByDim = 's.id';
  } else if (level === 'dealer' || level === 'dealer_name' || level === 'dealername') {
    selectDim = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS rtm_value";
    groupByDim = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '')";
  } else {
    const col = colMap[level] || 's.rtm';
    selectDim = `${col} AS rtm_value`;
    groupByDim = col;
  }

  const heatParams = [taskId, ...drill.params];
  const completedCond = completedCondition(platform);
  const inProgressCond = platform
    ? `${platformReadExistsSql('?')} AND ${uncompletedCondition(platform)}`
    : "ta.status = 'in_progress'";
  const rows = db.all(
    `SELECT
         ${selectDim},
         COUNT(ta.id) AS assignment_count,
         SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN ${inProgressCond} THEN 1 ELSE 0 END) AS in_progress_count,
         ROUND(100.0 * SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
         AVG(CASE WHEN ${completedCond} AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours,
         MAX(ta.updated_at) AS last_updated
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.task_id = ? ${drill.sql}
       GROUP BY ${groupByDim}
       ORDER BY completion_rate DESC`,
    platform ? [platform.readSource, ...heatParams] : heatParams
  );

  const heatmapData = rows.map((r) => ({
    rtmValue: r.rtm_value || '(未知)',
    completionRate: r.completion_rate || 0,
    avgCompletionTimeHours:
      r.avg_completion_time_hours !== null && r.avg_completion_time_hours !== undefined
        ? parseFloat(r.avg_completion_time_hours)
        : 0,
    color: heatmapColor(r.completion_rate || 0),
    assignmentCount: r.assignment_count,
    completedCount: r.completed_count,
    inProgressCount: r.in_progress_count,
  }));

  const updatedAt =
    rows.length > 0 ? rows.reduce((m, r) => (r.last_updated > m ? r.last_updated : m), '') : formatNowSqliteLocal();

  return {
    taskId,
    rtmLevel,
    platform: platform ? platform.sourceLabel : null,
    heatmapData,
    updatedAt,
  };
}

/**
 * 与 GET /api/v1/dashboard/trend 的 data 字段一致（daily / hourly）。
 * @param {Record<string, string>} query 等价于 req.query
 */
function getTrendBoardData(query) {
  const { taskId, type = 'daily', date } = query;
  if (!taskId) throw createError(400, 'taskId 不能为空', 'DASH_001');
  if (!['daily', 'hourly'].includes(type)) {
    throw createError(400, 'type 必须是 daily 或 hourly', 'DASH_005');
  }

  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);
  const targetDate = date || formatLocalDateYYYYMMDD();
  const joinStore = drill.hasDrill ? 'JOIN stores s ON s.id = ta.store_id' : '';
  const storeWhere = drill.hasDrill ? drill.sql : '';
  const trendParamsDaily = [taskId, ...drill.params];
  const trendParamsHourly = [taskId, targetDate, ...drill.params];
  const completedCond = completedCondition(platform);
  const completedAtExpr = platform ? 'COALESCE(ta.completed_at, ta.updated_at)' : 'ta.completed_at';

  let rows;
  if (type === 'daily') {
    rows = db.all(
      `SELECT
           date(${completedAtExpr}) AS time_key,
           COUNT(ta.id) AS new_completed
         FROM task_assignments ta
         ${joinStore}
         WHERE ta.task_id = ? AND ${completedCond} AND ${completedAtExpr} IS NOT NULL ${storeWhere}
         GROUP BY date(${completedAtExpr})
         ORDER BY date(${completedAtExpr}) ASC`,
      trendParamsDaily
    );
  } else {
    rows = db.all(
      `SELECT
           strftime('%H', ${completedAtExpr}) AS time_key,
           COUNT(ta.id) AS new_completed
         FROM task_assignments ta
         ${joinStore}
         WHERE ta.task_id = ? AND ${completedCond} AND ${completedAtExpr} IS NOT NULL
           AND date(${completedAtExpr}) = ? ${storeWhere}
         GROUP BY strftime('%H', ${completedAtExpr})
         ORDER BY strftime('%H', ${completedAtExpr}) ASC`,
      trendParamsHourly
    );
  }

  let cumulativeCount = 0;
  const trendData = rows.map((r) => {
    cumulativeCount += r.new_completed;
    return {
      timeKey: r.time_key,
      newCompleted: r.new_completed,
      cumulativeCompleted: cumulativeCount,
    };
  });

  return {
    taskId,
    type,
    date: targetDate,
    platform: platform ? platform.sourceLabel : null,
    trendData,
  };
}

/**
 * 与 GET /api/v1/dashboard/warnings 同源（聚合维度 = group level，默认 store）。
 * 返回 { platform, list, pagination }，list 中每条同 HTTP 路由响应一致。
 * @param {Record<string, string>} query 等价于 req.query；可包含 warningLevel/level/pageNum/pageSize
 */
function getWarningsBoardData(query) {
  const { taskId, warningLevel, pageNum = 1, pageSize = 20, level = 'store' } = query;
  if (warningLevel && !['p2', 'p1', 'p0', 'startDelay'].includes(warningLevel)) {
    throw createError(400, 'warningLevel 非法（p2/p1/p0/startDelay）', 'DASH_003');
  }
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

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
  const nowIso = formatNowSqliteLocal();
  const nowMs = Date.now();
  const completedCond = completedCondition(platform);
  const uncompletedCond = uncompletedCondition(platform);

  let selectId;
  let selectName;
  let groupByDim;
  const lvl = String(level).toLowerCase();
  if (lvl === 'rtm') {
    selectId = 's.rtm AS target_id';
    selectName = 's.rtm AS target_name';
    groupByDim = 's.rtm';
  } else if (lvl === 'format') {
    selectId = 's.format AS target_id';
    selectName = 's.format AS target_name';
    groupByDim = 's.format';
  } else if (lvl === 'dealer_name' || lvl === 'dealer') {
    selectId = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_id";
    selectName = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_name";
    groupByDim = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '')";
  } else {
    selectId = 's.id AS target_id';
    selectName = 's.name AS target_name';
    groupByDim = 's.id';
  }

  const mainSql = `
      SELECT
        ta.task_id,
        ${selectId},
        ${selectName},
        MAX(t.created_at) AS task_created_at,
        t.ddl_at,
        t.auto_nudge_rules,
        COUNT(ta.id) AS total_count,
        SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN ${uncompletedCond} THEN 1 ELSE 0 END) AS uncompleted_count,
        SUM(CASE WHEN ${uncompletedCond} AND ? > t.ddl_at THEN 1 ELSE 0 END) AS overdue_count,
        ROUND(100.0 * SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
        MAX(ta.updated_at) AS last_updated
      FROM task_assignments ta
      JOIN stores s ON s.id = ta.store_id
      JOIN tasks t ON t.id = ta.task_id
      WHERE ${whereClause}
      GROUP BY ${groupByDim}, ta.task_id
    `;
  const rawRows = db.all(mainSql, [nowIso, ...params]);

  const severityMap = { p0: 'red', p1: 'orange', p2: 'yellow' };
  const targetSeverity = severityMap[warningLevel];
  const historicalStats = {};
  if (targetSeverity && taskId) {
    const eventRows = db.all(
      `
        SELECT ${groupByDim} as target_id, COUNT(DISTINCT ne.target_user_id) as cnt
        FROM notification_events ne
        JOIN stores s ON s.id = ne.store_id
        WHERE ne.task_id = ? AND ne.severity = ?
        GROUP BY ${groupByDim}
      `,
      [taskId, targetSeverity]
    );
    for (const row of eventRows) {
      historicalStats[row.target_id] = row.cnt;
    }
  }

  const matched = [];
  for (const r of rawRows) {
    const createdAtMs = new Date(r.task_created_at).getTime();
    const ddlMs = new Date(r.ddl_at).getTime();
    const hoursLeft = (ddlMs - nowMs) / (1000 * 60 * 60);
    const passedMs = nowMs - createdAtMs;
    const totalDur = ddlMs - createdAtMs;
    const passedPct = totalDur > 0 ? (passedMs / totalDur) * 100 : 100;

    const rules = parseAutoNudgeRules(r.auto_nudge_rules);
    const band = classifyDeadlineCrisisBand(rules, hoursLeft, passedPct);

    const histCount = historicalStats[r.target_id] || 0;
    const isRealTimeMatch = band && (!warningLevel || warningLevel === band);
    const isHistoryMatch = warningLevel && histCount > 0;
    if (!isRealTimeMatch && !isHistoryMatch) continue;

    r._band = isRealTimeMatch ? band : warningLevel;
    r._riskCount = histCount > 0 ? histCount : r.uncompleted_count;
    r._warningRate = (r._riskCount / r.total_count) * 100;
    matched.push(r);
  }

  matched.sort((a, b) => (b._warningRate || 0) - (a._warningRate || 0));
  const total = matched.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const pageSlice = matched.slice(offset, offset + limit);

  const list = pageSlice.map((r) => {
    const band = r._band;
    const rules = parseAutoNudgeRules(r.auto_nudge_rules);
    const h = getDeadlineCrisisHours(rules);
    const completionRate = r.completion_rate || 0;
    const warningRate = r._warningRate ?? 0;

    let triggerDesc = '';
    if (band === 'p0') {
      triggerDesc = `距 Deadline 不足${h.p0Hours}小时，仍有 ${r.uncompleted_count} 人未完成（P0）`;
    } else if (band === 'p1') {
      triggerDesc = `距 Deadline 不足${h.p1Hours}小时，仍有 ${r.uncompleted_count} 人未完成（P1）`;
    } else if (band === 'p2') {
      triggerDesc = `任务时间进度已达 ${Number(h.p2Percent).toFixed(0)}% 阈值，仍有 ${r.uncompleted_count} 人未完成（P2）`;
    }

    return {
      taskId: r.task_id,
      targetId: r.target_id,
      targetName: r.target_name,
      targetType: lvl,
      storeId: r.target_id,
      storeName: r.target_name,
      warningLevel: band,
      warningRate,
      riskCount: r._riskCount,
      completionRate,
      completedCount: r.completed_count,
      totalCount: r.total_count,
      overdueCount: r.overdue_count,
      triggerDesc,
      aiSuggestion: '建议及时督促对应门店/区域进行学习',
      updatedAt: r.last_updated || nowIso,
    };
  });

  return {
    platform: platform ? platform.sourceLabel : null,
    list,
    pagination: { pageNum: page, pageSize: limit, total, totalPages },
  };
}

/**
 * 与 GET /api/v1/dashboard/nudge-conversion 同源。
 * @param {Record<string, string>} query
 */
function getNudgeConversionBoardData(query) {
  const { taskId, pageNum = 1, pageSize = 20, level = 'store' } = query;
  const drill = parseStoreDrill(query);
  const platform = parsePlatformFilter(query);

  const page = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  const conditions = ["ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow')"];
  const params = [];
  if (taskId) {
    conditions.push('ne.task_id = ?');
    params.push(taskId);
  }
  if (drill.hasDrill) {
    conditions.push(drill.sql.replace(/^\s*AND\s+/, ''));
    params.push(...drill.params);
  }

  const whereClause = conditions.join(' AND ');
  const nudgedConvertedCond = platform
    ? completedCondition(platform)
    : "ta.status = 'completed' AND ta.completed_at > ne.created_at";

  let selectId;
  let selectName;
  let groupByDim;
  const lvl = String(level).toLowerCase();
  if (lvl === 'rtm') {
    selectId = 's.rtm AS target_id';
    selectName = 's.rtm AS target_name';
    groupByDim = 's.rtm';
  } else if (lvl === 'format') {
    selectId = 's.format AS target_id';
    selectName = 's.format AS target_name';
    groupByDim = 's.format';
  } else if (lvl === 'dealer_name' || lvl === 'dealer') {
    selectId = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_id";
    selectName = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_name";
    groupByDim = "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '')";
  } else {
    selectId = 'ne.store_id AS target_id';
    selectName = 's.name AS target_name';
    groupByDim = 'ne.store_id';
  }

  const sql = `
      SELECT 
        ${selectId},
        ${selectName},
        ne.severity,
        COUNT(DISTINCT ne.target_user_id) AS total_nudged,
        COUNT(DISTINCT CASE 
          WHEN ${nudgedConvertedCond} THEN ne.target_user_id 
          ELSE NULL 
        END) AS converted_nudged
      FROM notification_events ne
      JOIN stores s ON s.id = ne.store_id
      LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
      WHERE ${whereClause}
      GROUP BY ${groupByDim}, ne.severity
      ORDER BY ${groupByDim} ASC
    `;

  const rawRows = db.all(sql, params);

  const map = new Map();
  for (const r of rawRows) {
    if (!map.has(r.target_id)) {
      map.set(r.target_id, {
        targetId: r.target_id,
        targetName: r.target_name,
        targetType: lvl,
        red: { nudged: 0, converted: 0, rate: 0 },
        orange: { nudged: 0, converted: 0, rate: 0 },
        yellow: { nudged: 0, converted: 0, rate: 0 },
        total: { nudged: 0, converted: 0, rate: 0 },
      });
    }
    const item = map.get(r.target_id);
    const sev = r.severity;
    if (item[sev]) {
      item[sev].nudged += r.total_nudged;
      item[sev].converted += r.converted_nudged;
      item[sev].rate =
        item[sev].nudged > 0
          ? parseFloat(((100 * item[sev].converted) / item[sev].nudged).toFixed(2))
          : 0;
    }
  }

  const totalSql = `
      SELECT 
        ${selectId},
        COUNT(DISTINCT ne.target_user_id) AS overall_nudged,
        COUNT(DISTINCT CASE 
          WHEN ${nudgedConvertedCond} THEN ne.target_user_id 
          ELSE NULL 
        END) AS overall_converted
      FROM notification_events ne
      JOIN stores s ON s.id = ne.store_id
      LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
      WHERE ${whereClause}
      GROUP BY ${groupByDim}
    `;

  const totalRows = db.all(totalSql, params);
  for (const tr of totalRows) {
    if (map.has(tr.target_id)) {
      const item = map.get(tr.target_id);
      item.total.nudged = tr.overall_nudged;
      item.total.converted = tr.overall_converted;
      item.total.rate =
        tr.overall_nudged > 0
          ? parseFloat(((100 * tr.overall_converted) / tr.overall_nudged).toFixed(2))
          : 0;
    }
  }

  const matched = Array.from(map.values());
  matched.sort((a, b) => b.total.nudged - a.total.nudged);

  const totalRecords = matched.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);
  const list = matched.slice(offset, offset + limit);

  return {
    platform: platform ? platform.sourceLabel : null,
    list,
    pagination: { pageNum: page, pageSize: limit, total: totalRecords, totalPages },
  };
}

module.exports = {
  heatmapColor,
  parsePlatformFilter,
  platformReadExistsSql,
  completedCondition,
  uncompletedCondition,
  getOverviewBoardData,
  getHeatmapBoardData,
  getTrendBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
};
