'use strict';

/**
 * BAU/NPI 待办与催办级别规则（已确认细节清单）。
 * 供未来「MyPAL 学习进度同步完成 → 定时 UPDATE 库表」使用；
 * open-sync 拉取接口不调用本模块的 derive*，仅使用 sortQueueRecords。
 */

/** 待办列表排序权重（对接方案 §5） */
const PRIORITY_SORT = { new: 0, P0: 1, P1: 2, P2: 3, '': 4, expired: 5, done: 6 };

/** 催办级别严重度（用于多规则命中时取最高级） */
const REMINDER_SEVERITY = { P0: 5, P1: 4, P2: 3, P3: 2, new: 1 };

const SUPPORTED_MODEL_TYPES = ['BAU', 'NPI'];

/** 将 MySQL Date / ISO / YYYY-MM-DD 统一为 YYYY-MM-DD */
function formatDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function getDispatchMs(task) {
  const raw = task.dispatched_at || task.queue_created_at || task.reminder_created_at;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 截止时间窗口：P0/P1/P2 等以「下发时刻 → 截止日期」为轴（非活动 start_date）。
 * new/P3 单独用 getDispatchMs。
 */
function taskDeadlineWindow(task) {
  const dueDay = formatDateOnly(task.due_date);
  if (!dueDay) return null;

  const dispatchMs = getDispatchMs(task);
  const startDay = formatDateOnly(task.start_date);
  const anchorMs = dispatchMs != null
    ? dispatchMs
    : (startDay ? new Date(startDay + 'T00:00:00.000Z').getTime() : null);
  if (anchorMs == null) return null;

  const dueEndMs = new Date(dueDay + 'T23:59:59.000Z').getTime();
  const now = Date.now();
  const totalMs = dueEndMs - anchorMs;

  return {
    now,
    anchorMs,
    dueEndMs,
    hoursSinceDispatch: dispatchMs != null ? (now - dispatchMs) / (1000 * 60 * 60) : null,
    hoursLeft: (dueEndMs - now) / (1000 * 60 * 60),
    daysSinceDispatch: dispatchMs != null ? (now - dispatchMs) / (1000 * 60 * 60 * 24) : null,
    elapsedPct: totalMs > 0 ? ((now - anchorMs) / totalMs) * 100 : 100,
    isExpired: now > dueEndMs,
  };
}

/** BAU 待办 priorityLevel */
function deriveBauPriorityLevel(task, status, hasConfirmation) {
  if (status === 'completed') return 'done';
  const tw = taskDeadlineWindow(task);
  if (!tw) {
    return task.priority_level && task.priority_level !== 'normal'
      ? String(task.priority_level).toUpperCase()
      : '';
  }
  if (tw.isExpired) return 'expired';
  if (tw.hoursSinceDispatch != null && tw.hoursSinceDispatch < 24 && !hasConfirmation) return 'new';
  if (tw.hoursLeft <= 48) return 'P0';
  if (tw.daysSinceDispatch != null && tw.daysSinceDispatch >= 14) return 'P1';
  if (tw.daysSinceDispatch != null && tw.daysSinceDispatch >= 7) return 'P2';
  return '';
}

/** NPI 待办 priorityLevel */
function deriveNpiPriorityLevel(task, status, hasConfirmation) {
  if (status === 'completed') return 'done';
  const tw = taskDeadlineWindow(task);
  if (!tw) {
    return task.priority_level && task.priority_level !== 'normal'
      ? String(task.priority_level).toUpperCase()
      : '';
  }
  if (tw.isExpired) return 'expired';
  if (tw.hoursSinceDispatch != null && tw.hoursSinceDispatch < 24 && !hasConfirmation) return 'new';
  if (tw.hoursLeft <= 24) return 'P0';
  if (tw.hoursLeft <= 48) return 'P1';
  if (tw.elapsedPct >= 50) return 'P2';
  return '';
}

function derivePriorityLevel(modelType, task, status, hasConfirmation) {
  const mt = String(modelType || 'BAU').toUpperCase();
  if (mt === 'NPI') return deriveNpiPriorityLevel(task, status, hasConfirmation);
  return deriveBauPriorityLevel(task, status, hasConfirmation);
}

function pickHighestReminder(levels) {
  if (!levels.length) return null;
  return levels.reduce((best, cur) => {
    if (!best) return cur;
    return (REMINDER_SEVERITY[cur] || 0) > (REMINDER_SEVERITY[best] || 0) ? cur : best;
  }, null);
}

/** BAU 催办 reminderLevel */
function deriveBauReminderLevel(task, status, hasConfirmation) {
  if (status === 'completed') return null;
  const tw = taskDeadlineWindow(task);
  if (!tw) return null;
  const levels = [];
  if (tw.hoursSinceDispatch != null && tw.hoursSinceDispatch < 24) levels.push('new');
  if (!hasConfirmation && tw.hoursSinceDispatch != null && tw.hoursSinceDispatch >= 24) levels.push('P3');
  if (tw.hoursLeft <= 48) levels.push('P0');
  if (tw.daysSinceDispatch != null && tw.daysSinceDispatch >= 14) levels.push('P1');
  if (tw.daysSinceDispatch != null && tw.daysSinceDispatch >= 7) levels.push('P2');
  return pickHighestReminder(levels);
}

/** NPI 催办 reminderLevel */
function deriveNpiReminderLevel(task, status, hasConfirmation) {
  if (status === 'completed') return null;
  const tw = taskDeadlineWindow(task);
  if (!tw) return null;
  const levels = [];
  if (tw.hoursSinceDispatch != null && tw.hoursSinceDispatch < 24) levels.push('new');
  if (!hasConfirmation && tw.hoursSinceDispatch != null && tw.hoursSinceDispatch >= 24) levels.push('P3');
  if (tw.hoursLeft <= 24) levels.push('P0');
  if (tw.hoursLeft <= 48) levels.push('P1');
  if (tw.elapsedPct >= 50) levels.push('P2');
  return pickHighestReminder(levels);
}

function deriveReminderLevel(modelType, task, status, hasConfirmation) {
  const mt = String(modelType || 'BAU').toUpperCase();
  if (mt === 'NPI') return deriveNpiReminderLevel(task, status, hasConfirmation);
  return deriveBauReminderLevel(task, status, hasConfirmation);
}

function sortQueueRecords(records) {
  return records.slice().sort((a, b) => {
    const pa = PRIORITY_SORT[a.priorityLevel] ?? 99;
    const pb = PRIORITY_SORT[b.priorityLevel] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

module.exports = {
  SUPPORTED_MODEL_TYPES,
  PRIORITY_SORT,
  derivePriorityLevel,
  deriveReminderLevel,
  sortQueueRecords,
  deriveBauPriorityLevel,
  deriveNpiPriorityLevel,
  formatDateOnly,
  taskDeadlineWindow,
};
