'use strict';

const { db } = require('../db');
const { nanoid } = require('nanoid');
const { broadcastToUsers, broadcastToDashboard } = require('../ws/manager');
const { classifyDeadlineCrisisBand, getDeadlineCrisisHours } = require('./autoNudgeRules');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

const systemUserId = 1; // 系统执行账号（写入 initiator_id）

/** 自动预警固定文案（前缀由任务名称拼接） */
const AUTO_NUDGE_COPY = {
  progressLag:
    '叮~最近辛苦啦！你的培训进度不小心被小伙伴超车咯，抽个空隙冲刺通关，轻松追平不掉队！💪✨',
  startDelay:
    '任务时间悄悄过半啦，你的学习进度条还在沉睡，趁现在抽空唤醒它，轻松起步无压力哦！🌱✨',
  deadlineCrisisP1:
    '距离课程截止不到48小时啦！知道你最近辛苦，快趁休息间隙一鼓作气收个尾，轻松拿下不留遗憾！☕💪',
  deadlineCrisisP0:
    '最后24小时倒计时！任务即将超时，进度条全面告急啦，时间紧迫，请速速上线冲刺收尾！🚨⚡',
};

function formatAutoNudgeContent(taskName, ruleType) {
  const name = (taskName && String(taskName).trim()) || '培训任务';
  const body = AUTO_NUDGE_COPY[ruleType] || '你有未完成的培训任务，请抓紧时间！';
  return `【${name}】${body}`;
}

/**
 * 扫描并排队自动预警：同步阶段只做规则命中与去重，AI 与落库在 setImmediate 异步中执行。
 * @param {string} taskId 任务ID
 * @returns {Promise<Object>}
 */
async function evaluateAndTriggerAutoNudges(taskId) {
  const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task || task.status !== 'dispatched') {
    return { success: false, reason: 'Task not found or not dispatched' };
  }

  let rules = {};
  if (task.auto_nudge_rules) {
    try { rules = JSON.parse(task.auto_nudge_rules); } catch (e) { /* ignore */ }
  }

  const now = Date.now();
  const createdAt = new Date(task.created_at).getTime();
  const ddlAt = new Date(task.ddl_at).getTime();

  const totalDuration = ddlAt - createdAt;
  const passedDuration = now - createdAt;
  const passedPercent = totalDuration > 0 ? (passedDuration / totalDuration) * 100 : 100;
  const hoursLeft = (ddlAt - now) / (1000 * 60 * 60);

  const assignments = db.all(`
    SELECT ta.*, s.rtm, s.format
    FROM task_assignments ta
    JOIN stores s ON ta.store_id = s.id
    WHERE ta.task_id = ? AND ta.status != 'completed'
  `, [taskId]);

  if (assignments.length === 0) {
    return { success: true, nudgedCount: 0, queued: 0, evaluatedRules: Object.keys(rules), reason: 'All completed or no assignments' };
  }

  const triggeredUsers = [];

  if (rules.progressLag) {
    const lifestyleBottomN = rules.progressLag.lifestyle || 3;
    const monoBottomN = rules.progressLag.mono || 1;

    const storeMap = {};
    for (const a of assignments) {
      if (a.rtm && a.rtm.toLowerCase() === 'monobrand') {
        const fmt = (a.format || '').toLowerCase();
        if (fmt === 'lifestyle' || fmt === 'mono') {
          if (!storeMap[a.store_id]) storeMap[a.store_id] = { format: fmt, users: [] };
          storeMap[a.store_id].users.push(a);
        }
      }
    }

    for (const storeId in storeMap) {
      const storeData = storeMap[storeId];
      storeData.users.sort((a, b) => a.progress - b.progress);

      const limit = storeData.format === 'lifestyle' ? lifestyleBottomN : monoBottomN;
      const targetUsers = storeData.users.slice(0, limit);

      for (const u of targetUsers) {
        triggeredUsers.push({ userId: u.user_id, storeId: u.store_id, assignmentId: u.id, severity: 'yellow', ruleType: 'progressLag', threshold: limit });
      }
    }
  }

  if (rules.startDelay && passedPercent >= rules.startDelay) {
    for (const a of assignments) {
      if (a.progress === 0) {
        triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'yellow', ruleType: 'startDelay', threshold: rules.startDelay });
      }
    }
  }

  const crisisBand = classifyDeadlineCrisisBand(rules, hoursLeft);
  if (crisisBand === 'p0') {
    const h = getDeadlineCrisisHours(rules);
    for (const a of assignments) {
      triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'red', ruleType: 'deadlineCrisisP0', threshold: h.p0Hours });
    }
  } else if (crisisBand === 'p1') {
    const h = getDeadlineCrisisHours(rules);
    for (const a of assignments) {
      triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'yellow', ruleType: 'deadlineCrisisP1', threshold: h.p1Hours });
    }
  }

  const uniqueTargets = {};
  for (const t of triggeredUsers) {
    if (!uniqueTargets[t.userId]) {
      uniqueTargets[t.userId] = t;
    } else if (t.severity === 'red') {
      uniqueTargets[t.userId] = t;
    }
  }

  const finalTargets = Object.values(uniqueTargets);
  const toProcess = [];
  for (const target of finalTargets) {
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    const exists = db.get('SELECT id FROM notification_events WHERE dedupe_key = ?', [dedupeKey]);
    if (!exists) toProcess.push(target);
  }

  if (toProcess.length === 0) {
    return {
      success: true,
      nudgedCount: 0,
      queued: 0,
      evaluatedRules: Object.keys(rules),
      reason: 'No targets or all deduped',
    };
  }

  setImmediate(() => {
    processAutoNudgeTargetsAsync(taskId, toProcess).catch((err) => {
      console.error('[auto-nudge async]', taskId, err);
    });
  });

  const n = toProcess.length;
  return {
    success: true,
    /** 与改造前一致：本次将催办的目标人数（异步落库，HTTP 不等待 AI） */
    nudgedCount: n,
    queued: n,
    evaluatedRules: Object.keys(rules),
    async: true,
  };
}

/**
 * 异步：逐人产生预警消息，写入 notification_events.content 并广播。
 * 文案为规则对应的固定话术，前缀拼接任务名称。
 */
async function processAutoNudgeTargetsAsync(taskId, targets) {
  const taskRow = db.get('SELECT title FROM tasks WHERE id = ?', [taskId]);
  const taskName = taskRow && taskRow.title;

  for (const target of targets) {
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    const exists = db.get('SELECT id FROM notification_events WHERE dedupe_key = ?', [dedupeKey]);
    if (exists) continue;

    const content = formatAutoNudgeContent(taskName, target.ruleType);

    const eventId = nanoid();
    const eventType = target.severity === 'red' ? 'nudge_red' : 'nudge_yellow';
    const now = formatNowSqliteLocal();
    let nudgeRecordId;

    db.transaction(() => {
      nudgeRecordId = nanoid();
      db.run(
        `INSERT INTO nudge_records (id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at)
         VALUES (?, ?, 'employee', ?, ?, ?, ?, ?)`,
        [nudgeRecordId, taskId, target.userId, systemUserId, target.severity, JSON.stringify([eventId]), now]
      );

      db.run(
        `INSERT INTO notification_events (id, task_id, assignment_id, target_user_id, store_id, event_type, severity, initiator_id, dedupe_key, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, taskId, target.assignmentId, target.userId, target.storeId, eventType, target.severity, systemUserId, dedupeKey, content, now]
      );

      db.run('UPDATE task_assignments SET nudge_count = nudge_count + 1, updated_at = ? WHERE id = ?', [now, target.assignmentId]);
    });

    broadcastToUsers([target.userId], {
      event: 'nudge_sent',
      data: {
        nudgeRecordId,
        taskId,
        severity: target.severity,
        eventType,
        content,
        ruleType: target.ruleType,
        eventId,
      },
    });

    broadcastToDashboard({
      event: 'dashboard_updated',
      data: {
        taskId,
        assignmentId: target.assignmentId,
        operationType: 'auto_nudge_sent'
      }
    });
  }
}

module.exports = {
  evaluateAndTriggerAutoNudges,
  processAutoNudgeTargetsAsync,
};
