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

// ═══════════════════════════════════════════════════════════════
// task_publish
// ═══════════════════════════════════════════════════════════════

function getTaskById(id) {
  return getDb().prepare(
    'SELECT * FROM task_publish WHERE task_publish_id = ?'
  ).get(id) ?? null;
}

function getTaskList({ week, statuses, modelType, limit, offset } = {}) {
  var cond = []; var p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    p.push.apply(p, statuses);
  }
  if (modelType) { cond.push('model_type = ?'); p.push(modelType); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return getDb().prepare(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY task_week DESC, sort_order LIMIT ? OFFSET ?'
  ).all.apply(getDb().prepare(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY task_week DESC, sort_order LIMIT ? OFFSET ?'
  ), p.concat([limit || 50, offset || 0]));
}

function getTaskListFixed({ week, statuses, modelType, limit, offset } = {}) {
  var cond = []; var p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    Array.prototype.push.apply(p, statuses);
  }
  if (modelType) { cond.push('model_type = ?'); p.push(modelType); }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var allParams = p.concat([limit || 50, offset || 0]);
  return getDb().prepare(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY task_week DESC, sort_order LIMIT ? OFFSET ?'
  ).all(...allParams);
}

function getTaskPage({ page, pageSize, week, statuses } = {}) {
  var cond = []; var p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    Array.prototype.push.apply(p, statuses);
  }
  var where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  var total = getDb().prepare(
    'SELECT COUNT(*) AS c FROM task_publish ' + where
  ).get(...p).c;

  var rows = getDb().prepare(
    'SELECT * FROM task_publish ' + where +
    ' ORDER BY task_week DESC, sort_order LIMIT ? OFFSET ?'
  ).all(...p.concat([pageSize, (page - 1) * pageSize]));

  return { rows: rows, total: total, page: page, pageSize: pageSize };
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

function countTasks(where) {
  var cond = []; var p = [];
  if (where) {
    Object.keys(where).forEach(function(k) {
      cond.push(k + ' = ?'); p.push(where[k]);
    });
  }
  var w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return getDb().prepare('SELECT COUNT(*) AS c FROM task_publish ' + w).get(...p).c;
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

module.exports = {
  // task_publish
  getTaskById, getTaskList, getTaskListFixed, getTaskPage, createTask, updateTask, deleteTask, countTasks,
  // task_audience_rule
  getAudienceRules, createAudienceRule, deleteAudienceRule, deleteAudienceRulesByTask,
  // learner_task_queue
  getQueueById, getQueueList, getQueuePage, countQueue, createQueue, updateQueue, deleteQueue, batchCreateQueue,
  // learner_task_reminder
  getReminderList, createReminder,
  // task_reminder_log
  getReminderLogList, getReminderLogStats, createReminderLog,
  // campaign_activity
  getCampaignById, getCampaignList, createCampaign, updateCampaign, deleteCampaign,
};
