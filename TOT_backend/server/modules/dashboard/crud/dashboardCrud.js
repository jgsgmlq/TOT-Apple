'use strict';

/**
 * dashboardCrud.js — 看板数据访问层（纯聚合查询，不拥有表）
 *
 * 依赖 B(task-publish) 和 C(admin) 的 crud 提供底层数据。
 * 待 DB 组交付 DDL 后微调列类型（预计改动 < 5%）。
 */

const { getDb } = require('../../common/db/connection');

// ─── 概览 ───────────────────────────────────────────────────────

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

// ─── 趋势 ───────────────────────────────────────────────────────

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

// ─── 预警 ───────────────────────────────────────────────────────

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

// ─── 热力图 ─────────────────────────────────────────────────────

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

// ─── 漏斗 ───────────────────────────────────────────────────────

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

// ─── 催办统计 ───────────────────────────────────────────────────

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

// ─── 催办日志列表 ───────────────────────────────────────────────

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

// ─── 高管指标 ───────────────────────────────────────────────────

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

// ─── 门店下钻 ───────────────────────────────────────────────────

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
  getOverviewMetrics, getTrendData, getWarningData, getHeatmapData,
  getFunnelData, getReminderStats, getReminderLogList,
  getExecutiveMetrics, getStoreDrillData,
};
