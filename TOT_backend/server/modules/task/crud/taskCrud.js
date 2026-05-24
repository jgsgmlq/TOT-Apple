'use strict';

/**
 * taskCrud.js — 任务发布模块数据访问层
 *
 * 拥有表（写）：task_publish, task_audience_rule, learner_task_queue,
 *              learner_task_reminder, task_reminder_log, campaign_activity
 * 供 A(看板) 只读调用 getTaskList / getQueueList / getReminderStats 等
 * 供 C(管理员) 只读调用 getCampaignList 等
 */

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

async function getTaskList({ week, statuses, limit, offset } = {}) {
  const cond = []; const p = [];
  if (week) { cond.push('task_week = ?'); p.push(week); }
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(function() { return '?'; }).join(',') + ')');
    p.push(...statuses);
  }
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

async function createTask(data) {
  // MySQL task_publish 列：id → task_publish_id, title → task_title, status → publish_status
  await run(
    'INSERT INTO task_publish (task_publish_id, task_title, task_description, task_type, publish_status, start_date, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.title, data.description, data.type, data.status || 'draft', data.startDate, data.dueDate, data.createdBy || 'system']
  );
  return await getTaskById(data.id);
}

async function updateTask(id, data) {
  const keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return await getTaskById(id);
  const setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  const values = keys.map(function(k) { return data[k]; });
  await run(
    'UPDATE task_publish SET ' + setClause + ' WHERE task_publish_id = ?',
    values.concat([id])
  );
  return await getTaskById(id);
}

async function deleteTask(id) {
  const r = await run('DELETE FROM task_publish WHERE task_publish_id = ?', [id]);
  return r.changes > 0;
}

// ═══════════════════════════════════════════════════════════════
// task_audience_rule
// ═══════════════════════════════════════════════════════════════

async function getAudienceRules(taskPublishId) {
  // MySQL 用 task_audience_group 替代表 task_audience_rule
  return await all(
    'SELECT * FROM task_audience_group WHERE group_desc = ? ORDER BY group_name',
    [taskPublishId]
  );
}

async function createAudienceRule(data) {
  await run(
    'INSERT INTO task_audience_group (audience_group_id, group_name, group_desc, group_enabled_flag, created_by) VALUES (?, ?, ?, ?, ?)',
    [data.id, data.ruleGroupNo || 'rule', data.taskPublishId, 1, data.createdBy || 'system']
  );
  return data;
}

async function deleteAudienceRule(id) {
  const r = await run('DELETE FROM task_audience_group WHERE audience_group_id = ?', [id]);
  return r.changes > 0;
}

async function deleteAudienceRulesByTask(taskPublishId) {
  const r = await run('DELETE FROM task_audience_group WHERE group_desc = ?', [taskPublishId]);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════
// learner_task_queue
// ═══════════════════════════════════════════════════════════════

async function getQueueById(id) {
  return await get(
    'SELECT * FROM learner_task_queue WHERE queue_id = ?', [id]
  ) ?? null;
}

async function getQueueList({ taskPublishId, emailId, limit, offset } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  return await all(
    'SELECT * FROM learner_task_queue ' + where +
    ' ORDER BY queue_id LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function getQueuePage({ page, pageSize, taskPublishId } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

  const countRow = await get(
    'SELECT COUNT(*) AS c FROM learner_task_queue ' + where, p
  );
  const total = countRow ? countRow.c : 0;

  const rows = await all(
    'SELECT * FROM learner_task_queue ' + where +
    ' ORDER BY queue_id LIMIT ? OFFSET ?',
    p.concat([pageSize || 20, ((page || 1) - 1) * (pageSize || 20)])
  );

  return { rows, total, page: page || 1, pageSize: pageSize || 20 };
}

async function countQueue(where) {
  const cond = []; const p = [];
  if (where) {
    Object.keys(where).forEach(function(k) {
      cond.push(k + ' = ?'); p.push(where[k]);
    });
  }
  const w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const row = await get('SELECT COUNT(*) AS c FROM learner_task_queue ' + w, p);
  return row ? row.c : 0;
}

async function createQueue(data) {
  await run(
    'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, priority_level, created_by) VALUES (?, ?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.status || 'pending', data.createdBy || 'system']
  );
  return await getQueueById(data.id);
}

async function updateQueue(id, data) {
  const keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return await getQueueById(id);
  const setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  const values = keys.map(function(k) { return data[k]; });
  await run('UPDATE learner_task_queue SET ' + setClause + ' WHERE queue_id = ?', values.concat([id]));
  return await getQueueById(id);
}

async function deleteQueue(id) {
  const r = await run('DELETE FROM learner_task_queue WHERE queue_id = ?', [id]);
  return r.changes > 0;
}

async function batchCreateQueue(entries) {
  let count = 0;
  for (const e of entries) {
    await run(
      'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, priority_level, created_by) VALUES (?, ?, ?, ?, ?)',
      [e.id, e.taskPublishId, e.emailId, 'pending', e.createdBy || 'system']
    );
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════
// learner_task_reminder (MySQL)
// ═══════════════════════════════════════════════════════════════

async function getReminderList({ taskPublishId, level, emailId, limit, offset } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (level) { cond.push('reminder_level = ?'); p.push(level); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM learner_task_reminder ' + where + ' ORDER BY reminder_at DESC LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function createReminder(data) {
  await run(
    'INSERT INTO learner_task_reminder (reminder_id, task_publish_id, email_id, reminder_level, reminder_result, reminder_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.level, data.result || 'pending', data.reminderAt, data.createdAt || new Date().toISOString()]
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════
// task_reminder_log (MySQL)
// ═══════════════════════════════════════════════════════════════

async function getReminderLogList({ taskPublishId, emailId, level, limit, offset } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  if (level) { cond.push('reminder_level = ?'); p.push(level); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM task_reminder_log ' + where + ' ORDER BY reminder_at DESC LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function getReminderLogStats({ taskWeek, groupBy } = {}) {
  const gc = { reminder_level: 'reminder_level', reminder_channel: 'reminder_channel', reminder_result: 'reminder_result' }[groupBy] || 'reminder_level';
  const cond = []; const p = [];
  if (taskWeek) { cond.push('campaign_activity.task_week = ?'); p.push(taskWeek); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT ' + gc + ' AS group_value, COUNT(*) AS total, ' +
    'SUM(CASE WHEN reminder_result = ? THEN 1 ELSE 0 END) AS success_count ' +
    'FROM task_reminder_log ' + where + ' GROUP BY ' + gc + ' ORDER BY total DESC',
    ['sent'].concat(p)
  );
}

async function createReminderLog(data) {
  await run(
    'INSERT INTO task_reminder_log (reminder_log_id, task_publish_id, email_id, reminder_level, reminder_channel, reminder_at, reminder_result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.level, data.channel || 'auto', data.reminderAt, data.result || 'sent', data.createdAt || new Date().toISOString()]
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════
// campaign_activity (MySQL)
// ═══════════════════════════════════════════════════════════════

async function getCampaignById(id) {
  return await get('SELECT * FROM campaign_activity WHERE activity_id = ?', [id]) ?? null;
}

async function getCampaignList({ fiscalYear, quarterNo, limit, offset } = {}) {
  const cond = []; const p = [];
  if (fiscalYear) { cond.push('fiscal_year = ?'); p.push(fiscalYear); }
  if (quarterNo) { cond.push('quarter_no = ?'); p.push(quarterNo); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM campaign_activity ' + where + ' ORDER BY fiscal_year DESC, quarter_no DESC LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function createCampaign(data) {
  await run(
    'INSERT INTO campaign_activity (activity_id, task_week, topic_name, fiscal_year, quarter_no, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [data.id, data.taskWeek, data.productName || data.topicName, data.fiscalYear, data.quarterNo, data.createdBy || 'system']
  );
  return await getCampaignById(data.id);
}

async function updateCampaign(id, data) {
  const keys = Object.keys(data).filter(function(k) { return data[k] !== undefined; });
  if (!keys.length) return await getCampaignById(id);
  const setClause = keys.map(function(k) { return k + ' = ?'; }).join(', ');
  const values = keys.map(function(k) { return data[k]; });
  await run('UPDATE campaign_activity SET ' + setClause + ' WHERE activity_id = ?', values.concat([id]));
  return await getCampaignById(id);
}

async function deleteCampaign(id) {
  const r = await run('DELETE FROM campaign_activity WHERE activity_id = ?', [id]);
  return r.changes > 0;
}

// ═══════════════════════════════════════════════════════════════
// 批量删除
// ═══════════════════════════════════════════════════════════════

async function deleteQueuesByTask(taskPublishId) {
  const r = await run('DELETE FROM learner_task_queue WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

async function deleteRemindersByTask(taskPublishId) {
  const r = await run('DELETE FROM learner_task_reminder WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

async function deleteReminderLogsByTask(taskPublishId) {
  const r = await run('DELETE FROM task_reminder_log WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

async function deleteTaskCascade(taskPublishId) {
  await deleteRemindersByTask(taskPublishId);
  await deleteReminderLogsByTask(taskPublishId);
  await deleteQueuesByTask(taskPublishId);
  await deleteAudienceRulesByTask(taskPublishId);
  await deleteTask(taskPublishId);
}

// ═══════════════════════════════════════════════════════════════
// auto-nudge 辅助 — MySQL 迁移完成
// ═══════════════════════════════════════════════════════════════

async function getOldTaskForNudge(taskId) {
  return await get(
    'SELECT task_publish_id AS id, publish_status AS status, task_title AS title, created_at, due_date AS ddl_at FROM task_publish WHERE task_publish_id = ?', [taskId]
  ) ?? null;
}

async function getDispatchedTasksWithNudgeRules() {
  // MySQL task_publish 暂未加 auto_nudge_rules 列，返回空；需要时再 ALTER TABLE
  return [];
}

async function getUncompletedAssignmentsForNudge(taskId) {
  return await all(
    `SELECT tpl.task_publish_learner_id AS id, tpl.learner_id AS user_id,
            tpl.task_publish_id AS task_id, la.store_apple_id AS store_id,
            COALESCE(AVG(mps.progress), 0) AS progress,
            la.rtm_level_4_name AS format
     FROM task_publish_learner tpl
     JOIN learner_account la ON tpl.learner_id = la.learner_id
     LEFT JOIN mypal_learning_progress_sync mps ON la.email_id = mps.email_id AND mps.required_flag = 1
     WHERE tpl.task_publish_id = ? AND (mps.passed_time IS NULL OR mps.passed_time IS NULL)
     GROUP BY tpl.task_publish_learner_id, tpl.learner_id, la.store_apple_id, la.rtm_level_4_name`,
    [taskId]
  );
}

async function checkNudgeDedupeKey(dedupeKey) {
  const row = await get(
    'SELECT reminder_log_id FROM task_reminder_log WHERE reminder_channel = ? LIMIT 1',
    [dedupeKey]
  );
  return !!row;
}

async function createAutoNudgeRecord(data) {
  await run(
    'INSERT INTO task_reminder_log (reminder_log_id, task_publish_id, email_id, reminder_level, reminder_channel, reminder_result, reminder_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.taskId, data.emailId || data.targetId, data.severity || 'yellow', data.eventIdsJson || '', 'sent', data.createdAt, data.createdAt]
  );
}

async function createAutoNudgeEvent(data) {
  await run(
    'INSERT INTO learner_task_reminder (reminder_id, task_publish_id, email_id, reminder_level, reminder_result, reminder_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.taskId, data.userId, data.severity || 'yellow', 'pending', data.createdAt, data.createdAt]
  );
}

async function incrementAssignmentNudgeCount(assignmentId, now) {
  // MySQL task_publish_learner 无 nudge_count，从 learner_task_reminder 统计
  void assignmentId; void now; // no-op: schema differ
}

async function createAutoNudgeTransaction(data) {
  await createAutoNudgeRecord(data.record);
  await createAutoNudgeEvent(data.event);
  await incrementAssignmentNudgeCount(data.assignmentId, data.now);
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
