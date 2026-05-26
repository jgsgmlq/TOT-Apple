'use strict';

/**
 * reminderService.js — 催办规则计算 + 自动预警调度
 *
 * 供 A(看板) 和本模块共用。数据访问全部通过 taskCrud，零 SQL。
 */

const { nanoid } = require('nanoid');
const taskCrud = require('../crud/taskCrud');
const { broadcastToUsers, broadcastToDashboard } = require('../../common/ws/manager');
const {
  getDeadlineCrisisHours,
  classifyDeadlineCrisisBand,
} = require('../../common/utils/autoNudgeRules');
const { parseAutoNudgeRules } = require('../../common/utils/autoNudgeRules');
const { formatNowSqliteLocal } = require('../../common/utils/ddlAt');

const SYSTEM_USER_ID = 1;

const AUTO_NUDGE_COPY = {
  progressLag:
    '叮~最近辛苦啦！你的培训进度不小心被小伙伴超车咯，抽个空隙冲刺通关，轻松追平不掉队！💪✨',
  deadlineCrisisP2:
    '任务时间悄悄过半啦，你还没有完成哦，趁现在抽空唤醒它，轻松搞定无压力哦！🌱✨',
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

// ─── 自动预警主入口 ───────────────────────────────────────────────────

async function evaluateAndTriggerAutoNudges(taskId) {
  const task = await taskCrud.getOldTaskForNudge(taskId);
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

  const assignments = await taskCrud.getUncompletedAssignmentsForNudge(taskId);
  if (!assignments.length) {
    return {
      success: true, nudgedCount: 0, queued: 0,
      evaluatedRules: Object.keys(rules),
      reason: 'All completed or no assignments',
    };
  }

  const triggeredUsers = [];

  // progressLag 规则
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
        triggeredUsers.push({
          userId: u.user_id, storeId: u.store_id, assignmentId: u.id,
          severity: 'yellow', ruleType: 'progressLag', threshold: limit,
        });
      }
    }
  }

  // deadlineCrisis 规则
  const crisisBand = classifyDeadlineCrisisBand(rules, hoursLeft, passedPercent);
  if (crisisBand === 'p0') {
    const h = getDeadlineCrisisHours(rules);
    for (const a of assignments) {
      triggeredUsers.push({
        userId: a.user_id, storeId: a.store_id, assignmentId: a.id,
        severity: 'red', ruleType: 'deadlineCrisisP0', threshold: h.p0Hours,
      });
    }
  } else if (crisisBand === 'p1') {
    const h = getDeadlineCrisisHours(rules);
    for (const a of assignments) {
      triggeredUsers.push({
        userId: a.user_id, storeId: a.store_id, assignmentId: a.id,
        severity: 'orange', ruleType: 'deadlineCrisisP1', threshold: h.p1Hours,
      });
    }
  } else if (crisisBand === 'p2') {
    const h = getDeadlineCrisisHours(rules);
    for (const a of assignments) {
      triggeredUsers.push({
        userId: a.user_id, storeId: a.store_id, assignmentId: a.id,
        severity: 'yellow', ruleType: 'deadlineCrisisP2', threshold: h.p2Percent,
      });
    }
  }

  // 去重：一人一次最多一条预警。优先级 red > orange > yellow
  const severityWeight = { red: 3, orange: 2, yellow: 1 };
  const uniqueTargets = {};
  for (const t of triggeredUsers) {
    if (!uniqueTargets[t.userId]) {
      uniqueTargets[t.userId] = t;
    } else {
      const existingWeight = severityWeight[uniqueTargets[t.userId].severity] || 0;
      const newWeight = severityWeight[t.severity] || 0;
      if (newWeight > existingWeight) uniqueTargets[t.userId] = t;
    }
  }

  const finalTargets = Object.values(uniqueTargets);
  const toProcess = [];
  for (const target of finalTargets) {
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    if (!await taskCrud.checkNudgeDedupeKey(dedupeKey)) toProcess.push(target);
  }

  if (!toProcess.length) {
    return {
      success: true, nudgedCount: 0, queued: 0,
      evaluatedRules: Object.keys(rules),
      reason: 'No targets or all deduped',
    };
  }

  setImmediate(() => {
    processAutoNudgeTargetsAsync(taskId, toProcess).catch(err =>
      console.error('[auto-nudge async]', taskId, err));
  });

  return {
    success: true,
    nudgedCount: toProcess.length,
    queued: toProcess.length,
    evaluatedRules: Object.keys(rules),
    async: true,
  };
}

// ─── 异步执行催办落库 + 广播 ──────────────────────────────────────────

async function processAutoNudgeTargetsAsync(taskId, targets) {
  const task = await taskCrud.getOldTaskForNudge(taskId);
  const taskName = task && task.title;

  for (const target of targets) {
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    if (await taskCrud.checkNudgeDedupeKey(dedupeKey)) continue;

    const content = formatAutoNudgeContent(taskName, target.ruleType);

    const eventId = nanoid();
    let eventType = 'nudge_yellow';
    if (target.severity === 'red') eventType = 'nudge_red';
    if (target.severity === 'orange') eventType = 'nudge_orange';
    const now = formatNowSqliteLocal();

    const nudgeRecordId = nanoid();
    await taskCrud.createAutoNudgeTransaction({
      record: {
        id: nudgeRecordId, taskId, targetType: 'employee', targetId: target.userId,
        initiatorId: SYSTEM_USER_ID, severity: target.severity,
        eventIdsJson: JSON.stringify([eventId]), createdAt: now,
      },
      event: {
        id: eventId, taskId, assignmentId: target.assignmentId, userId: target.userId,
        storeId: target.storeId, eventType, severity: target.severity,
        initiatorId: SYSTEM_USER_ID, dedupeKey, content, createdAt: now,
      },
      assignmentId: target.assignmentId,
      now,
    });

    broadcastToUsers([target.userId], {
      event: 'nudge_sent',
      data: {
        nudgeRecordId, taskId, severity: target.severity,
        eventType, content, ruleType: target.ruleType, eventId,
      },
    });

    broadcastToDashboard({
      event: 'dashboard_updated',
      data: { taskId, assignmentId: target.assignmentId, operationType: 'auto_nudge_sent' },
    });
  }
}

module.exports = {
  parseAutoNudgeRules,
  getDeadlineCrisisHours,
  classifyDeadlineCrisisBand,
  evaluateAndTriggerAutoNudges,
  processAutoNudgeTargetsAsync,
};
