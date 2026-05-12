'use strict';

/**
 * taskCrud.js — task-publish 模块数据访问层（样板文件）
 *
 * ═══ Crud 编写规范（所有模块照此格式）═══
 * 1. 纯函数，不用 class
 * 2. 动态值使用 ? 占位符，禁止 ${} 拼接 SQL
 * 3. 统一导入 getDb()，不直接 new Database()
 * 4. 查询单个返回 object|null，查询列表返回 []
 * 5. 命名：createX / getXById / getXList / getXPage / updateX / deleteX / countX
 */

const { getDb } = require('../../common/db/connection');

// ─── learner_task_queue ───────────────────────────────────────────

function getQueueById(id) {
  return getDb().prepare('SELECT * FROM learner_task_queue WHERE queue_id = ?').get(id) ?? null;
}

function getQueueList({ taskPublishId, status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (taskPublishId) { conditions.push('task_publish_id = ?'); params.push(taskPublishId); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(
    `SELECT * FROM learner_task_queue ${where} ORDER BY queue_id LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

function getQueuePage({ page, pageSize, taskPublishId, status } = {}) {
  const conditions = [];
  const params = [];
  if (taskPublishId) { conditions.push('task_publish_id = ?'); params.push(taskPublishId); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = getDb().prepare(
    `SELECT COUNT(*) as c FROM learner_task_queue ${where}`
  ).get(...params).c;
  const rows = getDb().prepare(
    `SELECT * FROM learner_task_queue ${where} ORDER BY queue_id LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pageSize };
}

function countQueue({ taskPublishId, status } = {}) {
  const conditions = [];
  const params = [];
  if (taskPublishId) { conditions.push('task_publish_id = ?'); params.push(taskPublishId); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(`SELECT COUNT(*) as c FROM learner_task_queue ${where}`).get(...params).c;
}

function createQueue(data) {
  const stmt = getDb().prepare(`
    INSERT INTO learner_task_queue (queue_id, task_publish_id, email_id, status, created_at)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `);
  stmt.run(data.queueId, data.taskPublishId, data.emailId, data.status || 'pending');
  return getQueueById(data.queueId);
}

function updateQueue(id, data) {
  const keys = Object.keys(data).filter(k => data[k] !== undefined);
  if (!keys.length) return getQueueById(id);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => data[k]);
  getDb().prepare(`UPDATE learner_task_queue SET ${setClause} WHERE queue_id = ?`).run(...values, id);
  return getQueueById(id);
}

function deleteQueue(id) {
  const result = getDb().prepare('DELETE FROM learner_task_queue WHERE queue_id = ?').run(id);
  return result.changes > 0;
}

// ─── task_publish（跨表示例 — 供 A 看板只读调用）─────────────────

function getTaskById(id) {
  return getDb().prepare('SELECT * FROM task_publish WHERE task_publish_id = ?').get(id) ?? null;
}

function getTaskList({ week, statuses, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (week) { conditions.push('task_week = ?'); params.push(week); }
  if (statuses && statuses.length) {
    conditions.push(`publish_status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(
    `SELECT * FROM task_publish ${where} ORDER BY task_publish_id LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

module.exports = {
  getQueueById,
  getQueueList,
  getQueuePage,
  countQueue,
  createQueue,
  updateQueue,
  deleteQueue,
  getTaskById,
  getTaskList,
};
