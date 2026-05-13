'use strict';

/**
 * taskService.js — 任务发布核心业务逻辑
 *
 * 职责：校验、编排、转换，调 taskCrud 完成数据访问。零 SQL。
 */

const { nanoid } = require('nanoid');
const { createError } = require('../../common/middleware/errorHandler');
const { parseDdlAtToSqliteUtc } = require('../../common/utils/ddlAt');
const { broadcastToUsers, broadcastToDashboard } = require('../../common/ws/manager');
const taskCrud = require('../crud/taskCrud');

// ─── 格式化：DB 行 → API 对象（snake_case → camelCase）────────────

function formatTask(row) {
  if (!row) return null;
  return {
    id:               row.task_publish_id,
    title:            row.task_title,
    description:      row.task_description ?? null,
    type:             row.task_type ?? null,
    week:             row.task_week ?? null,
    productName:      row.product_name ?? null,
    status:           row.publish_status,
    modelType:        row.model_type ?? null,
    requiredFlag:     row.required_flag === 1,
    dynamicEvalFlag:  row.dynamic_eval_flag === 1,
    enabledFlag:      row.enabled_flag === 1,
    sortOrder:        row.sort_order ?? 0,
    startDate:        row.start_date,
    dueDate:          row.due_date,
    fiscalYear:       row.fiscal_year ?? null,
    quarterNo:        row.quarter_no ?? null,
    createdAt:        row.created_at,
  };
}

// ─── 校验 ─────────────────────────────────────────────────────────

function validateTaskInput(body) {
  const { title, startDate, dueDate, requiredFlag } = body;
  if (!title)       throw createError(400, 'title 不能为空', 'TASK_005');
  if (!startDate)   throw createError(400, 'startDate 不能为空', 'TASK_005');
  if (!dueDate)     throw createError(400, 'dueDate 不能为空', 'TASK_005');
  if (requiredFlag === undefined) throw createError(400, 'requiredFlag 不能为空', 'TASK_005');
}

// ─── 任务 CRUD ─────────────────────────────────────────────────────

function listTasks(user) {
  const { role } = user;
  if (role === 'central' || role === 'admin') {
    const result = taskCrud.getTaskList({});
    return result.map(formatTask);
  }
  // 学员视角由 queueService 负责拼接
  return [];
}

function getTaskDetail(id, user) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  // 学员视角由 queueService 负责拼接 assignment
  return formatTask(task);
}

function createTask(body, username) {
  validateTaskInput(body);

  const id = nanoid();
  const data = {
    id,
    title:        body.title,
    description:  body.description ?? null,
    type:         body.type ?? null,
    week:         body.week ?? null,
    productName:  body.productName ?? null,
    status:       'draft',
    modelType:    body.modelType ?? null,
    requiredFlag: body.requiredFlag ? 1 : 0,
    dynamicEvalFlag: body.dynamicEvalFlag ? 1 : 0,
    enabledFlag:  body.enabledFlag !== undefined ? (body.enabledFlag ? 1 : 0) : 1,
    sortOrder:    body.sortOrder ?? 0,
    startDate:    parseDdlAtToSqliteUtc(body.startDate),
    dueDate:      parseDdlAtToSqliteUtc(body.dueDate),
    fiscalYear:   body.fiscalYear ?? null,
    quarterNo:    body.quarterNo ?? null,
    createdBy:    username,
  };

  const row = taskCrud.createTask(data);
  return formatTask(row);
}

// ─── 更新（draft 全改 / dispatched 仅限 dueDate）───────────────────

function updateTask(id, body) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  if (task.publish_status === 'dispatched') {
    return _updateDispatchedTask(task, body);
  }
  return _updateDraftTask(task, body);
}

function _updateDispatchedTask(rawTask, body) {
  const task = formatTask(rawTask);

  const immutable = ['title', 'description', 'type', 'week', 'productName',
    'modelType', 'requiredFlag', 'dynamicEvalFlag', 'sortOrder',
    'startDate', 'fiscalYear', 'quarterNo'];

  for (const f of immutable) {
    const newVal = body[f];
    if (newVal !== undefined && String(newVal) !== String(task[f])) {
      throw createError(400, '已下发任务只允许修改截止时间和启用状态', 'TASK_004');
    }
  }

  const data = {};
  if (body.dueDate !== undefined) data.due_date = parseDdlAtToSqliteUtc(body.dueDate);
  if (body.enabledFlag !== undefined) data.enabled_flag = body.enabledFlag ? 1 : 0;

  if (Object.keys(data).length) {
    taskCrud.updateTask(task.id, data);
  }

  const updated = taskCrud.getTaskById(task.id);

  // TODO: broadcastToUsers 当前用 email_id 做标识，WS manager 需支持 email 索引
  const queues = taskCrud.getQueueList({ taskPublishId: task.id, limit: 1000 });
  if (queues.length) {
    broadcastToUsers(queues.map(q => q.email_id), {
      event: 'task_updated',
      data: { taskId: task.id, dueDate: updated.due_date },
    });
  }
  broadcastToDashboard({ event: 'dashboard_updated', data: { taskId: task.id, operationType: 'task_edited' } });
  return formatTask(updated);
}

function _updateDraftTask(task, body) {
  const data = {};
  const map = {
    title: 'task_title', description: 'task_description', type: 'task_type',
    week: 'task_week', productName: 'product_name', modelType: 'model_type',
  };
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined) data[col] = body[k];
  }
  if (body.requiredFlag !== undefined)    data.required_flag = body.requiredFlag ? 1 : 0;
  if (body.dynamicEvalFlag !== undefined) data.dynamic_eval_flag = body.dynamicEvalFlag ? 1 : 0;
  if (body.enabledFlag !== undefined)     data.enabled_flag = body.enabledFlag ? 1 : 0;
  if (body.sortOrder !== undefined)       data.sort_order = body.sortOrder;
  if (body.fiscalYear !== undefined)      data.fiscal_year = body.fiscalYear;
  if (body.quarterNo !== undefined)       data.quarter_no = body.quarterNo;
  if (body.startDate !== undefined)       data.start_date = parseDdlAtToSqliteUtc(body.startDate);
  if (body.dueDate !== undefined)         data.due_date = parseDdlAtToSqliteUtc(body.dueDate);

  if (Object.keys(data).length) {
    taskCrud.updateTask(id, data);
  }
  const updated = taskCrud.getTaskById(id);
  broadcastToDashboard({ event: 'dashboard_updated', data: { taskId: id, operationType: 'task_edited' } });
  return formatTask(updated);
}

// ─── 发布 / 撤销 / 删除 ────────────────────────────────────────────

function dispatchTask(id) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  if (task.publish_status === 'dispatched') {
    throw createError(409, '任务已下发，禁止重复下发', 'TASK_003');
  }

  const rules = taskCrud.getAudienceRules(id);
  if (!rules || rules.length === 0) {
    throw createError(400, '请先配置受众圈选规则', 'TASK_006');
  }

  taskCrud.updateTask(id, { publish_status: 'dispatched' });
  const updated = taskCrud.getTaskById(id);

  // TODO(Phase 2): audienceService 解析规则 → C 的 learnerCrud 获取学员列表 → batchCreateQueue
  broadcastToDashboard({
    event: 'dashboard_updated',
    data: { taskId: id, operationType: 'task_dispatched' },
  });

  return {
    task: formatTask(updated),
    audienceRuleCount: rules.length,
    matchedStoreCount: 0,
    targetUserCount: 0,
    assignmentCreated: 0,
    notificationCreated: 0,
  };
}

function revokeTask(id) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  if (task.publish_status !== 'dispatched') {
    throw createError(400, '任务未下发，无需撤销', 'TASK_008');
  }

  const queues = taskCrud.getQueueList({ taskPublishId: id, limit: 100000 });
  const userIds = [...new Set(queues.map(q => q.email_id))];

  taskCrud.deleteTaskCascade(id);

  broadcastToDashboard({
    event: 'dashboard_updated',
    data: { taskId: id, operationType: 'task_deleted' },
  });
  if (userIds.length) {
    broadcastToUsers(userIds, { event: 'task_deleted', data: { taskId: id } });
  }
  return { id, deleted: true };
}

function deleteTask(id) {
  const task = taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  const queues = taskCrud.getQueueList({ taskPublishId: id, limit: 100000 });
  const userIds = [...new Set(queues.map(q => q.email_id))];

  taskCrud.deleteTaskCascade(id);

  broadcastToDashboard({
    event: 'dashboard_updated',
    data: { taskId: id, operationType: 'task_deleted' },
  });
  if (userIds.length) {
    broadcastToUsers(userIds, { event: 'task_deleted', data: { taskId: id } });
  }
  return { id, deleted: true };
}

module.exports = {
  formatTask,
  validateTaskInput,
  listTasks,
  getTaskDetail,
  createTask,
  updateTask,
  dispatchTask,
  revokeTask,
  deleteTask,
};
