'use strict';

const { nanoid } = require('nanoid');
const { createError } = require('../../common/middleware/errorHandler');
const { getPlatformDefinition } = require('../../common/utils/platforms');
const taskCrud = require('../crud/taskMysqlCrud');

// ─── 格式化 ───────────────────────────────────────────────────────────

function formatQueue(row) {
  if (!row) return null;
  return {
    id:             row.queue_id,
    taskPublishId:  row.task_publish_id,
    emailId:        row.email_id,
    storeAppleId:   row.store_apple_id ?? null,
    status:         row.status,
    progress:       row.progress,
    priorityLevel:  row.priority_level ?? 'new',
    passedWeek:     row.passed_week ?? null,
    firstUseTime:   row.first_use_time ?? null,
    weekStartTime:  row.week_start_time ?? null,
    completedAt:    row.completed_at ?? null,
    createdAt:      row.created_at,
  };
}

// ─── 队列 CRUD ────────────────────────────────────────────────────────

async function listQueues(query) {
  const { taskPublishId, emailId, pageNum = 1, pageSize = 20 } = query || {};
  const page  = Math.max(1, parseInt(pageNum, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (page - 1) * limit;

  const rows = await taskCrud.getQueueList({ taskPublishId, emailId, limit, offset });
  const total = rows.length < limit ? offset + rows.length : offset + rows.length + 1;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    list: rows.map(formatQueue),
    pagination: { pageNum: page, pageSize: limit, total, totalPages },
  };
}

async function getQueueDetail(id) {
  const row = await taskCrud.getQueueById(id);
  if (!row) throw createError(404, '队列记录不存在', 'TASK_002');
  return formatQueue(row);
}

async function createQueueEntry(body) {
  const { taskPublishId, emailId } = body;
  if (!taskPublishId) throw createError(400, 'taskPublishId 不能为空', 'TASK_005');
  if (!emailId)       throw createError(400, 'emailId 不能为空', 'TASK_005');

  const task = await taskCrud.getTaskById(taskPublishId);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const data = { id: nanoid(), taskPublishId, emailId };
  const row = await taskCrud.createQueue(data);
  return formatQueue(row);
}

async function batchCreateQueues(taskPublishId, entries) {
  if (!taskPublishId) throw createError(400, 'taskPublishId 不能为空', 'TASK_005');
  if (!Array.isArray(entries) || entries.length === 0) {
    throw createError(400, 'entries 非空数组', 'TASK_005');
  }

  const task = await taskCrud.getTaskById(taskPublishId);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const mapped = entries.map(e => ({
    id: nanoid(),
    taskPublishId,
    emailId: e.emailId,
  }));

  const count = await taskCrud.batchCreateQueue(mapped);
  return { created: count, total: entries.length };
}

// ─── 状态机 ────────────────────────────────────────────────────────────

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getConfiguredPlatformColumns(task) {
  const configured = [];
  if (task.has_mypal === 1)          configured.push('mypal_completed');
  if (task.has_smartsell === 1)      configured.push('smartsell_completed');
  if (task.has_ai_demo === 1)        configured.push('ai_demo_completed');
  if (task.has_live_broadcast === 1) configured.push('live_broadcast_completed');
  return configured;
}

function computeProgress(current, configuredColumns) {
  if (!configuredColumns.length) return { progress: 0, nextStatus: current.status, completedAt: null };
  const completedCount = configuredColumns.reduce((acc, col) => acc + (current[col] === 1 ? 1 : 0), 0);
  const progress = Math.round((completedCount / configuredColumns.length) * 100);
  const nextStatus = completedCount === configuredColumns.length ? 'completed'
    : completedCount > 0 ? 'in_progress' : current.status;
  return { progress, nextStatus, completedAt: nextStatus === 'completed' ? timestamp() : null };
}

async function startQueue(queueId) {
  const q = await taskCrud.getQueueById(queueId);
  if (!q) throw createError(404, '队列记录不存在', 'TASK_002');
  if (q.status !== 'pending') throw createError(409, '当前状态不可开始', 'TASK_003');
  await taskCrud.updateQueue(queueId, { status: 'in_progress', first_use_time: timestamp() });
  return formatQueue(await taskCrud.getQueueById(queueId));
}

async function completePlatform(queueId, platform) {
  if (!platform) throw createError(400, 'platform 不能为空', 'TASK_005');
  const platformDef = getPlatformDefinition(platform);
  if (!platformDef) throw createError(400, 'platform 非法', 'TASK_005');

  const q = await taskCrud.getQueueById(queueId);
  if (!q) throw createError(404, '队列记录不存在', 'TASK_002');
  if (q.status === 'pending')   throw createError(409, 'pending 状态不可标记平台完成', 'TASK_003');
  if (q.status === 'completed') throw createError(409, '任务已完成，禁止重复操作', 'TASK_003');

  const task = await taskCrud.getTaskById(q.task_publish_id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const configuredColumns = getConfiguredPlatformColumns(task);
  if (!configuredColumns.includes(platformDef.completedColumn)) {
    throw createError(400, '该任务未配置此平台', 'TASK_005');
  }
  if (q[platformDef.completedColumn] === 1) {
    throw createError(409, '该平台已标记完成', 'TASK_003');
  }

  await taskCrud.updateQueue(queueId, { [platformDef.completedColumn]: 1 });
  const updated = await taskCrud.getQueueById(queueId);
  const { progress, nextStatus, completedAt } = computeProgress(updated, configuredColumns);
  await taskCrud.updateQueue(queueId, { progress, status: nextStatus, completed_at: completedAt });

  return formatQueue(await taskCrud.getQueueById(queueId));
}

async function completeQueue(queueId) {
  const q = await taskCrud.getQueueById(queueId);
  if (!q) throw createError(404, '队列记录不存在', 'TASK_002');
  if (q.status === 'completed') throw createError(409, '任务已完成，禁止重复操作', 'TASK_003');

  const task = await taskCrud.getTaskById(q.task_publish_id);
  const configuredColumns = getConfiguredPlatformColumns(task || {});

  const updates = { status: 'completed', progress: 100, completed_at: timestamp() };
  for (const col of configuredColumns) updates[col] = 1;
  await taskCrud.updateQueue(queueId, updates);

  return formatQueue(await taskCrud.getQueueById(queueId));
}

async function updateQueueStatus(queueId, body) {
  const { operationType, platform } = body || {};
  if (!operationType) throw createError(400, 'operationType 不能为空', 'TASK_005');

  if (operationType === 'start_task')       return startQueue(queueId);
  if (operationType === 'complete_platform') return completePlatform(queueId, platform);
  if (operationType === 'complete_task')     return completeQueue(queueId);
  throw createError(400, 'operationType 非法（start_task/complete_platform/complete_task）', 'TASK_005');
}

module.exports = {
  formatQueue,
  listQueues,
  getQueueDetail,
  createQueueEntry,
  batchCreateQueues,
  updateQueueStatus,
};
