'use strict';

const { db } = require('../db');
const { nanoid } = require('nanoid');
const mainAgent = require('../agent');
const { broadcastToUsers } = require('../ws/manager');

/**
 * 扫描并执行任务的自动预警与催办规则
 * @param {string} taskId 任务ID
 * @returns {Promise<Object>} 统计结果
 */
async function evaluateAndTriggerAutoNudges(taskId) {
  // 1. 拿任务和规则
  const task = db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task || task.status !== 'dispatched') {
    return { success: false, reason: 'Task not found or not dispatched' };
  }

  let rules = {};
  if (task.auto_nudge_rules) {
    try { rules = JSON.parse(task.auto_nudge_rules); } catch (e) { /* ignore */ }
  }

  // 2. 时间计算
  const now = Date.now();
  const createdAt = new Date(task.created_at).getTime();
  const ddlAt = new Date(task.ddl_at).getTime();
  
  const totalDuration = ddlAt - createdAt;
  const passedDuration = now - createdAt;
  const passedPercent = totalDuration > 0 ? (passedDuration / totalDuration) * 100 : 100;
  const hoursLeft = (ddlAt - now) / (1000 * 60 * 60);

  // 3. 取出所有 Assignment 及其对应 Store 的信息
  const assignments = db.all(`
    SELECT ta.*, s.rtm, s.format
    FROM task_assignments ta
    JOIN stores s ON ta.store_id = s.id
    WHERE ta.task_id = ? AND ta.status != 'completed'
  `, [taskId]);

  if (assignments.length === 0) {
    return { success: true, nudgedUsers: 0, reason: 'All completed or no assignments' };
  }

  const triggeredUsers = []; // { userId, severity, ruleType }
  const systemUserId = 1; // 假设 1 为系统执行账号(如需写入 record)

  // 4. 判定掉队规则 (Progress Lag) - Monobrand Lifestyle/Mono
  if (rules.progressLag) {
    const lifestyleBottomN = rules.progressLag.lifestyle || 3;
    const monoBottomN = rules.progressLag.mono || 1;

    // 按店分组
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
      // 升序排列，排前面的是倒数
      storeData.users.sort((a, b) => a.progress - b.progress);
      
      const limit = storeData.format === 'lifestyle' ? lifestyleBottomN : monoBottomN;
      const targetUsers = storeData.users.slice(0, limit);

      for (const u of targetUsers) {
        triggeredUsers.push({ userId: u.user_id, storeId: u.store_id, assignmentId: u.id, severity: 'yellow', ruleType: 'progressLag' });
      }
    }
  }

  // 5. 判定起步异常预警 (Start Delay)
  if (rules.startDelay && passedPercent >= rules.startDelay) {
    for (const a of assignments) {
      if (a.progress === 0) {
        triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'yellow', ruleType: 'startDelay' });
      }
    }
  }

  // 6. 判定临期危机预警 (Deadline Crisis)
  if (rules.deadlineCrisis && hoursLeft > 0 && hoursLeft <= rules.deadlineCrisis) {
    for (const a of assignments) {
      triggeredUsers.push({ userId: a.user_id, storeId: a.store_id, assignmentId: a.id, severity: 'red', ruleType: 'deadlineCrisis' });
    }
  }

  // 7. 去重过滤 (同一个用户这次扫描只发一种最高优先级的)
  const uniqueTargets = {};
  for (const t of triggeredUsers) {
    if (!uniqueTargets[t.userId]) {
      uniqueTargets[t.userId] = t;
    } else {
      // red 优先
      if (t.severity === 'red') uniqueTargets[t.userId] = t;
    }
  }

  const finalTargets = Object.values(uniqueTargets);
  let nudgedCount = 0;

  // 8. 调用 AI Skill 生成话术并派发
  const nowStr = new Date().toISOString();
  for (const target of finalTargets) {
    // Check Dedupe to prevent spamming the exact same rule to the same user
    const dedupeKey = `autonudge:${target.ruleType}:${target.assignmentId}`;
    const exists = db.get('SELECT id FROM notification_events WHERE dedupe_key = ?', [dedupeKey]);
    
    if (exists) continue; // 已经发过了

    // 调用 Skill
    let content = '你有未完成的培训任务，请抓紧时间！'; // Fallback
    try {
      const aiResult = await mainAgent.execute('generate_nudge_message', {
        taskId: taskId,
        userId: target.userId,
        severity: target.severity
      });
      if (aiResult && aiResult.content) {
        content = aiResult.content;
      }
    } catch (err) {
      console.error(`Auto-nudge AI generation failed for user ${target.userId}:`, err.message);
    }

    // 记录发送
    const eventId = nanoid();
    const eventType = target.severity === 'red' ? 'nudge_red' : 'nudge_yellow';

    db.transaction(() => {
      // 这里不写 nudge_records 或者单独写一条系统级 record
      // 为了与现有的兼容，写一条单人的 nudge_records
      const nudgeRecordId = nanoid();
      db.run(
        `INSERT INTO nudge_records (id, task_id, target_type, target_id, initiator_id, severity, notification_event_ids, created_at)
         VALUES (?, ?, 'employee', ?, ?, ?, ?, ?)`,
        [nudgeRecordId, taskId, target.userId, systemUserId, target.severity, JSON.stringify([eventId]), nowStr]
      );

      db.run(
        `INSERT INTO notification_events (id, task_id, assignment_id, target_user_id, store_id, event_type, severity, initiator_id, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, taskId, target.assignmentId, target.userId, target.storeId, eventType, target.severity, systemUserId, dedupeKey, nowStr]
      );

      db.run('UPDATE task_assignments SET nudge_count = nudge_count + 1, updated_at = ? WHERE id = ?', [nowStr, target.assignmentId]);
    });

    // 广播 WS
    broadcastToUsers([target.userId], {
      event: 'nudge_sent',
      data: {
        taskId,
        severity: target.severity,
        eventType,
        content: content, // 把生成的文案发下去
        ruleType: target.ruleType
      }
    });

    nudgedCount++;
  }

  return { success: true, nudgedCount, evaluatedRules: Object.keys(rules) };
}

module.exports = {
  evaluateAndTriggerAutoNudges
};