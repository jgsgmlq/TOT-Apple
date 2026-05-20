'use strict';

const { get, all, run, withTransaction } = require('../../common/db/mysql');

// ─── 事务内批量写入（供 batch* 与 dispatch / create 复用）────────────────────

async function insertQueueRows(conn, entries) {
  for (const e of entries) {
    await conn.query(
      'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, priority_level) VALUES (?, ?, ?, ?)',
      [e.id, e.taskPublishId, e.emailId, e.priorityLevel || 'new']
    );
  }
  return entries.length;
}

async function insertReminderRows(conn, entries) {
  for (const e of entries) {
    await conn.query(
      'INSERT INTO learner_task_reminder (reminder_id, task_publish_id, email_id, reminder_level) VALUES (?, ?, ?, ?)',
      [e.id, e.taskPublishId, e.emailId, e.level]
    );
  }
  return entries.length;
}

async function insertLearnerPublishRows(conn, entries) {
  for (const e of entries) {
    await conn.query(
      'INSERT INTO task_publish_learner (task_publish_learner_id, task_publish_id, learner_id, source_audience_group_id, created_by) VALUES (?, ?, ?, ?, ?)',
      [e.id, e.taskPublishId, e.learnerId, e.audienceGroupId || null, e.createdBy || null]
    );
  }
  return entries.length;
}

async function insertAudienceConditionRows(conn, entries) {
  for (const e of entries) {
    await conn.query(
      'INSERT INTO task_audience_condition (audience_condition_id, audience_group_id, dimension_type, operator_type, condition_value_text, condition_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e.id, e.groupId, e.dimensionType, e.operatorType, e.conditionValueText, e.order ?? 0, e.createdBy || null]
    );
  }
  return entries.length;
}

// ═══════════════════════════════════════════════════════════════════
// task_publish
// ═══════════════════════════════════════════════════════════════════

async function getTaskById(id) {
  return await get('SELECT * FROM task_publish WHERE task_publish_id = ?', [id]);
}

async function getTaskList({ statuses, modelType, limit, offset } = {}) {
  const cond = []; const p = [];
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(() => '?').join(',') + ')');
    p.push(...statuses);
  }
  if (modelType) { cond.push('platform_scope = ?'); p.push(modelType); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM task_publish ' + where + ' ORDER BY start_date DESC LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function getTaskPage({ page, pageSize, statuses } = {}) {
  const cond = []; const p = [];
  if (statuses && statuses.length) {
    cond.push('publish_status IN (' + statuses.map(() => '?').join(',') + ')');
    p.push(...statuses);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const row = await get('SELECT COUNT(*) AS c FROM task_publish ' + where, p);
  const rows = await all(
    'SELECT * FROM task_publish ' + where + ' ORDER BY start_date DESC LIMIT ? OFFSET ?',
    p.concat([pageSize, (page - 1) * pageSize])
  );
  return { rows, total: row.c, page, pageSize };
}

async function createTask(data) {
  await run(
    'INSERT INTO task_publish (task_publish_id, task_title, task_description, task_type, activity_id, audience_group_id, platform_scope, start_date, due_date, urgency_level, publish_status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.title, data.description, data.type, data.activityId, data.audienceGroupId || null, data.platformScope, data.startDate, data.dueDate, data.urgencyLevel, data.status || 'draft', data.createdBy || 'system']
  );
  return await getTaskById(data.id);
}

async function updateTask(id, data) {
  const keys = Object.keys(data).filter(k => data[k] !== undefined);
  if (!keys.length) return await getTaskById(id);
  const setClause = keys.map(k => k + ' = ?').join(', ');
  const values = keys.map(k => data[k]);
  await run('UPDATE task_publish SET ' + setClause + ' WHERE task_publish_id = ?', values.concat([id]));
  return await getTaskById(id);
}

// ═══════════════════════════════════════════════════════════════════
// audience learner resolution（供 audienceService 调用，仅执行查询）
// ═══════════════════════════════════════════════════════════════════

/**
 * 按动态 WHERE 条件查询匹配的学员（用于圈选 + 覆盖预览）
 * @param {{ whereSql: string, params: Array, needsStoreJoin: boolean }}
 */
async function queryLearnersByAudienceWhere({ whereSql, params, needsStoreJoin }) {
  let query;
  if (needsStoreJoin) {
    query =
      'SELECT la.learner_id, la.email_id, la.store_apple_id ' +
      'FROM learner_account la ' +
      'JOIN reseller_store rs ON la.store_apple_id = rs.store_apple_id ' +
      'WHERE la.user_enabled_indicator = 1 ' + whereSql;
  } else {
    query =
      'SELECT la.learner_id, la.email_id, la.store_apple_id ' +
      'FROM learner_account la ' +
      'WHERE la.user_enabled_indicator = 1 ' + whereSql;
  }
  return await all(query, params);
}

/**
 * 按动态 WHERE 条件统计匹配学员数
 */
async function countLearnersByAudienceWhere({ whereSql, params, needsStoreJoin }) {
  let query;
  if (needsStoreJoin) {
    query =
      'SELECT COUNT(DISTINCT la.learner_id) AS cnt ' +
      'FROM learner_account la ' +
      'JOIN reseller_store rs ON la.store_apple_id = rs.store_apple_id ' +
      'WHERE la.user_enabled_indicator = 1 ' + whereSql;
  } else {
    query =
      'SELECT COUNT(*) AS cnt FROM learner_account la ' +
      'WHERE la.user_enabled_indicator = 1 ' + whereSql;
  }
  const row = await get(query, params);
  return row.cnt;
}

/**
 * 获取 learner_account 表某列的去重值
 */
async function getDistinctLearnerColumn(column) {
  const safeCols = ['rtm_level_3_name', 'reseller_localized_name', 'user_business_role_name'];
  if (!safeCols.includes(column)) return [];
  return await all(
    'SELECT DISTINCT ' + column + ' AS v FROM learner_account WHERE ' + column + ' IS NOT NULL ORDER BY ' + column
  );
}

/**
 * 获取 reseller_store 表某列的去重值
 */
async function getDistinctStoreColumn(column) {
  const safeCols = ['program_name'];
  if (!safeCols.includes(column)) return [];
  return await all(
    'SELECT DISTINCT ' + column + ' AS v FROM reseller_store WHERE ' + column + ' IS NOT NULL ORDER BY ' + column
  );
}

// ═══════════════════════════════════════════════════════════════════
// learner_task_queue
// ═══════════════════════════════════════════════════════════════════

async function getQueueById(id) {
  return await get('SELECT * FROM learner_task_queue WHERE queue_id = ?', [id]);
}

async function getQueueList({ taskPublishId, emailId, limit, offset } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM learner_task_queue ' + where + ' ORDER BY queue_id LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function getQueuePage({ page, pageSize, taskPublishId } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const row = await get('SELECT COUNT(*) AS c FROM learner_task_queue ' + where, p);
  const rows = await all(
    'SELECT * FROM learner_task_queue ' + where + ' ORDER BY queue_id LIMIT ? OFFSET ?',
    p.concat([pageSize, (page - 1) * pageSize])
  );
  return { rows, total: row.c, page, pageSize };
}

async function createQueue(data) {
  await run(
    'INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, priority_level) VALUES (?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.priorityLevel || 'new']
  );
  return await getQueueById(data.id);
}

async function updateQueue(id, data) {
  const keys = Object.keys(data).filter(k => data[k] !== undefined);
  if (!keys.length) return await getQueueById(id);
  const setClause = keys.map(k => k + ' = ?').join(', ');
  const values = keys.map(k => data[k]);
  await run('UPDATE learner_task_queue SET ' + setClause + ' WHERE queue_id = ?', values.concat([id]));
  return await getQueueById(id);
}

async function deleteQueue(id) {
  const r = await run('DELETE FROM learner_task_queue WHERE queue_id = ?', [id]);
  return r.changes > 0;
}

async function batchCreateQueue(entries) {
  if (!entries.length) return 0;
  return withTransaction((conn) => insertQueueRows(conn, entries));
}

async function deleteQueuesByTask(taskPublishId) {
  const r = await run('DELETE FROM learner_task_queue WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════════
// learner_task_reminder
// ═══════════════════════════════════════════════════════════════════

async function getReminderList({ taskPublishId, level, emailId, limit, offset } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('task_publish_id = ?'); p.push(taskPublishId); }
  if (level) { cond.push('reminder_level = ?'); p.push(level); }
  if (emailId) { cond.push('email_id = ?'); p.push(emailId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return await all(
    'SELECT * FROM learner_task_reminder ' + where + ' ORDER BY reminder_id DESC LIMIT ? OFFSET ?',
    p.concat([limit || 50, offset || 0])
  );
}

async function createReminder(data) {
  await run(
    'INSERT INTO learner_task_reminder (reminder_id, task_publish_id, email_id, reminder_level) VALUES (?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.level]
  );
  return data;
}

async function deleteRemindersByTask(taskPublishId) {
  const r = await run('DELETE FROM learner_task_reminder WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════════
// task_reminder_log
// ═══════════════════════════════════════════════════════════════════

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

async function getReminderLogStats({ taskPublishId, groupBy } = {}) {
  const cond = []; const p = [];
  if (taskPublishId) { cond.push('trl.task_publish_id = ?'); p.push(taskPublishId); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const groups = { reminder_level: 'trl.reminder_level', reminder_channel: 'trl.reminder_channel', reminder_result: 'trl.reminder_result' };
  const gc = groups[groupBy] || 'trl.reminder_level';
  return await all(
    'SELECT ' + gc + ' AS group_value, COUNT(*) AS total, ' +
    'SUM(CASE WHEN trl.reminder_result = \'success\' THEN 1 ELSE 0 END) AS success_count ' +
    'FROM task_reminder_log trl ' +
    'JOIN task_publish tp ON tp.task_publish_id = trl.task_publish_id ' +
    where + ' GROUP BY ' + gc + ' ORDER BY total DESC',
    p
  );
}

async function createReminderLog(data) {
  await run(
    'INSERT INTO task_reminder_log (reminder_log_id, task_publish_id, email_id, reminder_level, reminder_channel, reminder_at, reminder_result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.taskPublishId, data.emailId, data.level, data.channel, data.reminderAt, data.result]
  );
  return data;
}

async function deleteReminderLogsByTask(taskPublishId) {
  const r = await run('DELETE FROM task_reminder_log WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════════
// task_audience_group
// ═══════════════════════════════════════════════════════════════════

async function getAudienceGroupById(id) {
  return await get('SELECT * FROM task_audience_group WHERE audience_group_id = ?', [id]);
}

async function createAudienceGroup(data) {
  await run(
    'INSERT INTO task_audience_group (audience_group_id, group_name, group_desc, group_enabled_flag, created_by) VALUES (?, ?, ?, ?, ?)',
    [data.id, data.name, data.desc || null, data.enabledFlag ?? 1, data.createdBy || null]
  );
  return await getAudienceGroupById(data.id);
}

async function updateAudienceGroup(id, data) {
  const keys = Object.keys(data).filter(k => data[k] !== undefined);
  if (!keys.length) return await getAudienceGroupById(id);
  const setClause = keys.map(k => k + ' = ?').join(', ');
  const values = keys.map(k => data[k]);
  await run('UPDATE task_audience_group SET ' + setClause + ' WHERE audience_group_id = ?', values.concat([id]));
  return await getAudienceGroupById(id);
}

// ═══════════════════════════════════════════════════════════════════
// task_audience_condition
// ═══════════════════════════════════════════════════════════════════

async function getAudienceConditions(groupId) {
  return await all(
    'SELECT * FROM task_audience_condition WHERE audience_group_id = ? ORDER BY condition_order',
    [groupId]
  );
}

async function createAudienceCondition(data) {
  await run(
    'INSERT INTO task_audience_condition (audience_condition_id, audience_group_id, dimension_type, operator_type, condition_value_text, condition_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.groupId, data.dimensionType, data.operatorType, data.conditionValueText, data.order ?? 0, data.createdBy || null]
  );
  return data;
}

async function batchCreateAudienceConditions(entries) {
  if (!entries.length) return 0;
  return withTransaction((conn) => insertAudienceConditionRows(conn, entries));
}

async function deleteAudienceConditionsByGroup(groupId) {
  const r = await run('DELETE FROM task_audience_condition WHERE audience_group_id = ?', [groupId]);
  return r.changes;
}

// ═══════════════════════════════════════════════════════════════════
// audience template（复用 task_audience_group，group_desc = 'template'）
// ═══════════════════════════════════════════════════════════════════

async function getAudienceTemplates() {
  return await all(
    "SELECT * FROM task_audience_group WHERE group_desc = 'template' ORDER BY created_at DESC"
  );
}

async function deleteAudienceGroupCascade(groupId) {
  return withTransaction(async (conn) => {
    await conn.query('DELETE FROM task_audience_condition WHERE audience_group_id = ?', [groupId]);
    await conn.query('DELETE FROM task_audience_group WHERE audience_group_id = ?', [groupId]);
  });
}

/**
 * 受众组 + 条件同一事务写入
 * @returns {Promise<string>} audience_group_id
 */
async function createAudienceGroupWithConditions({ group, conditionEntries }) {
  return withTransaction(async (conn) => {
    await conn.query(
      'INSERT INTO task_audience_group (audience_group_id, group_name, group_desc, group_enabled_flag, created_by) VALUES (?, ?, ?, ?, ?)',
      [group.id, group.name, group.desc ?? null, group.enabledFlag ?? 1, group.createdBy || null]
    );
    if (conditionEntries.length) {
      await insertAudienceConditionRows(conn, conditionEntries);
    }
    return group.id;
  });
}

/**
 * 创建任务（可选受众组）同一事务
 * @returns {Promise<string>} task_publish_id
 */
async function createTaskPublishWithAudience({ task, audienceGroup, conditionEntries }) {
  return withTransaction(async (conn) => {
    let audienceGroupId = null;
    if (audienceGroup && conditionEntries && conditionEntries.length) {
      await conn.query(
        'INSERT INTO task_audience_group (audience_group_id, group_name, group_desc, group_enabled_flag, created_by) VALUES (?, ?, ?, ?, ?)',
        [audienceGroup.id, audienceGroup.name, audienceGroup.desc ?? null, audienceGroup.enabledFlag ?? 1, audienceGroup.createdBy || null]
      );
      await insertAudienceConditionRows(conn, conditionEntries);
      audienceGroupId = audienceGroup.id;
    }
    await conn.query(
      'INSERT INTO task_publish (task_publish_id, task_title, task_description, task_type, activity_id, audience_group_id, platform_scope, start_date, due_date, urgency_level, publish_status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        task.id, task.title, task.description, task.type, task.activityId, audienceGroupId,
        task.platformScope, task.startDate, task.dueDate, task.urgencyLevel, task.status || 'draft', task.createdBy || 'system',
      ]
    );
    return task.id;
  });
}

/**
 * 任务下发：学员 / 待办 / 催办 全部写入后再更新为 dispatched（单事务）
 */
async function dispatchTaskAtomic(taskPublishId, { learnerEntries, queueEntries, reminderEntries }) {
  return withTransaction(async (conn) => {
    if (learnerEntries.length) {
      await insertLearnerPublishRows(conn, learnerEntries);
    }
    if (queueEntries.length) {
      await insertQueueRows(conn, queueEntries);
    }
    if (reminderEntries.length) {
      await insertReminderRows(conn, reminderEntries);
    }
    await conn.query(
      'UPDATE task_publish SET publish_status = ? WHERE task_publish_id = ?',
      ['dispatched', taskPublishId]
    );
    return {
      learnerCount: learnerEntries.length,
      queueCount: queueEntries.length,
      reminderCount: reminderEntries.length,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// campaign_activity
// ═══════════════════════════════════════════════════════════════════

async function getCampaignById(id) {
  return await get('SELECT * FROM campaign_activity WHERE activity_id = ?', [id]);
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

// ═══════════════════════════════════════════════════════════════════
// learner_account (read-only)
// ═══════════════════════════════════════════════════════════════════

async function getActiveLearners({ excludeBeforeDate } = {}) {
  let sql = 'SELECT learner_id, email_id, store_apple_id, first_login_date FROM learner_account WHERE user_enabled_indicator = 1';
  const p = [];
  if (excludeBeforeDate) {
    sql += ' AND (first_login_date IS NULL OR first_login_date <= ?)';
    p.push(excludeBeforeDate);
  }
  return await all(sql, p);
}

// ═══════════════════════════════════════════════════════════════════
// task_publish_learner
// ═══════════════════════════════════════════════════════════════════

async function batchCreateLearners(entries) {
  if (!entries.length) return 0;
  return withTransaction((conn) => insertLearnerPublishRows(conn, entries));
}

async function deleteLearnersByTask(taskPublishId) {
  const r = await run('DELETE FROM task_publish_learner WHERE task_publish_id = ?', [taskPublishId]);
  return r.changes;
}

module.exports = {
  getTaskById, getTaskList, getTaskPage, createTask, updateTask,
  // audience group & condition
  getAudienceGroupById, createAudienceGroup, updateAudienceGroup,
  getAudienceConditions, createAudienceCondition, batchCreateAudienceConditions, deleteAudienceConditionsByGroup,
  // audience template
  getAudienceTemplates, deleteAudienceGroupCascade,
  // audience learner resolution
  queryLearnersByAudienceWhere, countLearnersByAudienceWhere,
  getDistinctLearnerColumn, getDistinctStoreColumn,
  // queue
  getQueueById, getQueueList, getQueuePage, createQueue, updateQueue, deleteQueue, batchCreateQueue, deleteQueuesByTask,
  // reminder
  getReminderList, createReminder, deleteRemindersByTask,
  // reminder log
  getReminderLogList, getReminderLogStats, createReminderLog, deleteReminderLogsByTask,
  // campaign
  getCampaignById, getCampaignList,
  // learner
  getActiveLearners,
  // task_publish_learner
  batchCreateLearners, deleteLearnersByTask,
  createAudienceGroupWithConditions, createTaskPublishWithAudience, dispatchTaskAtomic,
};
