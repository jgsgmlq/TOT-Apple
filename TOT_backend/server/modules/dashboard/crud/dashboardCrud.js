'use strict';

/**
 * dashboardCrud.js — 看板数据访问层
 *
 * 所有 DB 访问集中于此文件，service 层通过本模块获取数据。
 *
 * Section A（当前生产）: 使用旧表名（tasks, task_assignments, stores, notification_events,
 *   read_receipts, users, employees, dashboard_insights）
 * Section B（未来目标）: 使用新表名（task_publish, learner_task_queue, reseller_store, ...）
 *   待 DB 组交付新 schema DDL 后激活。
 */

const { getDb } = require('../../common/db/connection');

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

const DIM_COL_MAP = {
  rtm: 's.rtm', region: 's.region', format: 's.format',
  subrtm: 's.rtm', dealer: 's.dealer_name',
  dealer_name: 's.dealer_name', dealername: 's.dealer_name',
};

function buildDimensionSelect(level, alias) {
  const lvl = String(level).toLowerCase();
  if (lvl === 'store') return { selectDim: `MAX(s.name) AS ${alias}`, groupByDim: 's.id' };
  if (lvl === 'dealer' || lvl === 'dealer_name' || lvl === 'dealername') {
    return {
      selectDim: `COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS ${alias}`,
      groupByDim: "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '')",
    };
  }
  const col = DIM_COL_MAP[lvl] || 's.rtm';
  return { selectDim: `${col} AS ${alias}`, groupByDim: col };
}

function buildLevelColumns(level) {
  const lvl = String(level).toLowerCase();
  if (lvl === 'rtm') return { selectId: 's.rtm AS target_id', selectName: 's.rtm AS target_name', groupByDim: 's.rtm' };
  if (lvl === 'format') return { selectId: 's.format AS target_id', selectName: 's.format AS target_name', groupByDim: 's.format' };
  if (lvl === 'dealer_name' || lvl === 'dealer') {
    return {
      selectId: "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_id",
      selectName: "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '(未知)') AS target_name",
      groupByDim: "COALESCE(NULLIF(TRIM(s.dealer_name), ''), '')",
    };
  }
  return { selectId: 's.id AS target_id', selectName: 's.name AS target_name', groupByDim: 's.id' };
}

function buildDrillJoin(drill) {
  if (!drill || !drill.hasDrill) return { join: '', where: '', params: [] };
  return { join: 'JOIN stores s ON s.id = ta.store_id', where: drill.sql, params: drill.params };
}

function buildDrillJoinNE(drill, neAlias, sAlias) {
  if (!drill || !drill.hasDrill) return { join: '', where: '', params: [] };
  return {
    join: `JOIN stores ${sAlias} ON ${sAlias}.id = ${neAlias}.store_id`,
    where: drill.sql,
    params: drill.params,
  };
}

function buildCompletedCond(platform, alias) {
  if (!platform) return `${alias}.status = 'completed'`;
  return `${alias}.${platform.completedColumn} = 1`;
}

function buildUncompletedCond(platform, alias) {
  if (!platform) return `${alias}.status != 'completed'`;
  return `COALESCE(${alias}.${platform.completedColumn}, 0) != 1`;
}

function buildReadExistsExpr(readSourceParam, alias) {
  return `EXISTS (
    SELECT 1 FROM read_receipts rrp
    JOIN notification_events nep ON nep.id = rrp.event_id
    WHERE nep.assignment_id = ${alias}.id
      AND rrp.user_id = ${alias}.user_id
      AND rrp.source = ${readSourceParam}
  )`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section A — 当前生产（旧表名）
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Task queries ───────────────────────────────────────────────────

function getTaskById(taskId) {
  if (!taskId) return null;
  return getDb().prepare(
    'SELECT id, title, ddl_at, created_at, auto_nudge_rules, mypal_product_name, mypal_task_week FROM tasks WHERE id = ?'
  ).get(taskId) ?? null;
}

function findTasksByName(searchTerm) {
  const db = getDb();
  const term = String(searchTerm || '').toLowerCase().trim();
  if (!term) return [];
  const tasks = db.prepare('SELECT id, title, mypal_product_name FROM tasks ORDER BY created_at DESC').all();
  const results = [];
  for (const t of tasks) {
    const tTitle = t.title.toLowerCase();
    if (tTitle.includes(term) || term.includes(tTitle)) { results.push(t); }
  }
  if (results.length > 0) return results;

  const aliases = [
    { keys: ['phone', 'iphone', '17'], id: 'TASK_A' },
    { keys: ['pod', 'airpods'], id: 'TASK_B' },
    { keys: ['mac', 'macbook'], id: 'TASK_WARN_START' },
    { keys: ['watch', 'apple watch'], id: 'TASK_WARN_P0' },
    { keys: ['pad', 'ipad'], id: 'TASK_WARN_P1' },
    { keys: ['mono', '新春'], id: 'TASK_C' },
  ];
  for (const alias of aliases) {
    for (const key of alias.keys) {
      if (term.includes(key)) return tasks.filter(t => t.id === alias.id);
    }
  }
  const searchTokens = term.replace(/[^a-zA-Z0-9一-龥]/g, ' ').split(/\s+/).filter(Boolean);
  if (searchTokens.length > 0) {
    let best = null; let maxOverlap = 0;
    for (const t of tasks) {
      let overlap = 0;
      for (const token of searchTokens) {
        if (token.length > 1 && t.title.toLowerCase().includes(token)) overlap++;
      }
      if (overlap > maxOverlap) { maxOverlap = overlap; best = t; }
    }
    if (best) return [best];
  }
  return [];
}

// ─── Assignment aggregates ──────────────────────────────────────────

function queryAssignmentBaseAgg({ taskId, drill, platform, extraSelect = '', extraWhere = '', extraParams = [] }) {
  const db = getDb();
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const allParams = [...params, ...dp, ...extraParams];
  const completedCond = buildCompletedCond(platform, 'ta');
  const inProgCond = platform
    ? `${buildReadExistsExpr('?', 'ta')} AND ${buildUncompletedCond(platform, 'ta')}`
    : "ta.status = 'in_progress'";
  const pendingCond = platform
    ? `NOT (${buildReadExistsExpr('?', 'ta')}) AND ${buildUncompletedCond(platform, 'ta')}`
    : "ta.status = 'pending'";
  const psp = platform ? [platform.readSource, platform.readSource] : [];

  return db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
       SUM(CASE WHEN ${inProgCond} THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN ${pendingCond} THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN ${completedCond} AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS completed_on_time_count,
       AVG(CASE WHEN ${completedCond} AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours
       ${extraSelect},
       MAX(ta.updated_at) AS last_updated
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${join}
     WHERE ${conds.join(' AND ')} ${where} ${extraWhere}`
  ).get(...psp, ...allParams) ?? null;
}

function queryAssignmentGroupedAgg({ taskId, drill, platform, selectDim, groupByDim, having = '', orderBy = '', extraSelect = '', extraWhere = '' }) {
  const db = getDb();
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const allParams = [...params, ...dp];
  const completedCond = buildCompletedCond(platform, 'ta');
  const inProgCond = platform
    ? `${buildReadExistsExpr('?', 'ta')} AND ${buildUncompletedCond(platform, 'ta')}`
    : "ta.status = 'in_progress'";
  const psp = platform ? [platform.readSource] : [];

  return db.prepare(
    `SELECT ${selectDim},
       COUNT(ta.id) AS assignment_count,
       SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) AS completed_count,
       SUM(CASE WHEN ${inProgCond} THEN 1 ELSE 0 END) AS in_progress_count,
       ROUND(100.0 * SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END) / COUNT(ta.id), 2) AS completion_rate,
       AVG(CASE WHEN ${completedCond} AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_completion_time_hours,
       MAX(ta.updated_at) AS last_updated
       ${extraSelect}
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks t ON t.id = ta.task_id
     WHERE ${conds.join(' AND ')} ${where} ${extraWhere}
     GROUP BY ${groupByDim} ${having} ${orderBy}`
  ).all(...psp, ...allParams);
}

function queryAssignmentDetails({ taskId, drill, platform, extraWhere = '', extraColumns = '' }) {
  const db = getDb();
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const allParams = [...params, ...dp];

  return db.prepare(
    `SELECT ta.id, ta.task_id, ta.user_id, ta.store_id, ta.status, ta.progress,
       ta.completed_at, ta.received_at, ta.started_at, ta.nudge_count,
       t.created_at, t.ddl_at, t.auto_nudge_rules
       ${extraColumns}
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${join}
     WHERE ${conds.join(' AND ')} ${where} ${extraWhere}`
  ).all(...allParams);
}

function queryAssignmentScopeCount({ taskId, drill }) {
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const row = getDb().prepare(
    `SELECT COUNT(*) AS total FROM task_assignments ta ${join}
     WHERE ${conds.join(' AND ')} ${where}`
  ).get(...params, ...dp);
  return (row && row.total) || 0;
}

// ─── Push/Notification counts ──────────────────────────────────────

function countPushUsers({ taskId, drill }) {
  if (drill && drill.hasDrill && taskId) {
    const d = buildDrillJoinNE(drill, 'ne', 's');
    const row = getDb().prepare(
      `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt FROM notification_events ne ${d.join}
       WHERE ne.task_id = ? AND ne.event_type = 'task_assigned' ${d.where}`
    ).get(taskId, ...d.params);
    return (row && row.cnt) || 0;
  }
  const row = getDb().prepare(
    `SELECT COUNT(DISTINCT ne.target_user_id) AS cnt FROM notification_events ne
     WHERE ne.event_type = 'task_assigned' ${taskId ? 'AND ne.task_id = ?' : ''}`
  ).get(...(taskId ? [taskId] : []));
  return (row && row.cnt) || 0;
}

function countNudgeUsersBySeverity({ taskId, drill, platform }) {
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);

  return getDb().prepare(
    `SELECT ne.severity, COUNT(DISTINCT ne.target_user_id) as cnt
     FROM notification_events ne
     JOIN task_assignments ta ON ne.assignment_id = ta.id
     ${join}
     WHERE ${conds.join(' AND ')} ${where}
       AND ne.event_type LIKE 'nudge_%'
     GROUP BY ne.severity`
  ).all(...params, ...dp);
}

// ─── Read receipt counts ───────────────────────────────────────────

function countReadUsers({ taskId, drill, source }) {
  const src = source || 'task_detail_open';
  if (drill && drill.hasDrill && taskId) {
    const row = getDb().prepare(
      `SELECT COUNT(DISTINCT rr.user_id) AS cnt FROM read_receipts rr
       JOIN notification_events ne ON ne.id = rr.event_id
       JOIN stores s ON s.id = ne.store_id
       WHERE ne.task_id = ? AND rr.source = ? ${drill.sql}`
    ).get(taskId, src, ...drill.params);
    return (row && row.cnt) || 0;
  }
  const cond = taskId ? 'ne.task_id = ?' : '1=1';
  const prm = taskId ? [taskId] : [];
  const row = getDb().prepare(
    `SELECT COUNT(DISTINCT rr.user_id) AS cnt FROM read_receipts rr
     JOIN notification_events ne ON ne.id = rr.event_id
     WHERE ${cond} AND rr.source = ?`
  ).get(...prm, src);
  return (row && row.cnt) || 0;
}

function countReadUsersBySourceSet({ taskId, drill, source }) {
  const rows = getDb().prepare(
    `SELECT DISTINCT rr.user_id FROM read_receipts rr
     JOIN notification_events ne ON ne.id = rr.event_id
     ${drill && drill.hasDrill ? 'JOIN stores s ON s.id = ne.store_id' : ''}
     WHERE ne.task_id = ? AND rr.source = ?
     ${drill && drill.hasDrill ? drill.sql : ''}`
  ).all(taskId, source, ...(drill && drill.hasDrill ? drill.params : []));
  return new Set(rows.map(r => r.user_id));
}

// ─── Overdue / Reach ───────────────────────────────────────────────

function countOverdueAssignments({ taskId, drill, platform }) {
  const conds = []; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const uncompletedCond = buildUncompletedCond(platform, 'ta');
  const row = getDb().prepare(
    `SELECT COUNT(*) AS cnt FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     ${join}
     WHERE ${conds.length ? conds.join(' AND ') : '1=1'} ${where}
       AND ${uncompletedCond}
       AND datetime('now', 'localtime') > t.ddl_at`
  ).get(...params, ...dp);
  return (row && row.cnt) || 0;
}

function countReachedAssignments({ taskId, drill, platform }) {
  const conds = []; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  const reachCond = platform
    ? buildReadExistsExpr('?', 'ta')
    : "(u.last_login_at IS NOT NULL AND u.last_login_at >= ta.created_at) OR ta.received_at IS NOT NULL";
  const allParams = platform
    ? [platform.readSource, ...params, ...dp]
    : [...params, ...dp];
  const row = getDb().prepare(
    `SELECT COUNT(ta.id) AS reached_count FROM task_assignments ta
     JOIN users u ON ta.user_id = u.employee_id
     ${join}
     WHERE ${conds.length ? conds.join(' AND ') : '1=1'} ${where}
       AND (${reachCond})`
  ).get(...allParams);
  return (row && row.reached_count) || 0;
}

// ─── Nudge conversion ──────────────────────────────────────────────

function queryNudgeConversion({ taskId, drill, platform, level = 'store', limit = 20, offset = 0 }) {
  const conds = ["ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow')"];
  const params = [];
  if (taskId) { conds.push('ne.task_id = ?'); params.push(taskId); }
  const d = buildDrillJoinNE(drill, 'ne', 's');
  if (d.where) { conds.push(d.where.replace(/^\s*AND\s+/, '')); params.push(...d.params); }
  const whereClause = conds.join(' AND ');
  const nudgedConvCond = platform
    ? buildCompletedCond(platform, 'ta')
    : "ta.status = 'completed' AND ta.completed_at > ne.created_at";
  const { selectId, selectName, groupByDim } = buildLevelColumns(level === 'store' ? 'store' : level);
  const useStoreJoin = (level === 'store');
  const selId = useStoreJoin ? 'ne.store_id AS target_id' : selectId;
  const selName = useStoreJoin ? 's.name AS target_name' : selectName;
  const gb = useStoreJoin ? 'ne.store_id' : groupByDim;

  return getDb().prepare(
    `SELECT ${selId}, ${selName}, ne.severity,
       COUNT(DISTINCT ne.target_user_id) AS total_nudged,
       COUNT(DISTINCT CASE WHEN ${nudgedConvCond} THEN ne.target_user_id ELSE NULL END) AS converted_nudged
     FROM notification_events ne
     JOIN stores s ON s.id = ne.store_id
     LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
     WHERE ${whereClause}
     GROUP BY ${gb}, ne.severity
     ORDER BY ${gb} ASC`
  ).all(...params);
}

function queryNudgeConversionTotals({ taskId, drill, platform, level = 'store' }) {
  const conds = ["ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow')"];
  const params = [];
  if (taskId) { conds.push('ne.task_id = ?'); params.push(taskId); }
  const d = buildDrillJoinNE(drill, 'ne', 's');
  if (d.where) { conds.push(d.where.replace(/^\s*AND\s+/, '')); params.push(...d.params); }
  const whereClause = conds.join(' AND ');
  const nudgedConvCond = platform
    ? buildCompletedCond(platform, 'ta')
    : "ta.status = 'completed' AND ta.completed_at > ne.created_at";
  const { selectId, groupByDim } = buildLevelColumns(level === 'store' ? 'store' : level);
  const useStoreJoin = (level === 'store');
  const selId = useStoreJoin ? 'ne.store_id AS target_id' : selectId;
  const gb = useStoreJoin ? 'ne.store_id' : groupByDim;

  return getDb().prepare(
    `SELECT ${selId},
       COUNT(DISTINCT ne.target_user_id) AS overall_nudged,
       COUNT(DISTINCT CASE WHEN ${nudgedConvCond} THEN ne.target_user_id ELSE NULL END) AS overall_converted
     FROM notification_events ne
     JOIN stores s ON s.id = ne.store_id
     LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
     WHERE ${whereClause}
     GROUP BY ${gb}`
  ).all(...params);
}

// ─── Completions / Trend ───────────────────────────────────────────

function queryDailyCompletions({ taskId, drill, platform, completedAtExpr }) {
  const expr = completedAtExpr || 'ta.completed_at';
  const conds = [`${expr} IS NOT NULL`]; const params = [taskId];
  const { join, where, params: dp } = buildDrillJoin(drill);
  const completedCond = buildCompletedCond(platform, 'ta');

  return getDb().prepare(
    `SELECT date(${expr}) AS time_key, COUNT(ta.id) AS new_completed
     FROM task_assignments ta ${join}
     WHERE ta.task_id = ? AND ${completedCond} AND ${conds[0]} ${where}
     GROUP BY date(${expr}) ORDER BY date(${expr}) ASC`
  ).all(...params, ...dp);
}

function queryHourlyCompletions({ taskId, drill, platform, date, completedAtExpr }) {
  const expr = completedAtExpr || 'ta.completed_at';
  const conds = [`${expr} IS NOT NULL`, `date(${expr}) = ?`];
  const params = [taskId, date];
  const { join, where, params: dp } = buildDrillJoin(drill);
  const completedCond = buildCompletedCond(platform, 'ta');

  return getDb().prepare(
    `SELECT strftime('%H', ${expr}) AS time_key, COUNT(ta.id) AS new_completed
     FROM task_assignments ta ${join}
     WHERE ta.task_id = ? AND ${completedCond} AND ${conds[0]} AND ${conds[1]} ${where}
     GROUP BY strftime('%H', ${expr}) ORDER BY strftime('%H', ${expr}) ASC`
  ).all(...params, ...dp);
}

// ─── Warnings ──────────────────────────────────────────────────────

function queryWarningAggregate({ taskId, drill, platform, level = 'store', nowIso }) {
  const conds = ['1=1']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const d = buildDrillJoinNE(drill, 'ta', 's');
  if (d.where) { conds.push(d.where.replace(/^\s*AND\s+/, '')); params.push(...d.params); }
  const whereClause = conds.join(' AND ');
  const completedCond = buildCompletedCond(platform, 'ta');
  const uncompletedCond = buildUncompletedCond(platform, 'ta');
  const { selectId, selectName, groupByDim } = buildLevelColumns(level);

  return getDb().prepare(
    `SELECT ta.task_id, ${selectId}, ${selectName},
       MAX(t.created_at) AS task_created_at, t.ddl_at, t.auto_nudge_rules,
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
     GROUP BY ${groupByDim}, ta.task_id`
  ).all(nowIso, ...params);
}

function queryWarningHistoricalEvents({ taskId, severity, level = 'store' }) {
  const { groupByDim } = buildLevelColumns(level);
  return getDb().prepare(
    `SELECT ${groupByDim} as target_id, COUNT(DISTINCT ne.target_user_id) as cnt
     FROM notification_events ne
     JOIN stores s ON s.id = ne.store_id
     WHERE ne.task_id = ? AND ne.severity = ?
     GROUP BY ${groupByDim}`
  ).all(taskId, severity);
}

// ─── Channel / Store analytics ─────────────────────────────────────

function queryChannelStats({ taskId, drill }) {
  const d = buildDrillJoinNE(drill, 'ta', 's');
  return getDb().prepare(
    `SELECT s.rtm AS channel,
       COUNT(ta.id) AS total_count,
       SUM(CASE WHEN ta.status='completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time_count,
       AVG(CASE WHEN ta.status='completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL
                THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 * 60 END) AS avg_minutes
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.task_id = ? ${d.where}
     GROUP BY s.rtm`
  ).all(taskId, ...d.params);
}

function queryStoreRank({ taskId, drill, order = 'DESC', limit = 3 }) {
  const d = buildDrillJoinNE(drill, 'ta', 's');
  const having = order === 'ASC' ? 'HAVING rate < 100' : '';
  return getDb().prepare(
    `SELECT s.id AS store_id, s.name AS store_name,
       ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 1) AS rate,
       COUNT(ta.id) AS n
     FROM task_assignments ta
     JOIN stores s ON s.id = ta.store_id
     WHERE ta.task_id = ? ${d.where}
     GROUP BY ta.store_id
     ${having}
     ORDER BY rate ${order}, s.id ASC LIMIT ?`
  ).all(taskId, ...d.params, limit);
}

function queryNudgeStats({ taskId, drill }) {
  const conds = ['ta.nudge_count > 0']; const params = [];
  if (taskId) { conds.push('ta.task_id = ?'); params.push(taskId); }
  const { join, where, params: dp } = buildDrillJoin(drill);
  return getDb().prepare(
    `SELECT COUNT(ta.id) AS total_nudged,
       SUM(CASE WHEN ta.started_at IS NOT NULL OR ta.status = 'completed' THEN 1 ELSE 0 END) AS converted_nudged
     FROM task_assignments ta ${join}
     WHERE ${conds.join(' AND ')} ${where}`
  ).get(...params, ...dp) ?? null;
}

// ─── Push users grouped (funnel drill-down) ───────────────────────

function queryPushUsersGrouped({ taskId, drill, selectDim, groupByDim }) {
  const d = buildDrillJoinNE(drill, 'ne', 's');
  return getDb().prepare(
    `SELECT ${selectDim}, COUNT(DISTINCT ne.target_user_id) AS entity_count
     FROM notification_events ne
     JOIN stores s ON s.id = ne.store_id
     WHERE ne.task_id = ? AND ne.event_type = 'task_assigned' ${d.where}
     GROUP BY ${groupByDim}
     ORDER BY entity_count DESC`
  ).all(taskId, ...d.params);
}

// ─── Nudge conversion aggregate (single total) ─────────────────────

function queryNudgeConversionAggregate({ taskId, drill, platform }) {
  const conds = ["ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow')"];
  const params = [];
  if (taskId) { conds.push('ne.task_id = ?'); params.push(taskId); }
  const d = buildDrillJoinNE(drill, 'ne', 's');
  if (d.where) { conds.push(d.where.replace(/^\s*AND\s+/, '')); params.push(...d.params); }
  const whereClause = conds.join(' AND ');
  const nudgedConvCond = platform
    ? buildCompletedCond(platform, 'ta')
    : "ta.status = 'completed' AND ta.completed_at > ne.created_at";

  return getDb().prepare(
    `SELECT COUNT(DISTINCT ne.target_user_id) AS total_nudged,
       COUNT(DISTINCT CASE WHEN ${nudgedConvCond} THEN ne.target_user_id END) AS converted_nudged
     FROM notification_events ne
     LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
     ${d.join}
     WHERE ${whereClause}`
  ).get(...params, ...d.params) ?? null;
}

// ─── Insight CRUD ──────────────────────────────────────────────────

function insertInsight({ id, moduleType, taskId, rtm, format, dealerName, storeId, extraParams, content, facts, userId }) {
  getDb().prepare(
    `INSERT INTO dashboard_insights (
       id, module_type, task_id, filter_rtm, filter_format, filter_dealer_name, filter_store_id,
       extra_params_json, content, context_json, up_count, down_count, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(
    id, moduleType, taskId,
    rtm || null, format || null, dealerName || null, storeId || null,
    JSON.stringify(extraParams), content, JSON.stringify(facts), userId
  );
}

function getInsightById(id) {
  return getDb().prepare('SELECT * FROM dashboard_insights WHERE id = ?').get(id) ?? null;
}

function getInsightCreatedAt(id) {
  const row = getDb().prepare('SELECT created_at AS t FROM dashboard_insights WHERE id = ?').get(id);
  return row ? row.t : null;
}

function getInsightVotes(id) {
  return getDb().prepare(
    'SELECT up_count AS up, down_count AS down FROM dashboard_insights WHERE id = ?'
  ).get(id) ?? null;
}

function incrementInsightVote(id, voteType) {
  const col = voteType === 'up' ? 'up_count' : 'down_count';
  getDb().prepare(`UPDATE dashboard_insights SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
}

function decrementInsightVote(id, voteType) {
  const col = voteType === 'up' ? 'up_count' : 'down_count';
  getDb().prepare(
    `UPDATE dashboard_insights SET ${col} = ${col} - 1 WHERE id = ? AND ${col} > 0`
  ).run(id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section B — 未来目标（新表名，待 DB 组交付 DDL 后激活）
// ═══════════════════════════════════════════════════════════════════════════════

function getOverviewMetrics({ taskWeek, storeAppleId, hqAppleId } = {}) {
  const db = getDb();
  const cond = []; const p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  if (storeAppleId) { cond.push('ltq.store_apple_id = ?'); p.push(storeAppleId); }
  if (hqAppleId) { cond.push('rs.hq_apple_id = ?'); p.push(hqAppleId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return db.prepare(
    'SELECT ' +
    'COUNT(DISTINCT ltq.queue_id) AS total_assignments, ' +
    'SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) AS completed_count, ' +
    'ROUND(100.0 * SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) / ' +
    'NULLIF(COUNT(DISTINCT ltq.queue_id), 0), 2) AS completion_rate, ' +
    'COUNT(DISTINCT tp.task_publish_id) AS total_tasks, ' +
    'COUNT(DISTINCT ltq.email_id) AS total_learners ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'JOIN reseller_store rs ON rs.store_apple_id = ltq.store_apple_id ' + where
  ).get(...p) ?? null;
}

function getTrendData({ taskWeeks = [], dimension = 'store' } = {}) {
  const db = getDb();
  if (!taskWeeks.length) return [];
  const ph = taskWeeks.map(() => '?').join(',');
  const gb = dimension === 'rtm' ? 'rs.rtm4_name' : 'rs.store_name';

  return db.prepare(
    'SELECT tp.task_week, ' + gb + ' AS dimension_value, ' +
    'COUNT(DISTINCT ltq.queue_id) AS total_assignments, ' +
    'SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) AS completed_count, ' +
    'ROUND(100.0 * SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) / ' +
    'NULLIF(COUNT(DISTINCT ltq.queue_id), 0), 2) AS completion_rate ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'JOIN reseller_store rs ON rs.store_apple_id = ltq.store_apple_id ' +
    'WHERE tp.task_week IN (' + ph + ') ' +
    'GROUP BY tp.task_week, ' + gb + ' ORDER BY tp.task_week, ' + gb
  ).all(...taskWeeks);
}

function getWarningData({ threshold = 30, taskWeek } = {}) {
  const db = getDb();
  const cond = []; const p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  const where = cond.length ? 'AND ' + cond.join(' AND ') : '';

  return db.prepare(
    'SELECT rs.store_name, rs.store_name_localized, rs.rtm4_name, rs.reseller_name, ' +
    'COUNT(DISTINCT ltq.queue_id) AS total_assignments, ' +
    'SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) AS completed_count, ' +
    'ROUND(100.0 * SUM(CASE WHEN ltq.status != \'completed\' THEN 1 ELSE 0 END) / ' +
    'NULLIF(COUNT(DISTINCT ltq.queue_id), 0), 2) AS incomplete_rate ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'JOIN reseller_store rs ON rs.store_apple_id = ltq.store_apple_id ' +
    'WHERE ltq.status != \'completed\' ' + where + ' ' +
    'GROUP BY rs.reseller_store_id HAVING incomplete_rate > ? ORDER BY incomplete_rate DESC'
  ).all(...p, threshold);
}

function getHeatmapData({ taskWeek, dimension = 'rtm4_name' } = {}) {
  const db = getDb();
  const cond = []; const p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var dims = { rtm4_name: 'rs.rtm4_name', sub_region: 'rs.sub_region_code',
    country: 'rs.country_region_name', dealer: 'rs.reseller_name', store: 'rs.store_name' };
  var dc = dims[dimension] || 'rs.rtm4_name';

  return db.prepare(
    'SELECT ' + dc + ' AS dimension_value, ' +
    'COUNT(DISTINCT ltq.queue_id) AS total_assignments, ' +
    'SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) AS completed_count, ' +
    'ROUND(100.0 * SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) / ' +
    'NULLIF(COUNT(DISTINCT ltq.queue_id), 0), 2) AS completion_rate ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'JOIN reseller_store rs ON rs.store_apple_id = ltq.store_apple_id ' +
    where + ' GROUP BY ' + dc + ' ORDER BY completion_rate ASC'
  ).all(...p);
}

function getFunnelData({ taskPublishId } = {}) {
  if (!taskPublishId) return null;
  return getDb().prepare(
    'SELECT COUNT(DISTINCT queue_id) AS total_assigned, ' +
    'SUM(CASE WHEN status != \'pending\' THEN 1 ELSE 0 END) AS started, ' +
    'SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) AS completed, ' +
    'SUM(CASE WHEN passed_week IS NOT NULL THEN 1 ELSE 0 END) AS passed ' +
    'FROM learner_task_queue WHERE task_publish_id = ?'
  ).get(taskPublishId) ?? null;
}

function getReminderStats({ taskWeek, groupBy = 'reminder_level' } = {}) {
  const db = getDb();
  const cond = []; const p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var groups = { reminder_level: 'ltr.reminder_level',
    reminder_channel: 'ltr.reminder_channel', reminder_result: 'ltr.reminder_result' };
  var gc = groups[groupBy] || 'ltr.reminder_level';

  return db.prepare(
    'SELECT ' + gc + ' AS group_value, COUNT(*) AS total_reminders, ' +
    'SUM(CASE WHEN ltr.reminder_result = \'success\' THEN 1 ELSE 0 END) AS success_count, ' +
    'SUM(CASE WHEN ltr.reminder_result = \'rejected\' THEN 1 ELSE 0 END) AS rejected_count ' +
    'FROM learner_task_reminder ltr ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltr.task_publish_id ' +
    where + ' GROUP BY ' + gc + ' ORDER BY total_reminders DESC'
  ).all(...p);
}

function getReminderLogList({ taskWeek, emailId, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const cond = []; const p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  if (emailId) { cond.push('trl.email_id = ?'); p.push(emailId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return db.prepare(
    'SELECT trl.*, tp.task_title, rs.store_name ' +
    'FROM task_reminder_log trl ' +
    'JOIN task_publish tp ON tp.task_publish_id = trl.task_publish_id ' +
    'LEFT JOIN reseller_store rs ON rs.store_apple_id = trl.store_apple_id ' +
    where + ' ORDER BY trl.reminder_at DESC LIMIT ? OFFSET ?'
  ).all(...p, limit, offset);
}

function getExecutiveMetrics({ taskWeek, dimension, storeId } = {}) {
  var d = dimension || 'all';
  var db = getDb();
  var cond = []; var p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  if (storeId) { cond.push('rs.reseller_store_id = ?'); p.push(storeId); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var dimMap = { all: null, rtm4: 'rs.rtm4_name', format: 'rs.sub_region_code',
    dealer: 'rs.reseller_name', store: 'rs.reseller_store_id' };
  var dc = dimMap[d];
  var gc = dc ? ', ' + dc : '';
  var sd = dc ? dc + ' AS dimension_value,' : '';

  var sql = 'SELECT ' + sd +
    'COUNT(DISTINCT ltq.queue_id) AS total_assignments, ' +
    'SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) AS completed_count, ' +
    'ROUND(100.0 * SUM(CASE WHEN ltq.status = \'completed\' THEN 1 ELSE 0 END) / ' +
    'NULLIF(COUNT(DISTINCT ltq.queue_id), 0), 2) AS completion_rate ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'JOIN reseller_store rs ON rs.store_apple_id = ltq.store_apple_id ' +
    where + ' GROUP BY tp.task_publish_id' + gc + ' ORDER BY tp.task_week DESC';

  return dc ? db.prepare(sql).all(...p) : db.prepare(sql).get(...p) ?? null;
}

function getStoreDrillData({ storeAppleId, taskWeek } = {}) {
  var db = getDb();
  if (!storeAppleId) return [];
  var cond = ['ltq.store_apple_id = ?']; var p = [storeAppleId];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }

  return db.prepare(
    'SELECT tp.task_publish_id, tp.task_title, tp.task_week, tp.publish_status, ' +
    'ltq.queue_id, ltq.email_id, ltq.status, ltq.progress, ltq.passed_week, ltq.completed_at, ' +
    'la.apple_role_name, la.user_business_role_name ' +
    'FROM learner_task_queue ltq ' +
    'JOIN task_publish tp ON tp.task_publish_id = ltq.task_publish_id ' +
    'LEFT JOIN learner_account la ON la.email_id = ltq.email_id ' +
    'WHERE ' + cond.join(' AND ') + ' ORDER BY tp.task_week DESC, ltq.status'
  ).all(...p);
}

module.exports = {
  // A: current production (old tables)
  getTaskById,
  findTasksByName,
  queryAssignmentBaseAgg,
  queryAssignmentGroupedAgg,
  queryAssignmentDetails,
  queryAssignmentScopeCount,
  countPushUsers,
  countNudgeUsersBySeverity,
  countReadUsers,
  countReadUsersBySourceSet,
  countOverdueAssignments,
  countReachedAssignments,
  queryPushUsersGrouped,
  queryNudgeConversion,
  queryNudgeConversionTotals,
  queryNudgeConversionAggregate,
  queryDailyCompletions,
  queryHourlyCompletions,
  queryWarningAggregate,
  queryWarningHistoricalEvents,
  queryChannelStats,
  queryStoreRank,
  queryNudgeStats,
  insertInsight,
  getInsightById,
  getInsightCreatedAt,
  getInsightVotes,
  incrementInsightVote,
  decrementInsightVote,

  // helpers (used by service layer for dimension/condition building)
  buildDimensionSelect,
  buildLevelColumns,
  buildCompletedCond,
  buildUncompletedCond,
  buildReadExistsExpr,

  // B: future schema target (new tables)
  getOverviewMetrics,
  getTrendData,
  getWarningData,
  getHeatmapData,
  getFunnelData,
  getReminderStats,
  getReminderLogList,
  getExecutiveMetrics,
  getStoreDrillData,
};
