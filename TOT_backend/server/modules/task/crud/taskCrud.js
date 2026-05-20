'use strict';

/**
 * taskCrud.js — 任务发布模块数据访问层
 *
 * 拥有表（写）：task_publish, task_audience_rule, learner_task_queue,
 *              learner_task_reminder, task_reminder_log, campaign_activity
 * 供 A(看板) 只读调用 getTaskList / getQueueList / getReminderStats 等
 * 供 C(管理员) 只读调用 getCampaignList 等
 */

const { getDb } = require('../../common/db/connection');
const { get, all, run } = require('../../common/db/mysql');

// ═══════════════════════════════════════════════════════════════
// task_publish (MySQL)
// ═══════════════════════════════════════════════════════════════

async function getTaskById(id) {
  return await get(
    'SELECT * FROM task_publish WHERE task_publish_id = ?',
    [id]
  ) ?? null;
}

async function getTaskList({ week, statuses, modelType, limit, offset } = {}) {
  const cond = []; const p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    p.push(...statuses);
  }
  if (modelType) { cond.push('model_type = ?'); p.push(modelType); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  p.push(limit || 50, offset || 0);
  return await all(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
    p
  );
}

async function getTaskPage({ page, pageSize, week, statuses } = {}) {
  const cond = []; const p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    p.push(...statuses);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  const countRow = await get('SELECT COUNT(*) AS c FROM task_publish ' + where, p);
  const total = countRow ? countRow.c : 0;

  p.push(pageSize, (page - 1) * pageSize);
  const rows = await all(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
    p
  );

  return { rows, total, page, pageSize };
}

async function countTasks(where) {
  const cond = []; const p = [];
  if (where) {
    Object.keys(where).forEach(function(k) {
      cond.push(k + ' = ?'); p.push(where[k]);
    });
  }
  const w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const row = await get('SELECT COUNT(*) AS c FROM task_publish ' + w, p);
  return row ? row.c : 0;
}

function createTask(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO task_publish (task_publish_id, task_title, task_description, task_type, ' +
    'task_week, product_name, publish_status, start_date, due_date, ' +
    'model_type, required_flag, dynamic_eval_flag, enabled_flag, sort_order, ' +
    'fiscal_year, quarter_no, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.title, data.description, data.type,
    data.week, data.productName, data.status || 'draft',
    data.startDate, data.dueDate,
    data.modelType, data.requiredFlag || 0, data.dynamicEvalFlag || 0,
    data.enabledFlag || 1, data.sortOrder || 0,
    data.fiscalYear, data.quarterNo);
  return getTaskById(data.id);
}

function updateTask(id, data) {
  var keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return getTaskById(id);
  var setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  var values = keys.map(function(k) { return data[k]; });
  getDb().prepare(
    'UPDATE task_publish SET ' + setClause + ' WHERE task_publish_id = ?'
  ).run(...values.concat([id]));
  return getTaskById(id);
}

function deleteTask(id) {
  var r = getDb().prepare('DELETE FROM task_publish WHERE task_publish_id = ?').run(id);
  return r.changes > 0;
}

// ═══════════════════════════════════════════════════════════════
// task_audience_rule
// ═══════════════════════════════════════════════════════════════

function getAudienceRules(taskPublishId) {
  return getDb().prepare(
    'SELECT * FROM task_audience_rule WHERE task_publish_id = ? ORDER BY rule_group_no, sort_order'
  ).all(taskPublishId);
}

function createAudienceRule(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO task_audience_rule (audience_rule_id, task_publish_id, rule_group_no, ' +
    'source_scope, dimension_type, operator_type, rule_value_text, logic_connector, ' +
    'sort_order, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.taskPublishId, data.ruleGroupNo,
    data.sourceScope, data.dimensionType, data.operatorType,
    data.ruleValueText, data.logicConnector, data.sortOrder || 0);
  return data;
}

function deleteAudienceRule(id) {
  var r = getDb().prepare('DELETE FROM task_audience_rule WHERE audience_rule_id = ?').run(id);
  return r.changes > 0;
}

function deleteAudienceRulesByTask(taskPublishId) {
  var r = getDb().prepare('DELETE FROM task_audience_rule WHERE task_publish_id = ?').run(taskPublishId);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════
// learner_task_queue
// ═══════════════════════════════════════════════════════════════

function getQueueById(id) {
  return getDb().prepare(
    'SELECT * FROM learner_task_queue WHERE queue_id = ?'
  ).get(id) ?? null;
}

function getQueueList({ taskPublishId, emailId, status, storeAppleId, limit, offset } = {}) {
  var cond = []; var p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  if (status) { cond.push('status = ?'); p.push(status); }
  if (storeAppleId) { cond.push('store_apple_id = ?'); p.push(storeAppleId); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return getDb().prepare(
    'SELECT * FROM learner_task_queue ' + where +
    ' ORDER BY queue_id LIMIT ? OFFSET ?'
  ).all(...p.concat([limit || 50, offset || 0]));
}

function getQueuePage({ page, pageSize, taskPublishId, status } = {}) {
  var cond = []; var p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (status) { cond.push('status = ?'); p.push(status); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var total = getDb().prepare(
    'SELECT COUNT(*) AS c FROM learner_task_queue ' + where
  ).get(...p).c;

  var rows = getDb().prepare(
    'SELECT * FROM learner_task_queue ' + where +
    ' ORDER BY queue_id LIMIT ? OFFSET ?'
  ).all(...p.concat([pageSize, (page - 1) * pageSize]));

  return { rows: rows, total: total, page: page, pageSize: pageSize };
}

function countQueue(where) {
  var cond = []; var p = [];
  if (where) {
    Object.keys(where).forEach(function(k) {
      cond.push(k + ' = ?'); p.push(where[k]);
    });
  }
  var w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return getDb().prepare('SELECT COUNT(*) AS c FROM learner_task_queue ' + w).get(...p).c;
}

function createQueue(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, store_apple_id, ' +
    'status, progress, first_use_time, week_start_time, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.taskPublishId, data.emailId, data.storeAppleId,
    data.status || 'pending', data.progress || 0,
    data.firstUseTime, data.weekStartTime);
  return getQueueById(data.id);
}

function updateQueue(id, data) {
  var keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return getQueueById(id);
  var setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  var values = keys.map(function(k) { return data[k]; });
  getDb().prepare(
    'UPDATE learner_task_queue SET ' + setClause + ' WHERE queue_id = ?'
  ).run(...values.concat([id]));
  return getQueueById(id);
}

function deleteQueue(id) {
  var r = getDb().prepare('DELETE FROM learner_task_queue WHERE queue_id = ?').run(id);
  return r.changes > 0;
}

// 批量创建 learner_task_queue（发布时根据 audience_rule 圈选学员后调用）
function batchCreateQueue(entries) {
  var db = getDb();
  var stmt = db.prepare(
    'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, store_apple_id, ' +
    'status, created_at) VALUES (?, ?, ?, ?, \'pending\', datetime(\'now\', \'localtime\'))'
  );
  var tx = db.transaction(function(rows) {
    var count = 0;
    rows.forEach(function(e) {
      stmt.run(e.id, e.taskPublishId, e.emailId, e.storeAppleId);
      count++;
    });
    return count;
  });
  return tx(entries);
}

// ═══════════════════════════════════════════════════════════════
// learner_task_reminder
// ═══════════════════════════════════════════════════════════════

function getReminderList({ taskPublishId, level, emailId, limit, offset } = {}) {
  var cond = []; var p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (level) { cond.push('reminder_level = ?'); p.push(level); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return getDb().prepare(
    'SELECT * FROM learner_task_reminder ' + where +
    ' ORDER BY reminder_at DESC LIMIT ? OFFSET ?'
  ).all(...p.concat([limit || 50, offset || 0]));
}

function createReminder(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO learner_task_reminder (reminder_id, queue_id, task_publish_id, email_id, ' +
    'reminder_level, reminder_channel, reminder_at, reminder_result, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.queueId, data.taskPublishId, data.emailId,
    data.level, data.channel, data.reminderAt, data.result || 'pending');
  return data;
}

// ═══════════════════════════════════════════════════════════════
// task_reminder_log
// ═══════════════════════════════════════════════════════════════

function getReminderLogList({ taskPublishId, emailId, level, limit, offset } = {}) {
  var cond = []; var p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  if (level) { cond.push('reminder_level = ?'); p.push(level); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return getDb().prepare(
    'SELECT * FROM task_reminder_log ' + where +
    ' ORDER BY reminder_at DESC LIMIT ? OFFSET ?'
  ).all(...p.concat([limit || 50, offset || 0]));
}

function getReminderLogStats({ taskWeek, groupBy } = {}) {
  var db = getDb();
  var cond = []; var p = [];
  if (taskWeek) { cond.push('tp.task_week = ?'); p.push(taskWeek); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var groups = { reminder_level: 'trl.reminder_level',
    reminder_channel: 'trl.reminder_channel', reminder_result: 'trl.reminder_result' };
  var gc = groups[groupBy] || 'trl.reminder_level';

  return db.prepare(
    'SELECT ' + gc + ' AS group_value, COUNT(*) AS total, ' +
    'SUM(CASE WHEN trl.reminder_result = \'success\' THEN 1 ELSE 0 END) AS success_count ' +
    'FROM task_reminder_log trl ' +
    'JOIN task_publish tp ON tp.task_publish_id = trl.task_publish_id ' +
    where + ' GROUP BY ' + gc + ' ORDER BY total DESC'
  ).all(...p);
}

function createReminderLog(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO task_reminder_log (reminder_log_id, task_publish_id, email_id, ' +
    'store_apple_id, reminder_level, reminder_channel, reminder_at, reminder_result, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.taskPublishId, data.emailId, data.storeAppleId,
    data.level, data.channel, data.reminderAt, data.result);
  return data;
}

// ═══════════════════════════════════════════════════════════════
// campaign_activity
// ═══════════════════════════════════════════════════════════════

function getCampaignById(id) {
  return getDb().prepare(
    'SELECT * FROM campaign_activity WHERE activity_id = ?'
  ).get(id) ?? null;
}

function getCampaignList({ fiscalYear, quarterNo, limit, offset } = {}) {
  var cond = []; var p = [];
  if (fiscalYear) { cond.push('fiscal_year = ?'); p.push(fiscalYear); }
  if (quarterNo) { cond.push('quarter_no = ?'); p.push(quarterNo); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return getDb().prepare(
    'SELECT * FROM campaign_activity ' + where +
    ' ORDER BY fiscal_year DESC, quarter_no DESC LIMIT ? OFFSET ?'
  ).all(...p.concat([limit || 50, offset || 0]));
}

function createCampaign(data) {
  var db = getDb();
  db.prepare(
    'INSERT INTO campaign_activity (activity_id, task_week, product_name, ' +
    'fiscal_year, quarter_no, start_date, due_date, enabled_flag, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))'
  ).run(data.id, data.taskWeek, data.productName,
    data.fiscalYear, data.quarterNo, data.startDate, data.dueDate,
    data.enabledFlag || 1);
  return getCampaignById(data.id);
}

function updateCampaign(id, data) {
  var keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return getCampaignById(id);
  var setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  var values = keys.map(function(k) { return data[k]; });
  getDb().prepare(
    'UPDATE campaign_activity SET ' + setClause + ' WHERE activity_id = ?'
  ).run(...values.concat([id]));
  return getCampaignById(id);
}

function deleteCampaign(id) {
  var r = getDb().prepare('DELETE FROM campaign_activity WHERE activity_id = ?').run(id);
  return r.changes > 0;
}

// ═══════════════════════════════════════════════════════════════
// 批量删除（供 taskService 事务使用）
// ═══════════════════════════════════════════════════════════════

function deleteQueuesByTask(taskPublishId) {
  return getDb().prepare('DELETE FROM learner_task_queue WHERE task_publish_id = ?').run(taskPublishId).changes;
}

function deleteRemindersByTask(taskPublishId) {
  return getDb().prepare('DELETE FROM learner_task_reminder WHERE task_publish_id = ?').run(taskPublishId).changes;
}

function deleteReminderLogsByTask(taskPublishId) {
  return getDb().prepare('DELETE FROM task_reminder_log WHERE task_publish_id = ?').run(taskPublishId).changes;
}

function deleteTaskCascade(taskPublishId) {
  const db = getDb();
  return db.transaction(() => {
    deleteRemindersByTask(taskPublishId);
    deleteReminderLogsByTask(taskPublishId);
    deleteQueuesByTask(taskPublishId);
    deleteAudienceRulesByTask(taskPublishId);
    deleteTask(taskPublishId);
  })();
}

// ═══════════════════════════════════════════════════════════════
// auto-nudge 辅助（旧表，TODO: 新表迁移时替换）
// ═══════════════════════════════════════════════════════════════

function getOldTaskForNudge(taskId) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) ?? null;
}

function getDispatchedTasksWithNudgeRules() {
  return getDb().prepare(
    "SELECT id FROM tasks WHERE status = 'dispatched' AND auto_nudge_rules IS NOT NULL AND TRIM(auto_nudge_rules) != '' AND TRIM(auto_nudge_rules) != 'null'"
  ).all();
}

function getUncompletedAssignmentsForNudge(taskId) {
  return getDb().prepare(
    'SELECT ta.*, s.rtm, s.format FROM task_assignments ta ' +
    'JOIN stores s ON ta.store_id = s.id ' +
    'WHERE ta.task_id = ? AND ta.status != ?'
  ).all(taskId, 'completed');
}

function checkNudgeDedupeKey(dedupeKey) {
  return !!getDb().prepare('SELECT id FROM notification_events WHERE dedupe_key = ?').get(dedupeKey);
}

function createAutoNudgeRecord(data) {
  getDb().prepare(
    'INSERT INTO nudge_records (id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(data.id, data.taskId, data.targetType, data.targetId, data.initiatorId, data.severity, data.eventIdsJson, data.createdAt);
}

function createAutoNudgeEvent(data) {
  getDb().prepare(
    'INSERT INTO notification_events (id, task_id, assignment_id, target_user_id, store_id, event_type, severity, initiator_id, dedupe_key, content, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(data.id, data.taskId, data.assignmentId, data.userId, data.storeId, data.eventType, data.severity, data.initiatorId, data.dedupeKey, data.content, data.createdAt);
}

function incrementAssignmentNudgeCount(assignmentId, now) {
  getDb().prepare('UPDATE task_assignments SET nudge_count = nudge_count + 1, updated_at = ? WHERE id = ?')
    .run(now, assignmentId);
}

function createAutoNudgeTransaction(data) {
  return getDb().transaction(() => {
    createAutoNudgeRecord(data.record);
    createAutoNudgeEvent(data.event);
    incrementAssignmentNudgeCount(data.assignmentId, data.now);
  })();
}

module.exports = {
  // task_publish
  getTaskById, getTaskList, getTaskPage, createTask, updateTask, deleteTask, countTasks,
  // task_audience_rule
  getAudienceRules, createAudienceRule, deleteAudienceRule, deleteAudienceRulesByTask,
  // learner_task_queue
  getQueueById, getQueueList, getQueuePage, countQueue, createQueue, updateQueue, deleteQueue, batchCreateQueue,
  deleteQueuesByTask,
  // learner_task_reminder
  getReminderList, createReminder, deleteRemindersByTask,
  // task_reminder_log
  getReminderLogList, getReminderLogStats, createReminderLog, deleteReminderLogsByTask,
  // campaign_activity
  getCampaignById, getCampaignList, createCampaign, updateCampaign, deleteCampaign,
  // cascade
  deleteTaskCascade,
  // auto-nudge (old tables, TODO: new table migration)
  getOldTaskForNudge,
  getDispatchedTasksWithNudgeRules,
  getUncompletedAssignmentsForNudge,
  checkNudgeDedupeKey,
  createAutoNudgeRecord,
  createAutoNudgeEvent,
  incrementAssignmentNudgeCount,
  createAutoNudgeTransaction,
};
