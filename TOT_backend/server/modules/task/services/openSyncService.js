'use strict';

/**
 * MyPAL open-sync 拉取：只读 MySQL 已落库字段，不在此做 BAU/NPI 级别推算。
 *
 * priorityLevel / reminderLevel 由下发或「MyPAL 学习进度同步后的定时任务」写入库表；
 * 规则实现预留于 ../utils/openSyncRules.js（待 mypal 接口 + 定时任务接入）。
 */

const openSyncCrud = require('../crud/openSyncCrud');
const { sortQueueRecords } = require('../utils/openSyncRules');

function normalizeEmail(email) {
  if (email == null || typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  return t.length ? t : null;
}

function formatIsoUtc(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatLocalDateTime(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 库 priority_level → 对接文档 priorityLevel（normal 表示进行中，对外映射为空串） */
function mapPriorityLevelFromDb(level) {
  if (level == null || level === '') return '';
  const s = String(level).trim();
  if (!s || s === 'normal') return '';
  if (s === 'newP0') return 'P0';
  return s;
}

/** 库 reminder_level → 对接文档 reminderLevel */
function mapReminderLevelFromDb(level) {
  if (level == null || level === '') return '';
  const s = String(level).trim();
  if (s === 'newP0') return 'P0';
  return s;
}

function resolveModelType(row) {
  const mt = row.model_type ? String(row.model_type).toUpperCase() : '';
  if (mt === 'NPI') return 'NPI';
  return 'BAU';
}

async function pullLearnerTaskQueue(email) {
  const norm = normalizeEmail(email);
  if (!norm) {
    const err = new Error('请求参数错误');
    err.openSyncCode = '40004';
    err.status = 400;
    throw err;
  }

  const rows = await openSyncCrud.pullQueueRowsByEmail(norm);

  const records = rows.map(row => ({
    emailId: row.email_id,
    taskTitle: row.task_title,
    taskDescription: row.task_description ?? '',
    priorityLevel: mapPriorityLevelFromDb(row.priority_level),
    taskWeek: row.task_week ?? '',
    topicName: row.topic_name ?? '',
    model_type: resolveModelType(row),
    createdAt: formatIsoUtc(row.queue_created_at || row.task_created_at),
    _queueId: row.queue_id,
  }));

  const sorted = sortQueueRecords(records);
  const payload = sorted.map(({ _queueId, ...rest }) => rest);

  return { records: payload, _auditRows: sorted };
}

async function pullLearnerTaskReminder(createdDate) {
  if (!createdDate || !/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) {
    const err = new Error('请求参数错误');
    err.openSyncCode = '40004';
    err.status = 400;
    throw err;
  }

  const rows = await openSyncCrud.pullReminderRowsByCreatedDate(createdDate);

  const records = rows.map(row => ({
    emailId: row.email_id,
    taskTitle: row.task_title,
    taskDescription: row.task_description ?? '',
    reminderLevel: mapReminderLevelFromDb(row.reminder_level) || 'new',
    taskWeek: row.task_week ?? '',
    topicName: row.topic_name ?? '',
    model_type: resolveModelType(row),
    createdAt: formatLocalDateTime(row.created_at),
    _reminderId: row.reminder_id,
  }));

  const payload = records.map(({ _reminderId, ...rest }) => rest);
  return { records: payload, _auditRows: records };
}

async function writeQueuePullAudits(requestId, email, auditRows, syncResult) {
  const reqText = JSON.stringify({ email });
  const resText = JSON.stringify({
    records: auditRows.map(({ _queueId, ...rest }) => rest),
  });
  for (const row of auditRows) {
    if (!row._queueId) continue;
    await openSyncCrud.insertQueueSyncAudit({
      queueId: row._queueId,
      requestId,
      syncResult,
      requestPayload: reqText,
      responsePayload: resText,
    });
  }
}

async function writeReminderPullAudits(requestId, createdDate, records, syncResult) {
  const reqText = JSON.stringify({ createdDate });
  const resText = JSON.stringify({
    records: records.map(r => {
      const { _reminderId, ...rest } = r;
      return rest;
    }),
  });
  for (const row of records) {
    if (!row._reminderId) continue;
    await openSyncCrud.insertReminderSyncAudit({
      reminderId: row._reminderId,
      requestId,
      syncResult,
      requestPayload: reqText,
      responsePayload: resText,
    });
  }
}

module.exports = {
  pullLearnerTaskQueue,
  pullLearnerTaskReminder,
  writeQueuePullAudits,
  writeReminderPullAudits,
  normalizeEmail,
};
