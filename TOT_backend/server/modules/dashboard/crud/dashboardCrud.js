'use strict';

/**
 * dashboardCrud.js — Dashboard data access (SQLite)
 *
 * insight CRUD (6 functions) — used by insightService.js
 * executive metrics (5 functions) — used by executiveMetricsService.js (not migrated, stays on SQLite)
 *
 * 所有 DB 访问集中于此文件，service 层通过本模块获取数据。
 * 当前生产使用 SQLite 旧表名（tasks, task_assignments, stores, notification_events,
 * read_receipts, users, employees, dashboard_insights）。
 * 将来迁移 MySQL 新表时，store/learner/account 数据应走跨模块 crud（admin），
 * task/queue/reminder 数据走跨模块 crud（task）。
 */

const { getDb } = require('../../common/db/connection');

// ═══════════════════════════════════════════════════════════════════
// Internal helpers (needed by executive metrics functions)
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Executive metrics functions — SQLite (not migrated)
// ═══════════════════════════════════════════════════════════════════

const PRODUCT_ALIAS_MAP = [
  { keys: ['phone', 'iphone', '17'], id: 'TASK_A' },
  { keys: ['pod', 'airpods'], id: 'TASK_B' },
  { keys: ['mac', 'macbook'], id: 'TASK_WARN_START' },
  { keys: ['watch', 'apple watch'], id: 'TASK_WARN_P0' },
  { keys: ['pad', 'ipad'], id: 'TASK_WARN_P1' },
  { keys: ['mono', '新春'], id: 'TASK_C' },
];

function findTasksByName(searchTerm) {
  const db = getDb();
  const term = String(searchTerm || '').toLowerCase().trim();
  if (!term) return [];
  // 扩大加载范围，避免由于只加载最新的 100 条而导致搜不到旧任务
  const tasks = db.prepare('SELECT id, title, mypal_product_name FROM tasks ORDER BY created_at DESC LIMIT 2000').all();
  const results = [];
  for (const t of tasks) {
    const tTitle = t.title.toLowerCase();
    if (tTitle.includes(term) || term.includes(tTitle)) { results.push(t); }
  }
  if (results.length > 0) return results;

  for (const alias of PRODUCT_ALIAS_MAP) {
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

const METRIC_FRAGMENTS = {
  completion_rate: `ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2)`,
  completed_count: `SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END)`,
  total_count: `COUNT(ta.id)`,
  avg_completion_time_hours: `AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END)`,
};

function getMetricSelectFragments(metricNames) {
  const entries = [];
  for (const m of metricNames) {
    if (METRIC_FRAGMENTS[m]) entries.push(`${METRIC_FRAGMENTS[m]} AS ${m}`);
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════════
// Insight CRUD — SQLite (used by insightService.js)
// ═══════════════════════════════════════════════════════════════════

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

module.exports = {
  // Insight CRUD (used by insightService.js)
  insertInsight,
  getInsightById,
  getInsightCreatedAt,
  getInsightVotes,
  incrementInsightVote,
  decrementInsightVote,
  // Executive metrics (used by executiveMetricsService.js — not migrated, stays on SQLite)
  findTasksByName,
  queryAssignmentGroupedAgg,
  queryAssignmentDetails,
  countReadUsersBySourceSet,
  getMetricSelectFragments,
};
