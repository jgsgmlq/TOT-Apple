'use strict';

const { nanoid } = require('nanoid');
const { createError } = require('../../common/middleware/errorHandler');
const { broadcastToDashboard } = require('../../common/ws/manager');
const { parseDateToSqliteLocal } = require('../../common/utils/ddlAt');
const taskCrud = require('../crud/taskMysqlCrud');
const audienceService = require('./audienceService');

// 旧前端解析 ddlAt 时用 `new Date(s.replace(/-/g, '/'))`，只接受
// `YYYY-MM-DD HH:MM:SS` 本地墙钟字符串；mysql2 把 DATETIME/DATE 反序列化为
// Date 对象后 JSON 化会变成 ISO `…T…Z`，旧 FE 会解析为 Invalid Date 把整条
// 任务过滤掉。这里把要给 legacy 别名用的时间统一转为 SQLite 本地墙钟字符串。
function toLegacyTimeString(value) {
  if (value === null || value === undefined || value === '') return null;
  try { return parseDateToSqliteLocal(value); } catch (_) { return null; }
}

function formatTask(row) {
  if (!row) return null;
  const platformScope = safeParseJson(row.platform_scope) ?? null;
  const scopeArr = Array.isArray(platformScope) ? platformScope : [];
  const hasPlatform = (k) => scopeArr.some((s) => String(s).toLowerCase() === String(k).toLowerCase());

  const legacyDueAt   = toLegacyTimeString(row.due_date);
  const legacyStartAt = toLegacyTimeString(row.start_date);
  const legacyCreated = toLegacyTimeString(row.created_at);

  return {
    // ─── 新契约（dev / modules/task）─────────────────────────────
    task_publish_id: row.task_publish_id,
    task_title:      row.task_title,
    task_description: row.task_description ?? null,
    task_type:       row.task_type ?? null,
    publish_status:  row.publish_status,
    activity_id:     row.activity_id ?? null,
    audience_group_id: row.audience_group_id ?? null,
    platform_scope:  platformScope,
    start_date:      row.start_date,
    due_date:        row.due_date,
    urgency_level:   row.urgency_level ?? null,
    created_by:      row.created_by ?? null,
    created_at:      row.created_at,

    // ─── Legacy aliases（dashboard 分支旧契约，兼容老前端）─────
    // 详见 docs/plans/2026-05-18-dashboard-agent-mysql-migration.md
    id:               row.task_publish_id,
    title:            row.task_title,
    description:      row.task_description ?? null,
    status:           row.publish_status,
    ddl_at:           legacyDueAt,
    ddlAt:            legacyDueAt,
    start_at:         legacyStartAt,
    startAt:          legacyStartAt,
    urgencyLevel:    row.urgency_level ?? null,
    audienceGroupId: row.audience_group_id ?? null,
    activityId:      row.activity_id ?? null,
    createdBy:       row.created_by ?? null,
    createdAt:       legacyCreated,
    hasMypal:         hasPlatform('MyPal'),
    hasSmartSell:     hasPlatform('SmartSales') || hasPlatform('SmartSell'),
    hasAiDemo:        hasPlatform('AiDemo'),
    hasLiveBroadcast: hasPlatform('LiveBroadcast'),
    // 旧 FE 直接读这些字段，给安全默认值避免渲染期 undefined
    mypalTaskWeek:    null,
    mypalProductName: null,
    subTasksConfig:   null,
    autoNudgeRules:   null,
    rtmFilter:        null,
    storeScope:       'all',
    passScore:        null,
  };
}

async function formatTaskWithAudience(row) {
  const task = formatTask(row);
  if (!task || !task.audience_group_id) return task;
  const group = await taskCrud.getAudienceGroupById(task.audience_group_id);
  const conditions = await taskCrud.getAudienceConditions(task.audience_group_id);
  task.audience_group = {
    group_name: group ? group.group_name : '',
    conditions: conditions.map(c => ({
      dimension_type: c.dimension_type,
      operator_type: c.operator_type,
      condition_value_text: safeParseConditionValue(c.condition_value_text),
      condition_order: c.condition_order,
    })),
  };
  return task;
}

function safeParseConditionValue(v) {
  if (!v) return v;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch (_) { /* fall through */ }
  }
  return v;
}

function safeParseJson(v) {
  if (!v) return v;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
}

function toDateOnly(iso) {
  if (!iso) return iso;
  return iso.slice(0, 10);
}

function toPlatformScope(v) {
  if (!v) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

// ─── 校验 ───────────────────────────────────────────────────────────

function validateTaskInput(body) {
  if (!body.task_title) throw createError(400, 'task_title 不能为空', 'TASK_005');
  if (!body.start_date) throw createError(400, 'start_date 不能为空', 'TASK_005');
  if (!body.due_date)   throw createError(400, 'due_date 不能为空', 'TASK_005');
}

// ─── 受众组持久化 ────────────────────────────────────────────────────

function buildAudienceConditionEntries(groupId, audienceGroup, username) {
  return audienceGroup.conditions.map((c, i) => ({
    id: nanoid(),
    groupId,
    dimensionType: c.dimension_type,
    operatorType: c.operator_type || 'in',
    conditionValueText: Array.isArray(c.condition_value_text)
      ? JSON.stringify(c.condition_value_text)
      : String(c.condition_value_text ?? ''),
    order: c.condition_order ?? i + 1,
    createdBy: username,
  }));
}

/**
 * 将前端 audience_group 写入 task_audience_group + task_audience_condition（单事务）
 * 返回 audience_group_id，如果 conditions 为空则返回 null
 */
async function saveAudienceGroup(audienceGroup, username) {
  if (!audienceGroup || !audienceGroup.conditions || !audienceGroup.conditions.length) {
    return null;
  }

  const groupId = nanoid();
  const conditionEntries = buildAudienceConditionEntries(groupId, audienceGroup, username);

  await taskCrud.createAudienceGroupWithConditions({
    group: {
      id: groupId,
      name: audienceGroup.group_name || null,
      desc: null,
      enabledFlag: 1,
      createdBy: username,
    },
    conditionEntries,
  });

  return groupId;
}

/**
 * 更新受众组：删旧条件 → 删旧组 → 建新组+条件
 */
async function replaceAudienceGroup(oldGroupId, audienceGroup, username) {
  if (oldGroupId) {
    await taskCrud.deleteAudienceConditionsByGroup(oldGroupId);
    // 组记录保留由 saveAudienceGroup 新建，旧组在条件清空后可保留或清理
    // 这里简单处理：不删组记录本身，只覆盖 audience_group_id 指向新组
  }
  return await saveAudienceGroup(audienceGroup, username);
}

// ─── CRUD ───────────────────────────────────────────────────────────

async function listTasks(_user) {
  const { rows } = await taskCrud.getTaskPage({ page: 1, pageSize: 200 });
  return Promise.all(rows.map(formatTaskWithAudience));
}

async function getTaskDetail(id) {
  const task = await taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  return await formatTaskWithAudience(task);
}

async function createTask(body, username) {
  validateTaskInput(body);

  const id = nanoid();
  const hasAudience = body.audience_group?.conditions?.length;
  let audienceGroup = null;
  let conditionEntries = [];

  if (hasAudience) {
    const groupId = nanoid();
    audienceGroup = {
      id: groupId,
      name: body.audience_group.group_name || null,
      desc: null,
      enabledFlag: 1,
      createdBy: username,
    };
    conditionEntries = buildAudienceConditionEntries(groupId, body.audience_group, username);
  }

  await taskCrud.createTaskPublishWithAudience({
    task: {
      id,
      title: body.task_title,
      description: body.task_description ?? null,
      type: body.task_type ?? 'single_task',
      activityId: body.activity_id ?? null,
      platformScope: toPlatformScope(body.platform_scope),
      startDate: toDateOnly(body.start_date),
      dueDate: toDateOnly(body.due_date),
      urgencyLevel: body.urgency_level ?? 'normal',
      status: 'draft',
      createdBy: username,
    },
    audienceGroup,
    conditionEntries,
  });

  const row = await taskCrud.getTaskById(id);
  return await formatTaskWithAudience(row);
}

async function updateTask(id, body, username) {
  const task = await taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');

  if (task.publish_status === 'dispatched') {
    throw createError(400, '已下发任务不支持任何修改与撤回。', 'TASK_003');
  }

  // 处理受众组更新
  if (body.audience_group !== undefined) {
    const newGroupId = await replaceAudienceGroup(
      task.audience_group_id, body.audience_group, username
    );
    body.audience_group_id = newGroupId;
  }

  const data = {};
  if (body.task_title !== undefined)       data.task_title = body.task_title;
  if (body.task_description !== undefined) data.task_description = body.task_description;
  if (body.platform_scope !== undefined)   data.platform_scope = toPlatformScope(body.platform_scope);
  if (body.start_date !== undefined)       data.start_date = toDateOnly(body.start_date);
  if (body.due_date !== undefined)         data.due_date = toDateOnly(body.due_date);
  if (body.urgency_level !== undefined)    data.urgency_level = body.urgency_level;
  if (body.activity_id !== undefined)      data.activity_id = body.activity_id;
  if (body.audience_group_id !== undefined) data.audience_group_id = body.audience_group_id;

  if (Object.keys(data).length) {
    data.updated_by = username;
    await taskCrud.updateTask(id, data);
  }
  const updated = await taskCrud.getTaskById(id);
  broadcastToDashboard({ event: 'dashboard_updated', data: { taskId: id, operationType: 'task_edited' } });
  return await formatTaskWithAudience(updated);
}

// ─── 下发 ───────────────────────────────────────────────────────────

async function dispatchTask(id, username) {
  const task = await taskCrud.getTaskById(id);
  if (!task) throw createError(404, '任务不存在', 'TASK_002');
  if (task.publish_status === 'dispatched') {
    throw createError(409, '任务已下发，禁止重复下发', 'TASK_003');
  }

  // ── 根据受众条件圈选学员 ──
  let learners;
  if (task.audience_group_id) {
    const conditions = await taskCrud.getAudienceConditions(task.audience_group_id);
    if (conditions.length) {
      const parsed = conditions.map(c => ({
        dimension_type: c.dimension_type,
        operator_type: c.operator_type,
        condition_value_text: safeParseConditionValue(c.condition_value_text),
      }));
      const result = await audienceService.resolveAudience(parsed);
      learners = result.learners;
    } else {
      learners = await taskCrud.getActiveLearners({});
    }
  } else {
    // 无受众组 → 全量下发（排除入职 ≤7 天的新人）
    const newHireCutoff = task.start_date
      ? toDateOnly(new Date(new Date(task.start_date).getTime() - 7 * 86400000).toISOString())
      : null;
    learners = await taskCrud.getActiveLearners({ excludeBeforeDate: newHireCutoff });
  }

  if (!learners.length) {
    throw createError(400, '没有可下发的学员', 'TASK_006');
  }

  // 写 task_publish_learner + learner_task_queue + 催办
  const learnerEntries = [];
  const queueEntries = [];
  const reminderEntries = [];

  for (const l of learners) {
    learnerEntries.push({
      id: nanoid(), taskPublishId: id, learnerId: l.learner_id,
      audienceGroupId: task.audience_group_id || null, createdBy: username,
    });

    queueEntries.push({
      id: nanoid(), taskPublishId: id, emailId: l.email_id, priorityLevel: 'new',
    });

    reminderEntries.push({
      id: nanoid(), taskPublishId: id, emailId: l.email_id, level: 'new',
    });
  }

  const { learnerCount, queueCount, reminderCount } = await taskCrud.dispatchTaskAtomic(id, {
    learnerEntries,
    queueEntries,
    reminderEntries,
  });

  const updated = await taskCrud.getTaskById(id);
  broadcastToDashboard({ event: 'dashboard_updated', data: { taskId: id, operationType: 'task_dispatched' } });

  return {
    task: await formatTaskWithAudience(updated),
    frozen_count: learnerCount,
    queue_created: queueCount,
    reminder_created: reminderCount,
  };
}

module.exports = {
  formatTask, validateTaskInput,
  listTasks, getTaskDetail, createTask, updateTask,
  dispatchTask,
};
