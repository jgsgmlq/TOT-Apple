'use strict';

const { db } = require('../db');
const { nanoid } = require('nanoid');
const mainAgent = require('../agent');
const { broadcastToUsers, broadcastToDashboard } = require('../ws/manager');

const systemUserId = 1; // 系统执行账号（写入 initiator_id）

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

  if (rules.deadlineCrisis && hoursLeft > 0) {
    const p0Hours = rules.deadlineCrisis.p0 || 24;
    const p1Hours = rules.deadlineCrisis.p1 || 48;

    if (hoursLeft <= p0Hours) {
      for (const a of assignments) {
        triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'red', ruleType: 'deadlineCrisisP0', threshold: p0Hours });
      }
    } else if (hoursLeft <= p1Hours) {
      for (const a of assignments) {
        triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'red', ruleType: 'deadlineCrisisP1', threshold: p1Hours });
      }
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
 * （已移除 AI 生成逻辑，固化为展示触发的规则原文）
 */
async function processAutoNudgeTargetsAsync(taskId, targets) {
  for (const target of targets) {
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    const exists = db.get('SELECT id FROM notification_events WHERE dedupe_key = ?', [dedupeKey]);
    if (exists) continue;

    let content = '你有未完成的培训任务，请抓紧时间！';
    
    // 固化业务规则，预警文案直接展示触发的规则原文
    if (target.ruleType === 'progressLag') {
      content = `个人任务完成率处于门店最后${target.threshold}位`;
    } else if (target.ruleType === 'startDelay') {
      content = `期限达到${target.threshold}%但进度为0`;
    } else if (target.ruleType === 'deadlineCrisisP0') {
      content = `距离deadline<${target.threshold}h但未完成课程(p0)`;
    } else if (target.ruleType === 'deadlineCrisisP1') {
      content = `距离deadline<${target.threshold}h但未完成课程(p1)`;
    }

    const eventId = nanoid();
    const eventType = target.severity === 'red' ? 'nudge_red' : 'nudge_yellow';
    const now = new Date().toISOString();
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
