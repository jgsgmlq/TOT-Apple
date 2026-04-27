'use strict';

const { db } = require('../db/index');
const mainAgent = require('../agent/index');
const { nanoid } = require('nanoid');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const { parseAutoNudgeRules, classifyDeadlineCrisisBand } = require('../services/autoNudgeRules');

async function generateDashboardAgentInsight(userId) {
  const nowMs = Date.now();
  const nowIso = formatNowSqliteLocal();

  // 获取所有 dispatched 的任务
  const activeTasks = db.all("SELECT * FROM tasks WHERE status = 'dispatched'");

  if (!activeTasks || activeTasks.length === 0) {
    return {
      redCount: 0,
      orangeCount: 0,
      greenCount: 0,
      topTasks: [],
      overallSummary: "当前没有下发的活跃任务，大家都在休息中。",
      allTasks: []
    };
  }

  const tasksDataForAi = [];

  for (const t of activeTasks) {
    const taskId = t.id;
    
    // 聚合基础指标
    const base = db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ta.status = 'completed'  THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
         SUM(CASE WHEN ta.status = 'pending'     THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at <= ? THEN 1 ELSE 0 END) AS completed_on_time_count,
         SUM(CASE WHEN ta.status != 'completed' AND datetime('now', 'localtime') > ? THEN 1 ELSE 0 END) AS overdue_count,
         AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND ? IS NOT NULL THEN (julianday(ta.completed_at) - julianday(?)) * 24 END) AS avg_completion_time_hours,
         ROUND(SUM(ta.progress) * 1.0 / MAX(COUNT(ta.id), 1), 1) AS avg_progress
       FROM task_assignments ta
       WHERE ta.task_id = ?`,
      [t.ddl_at, t.ddl_at, t.created_at, t.created_at, taskId]
    );

    const total = base.total || 0;
    const completedCnt = base.completed_count || 0;
    const inProgCnt = base.in_progress_count || 0;
    const pendingCnt = base.pending_count || 0;
    const overdueCnt = base.overdue_count || 0;
    const completionRate = total > 0 ? parseFloat(((100 * completedCnt) / total).toFixed(2)) : 0;
    const onTimeCompletionRate = total > 0 ? parseFloat(((100 * (base.completed_on_time_count || 0)) / total).toFixed(2)) : 0;
    const avgProgress = base.avg_progress || 0;

    // 预警分布统计
    let p0 = 0, p1 = 0, p2 = 0;
    const rules = parseAutoNudgeRules(t.auto_nudge_rules);
    const ddlAtMs = new Date(t.ddl_at).getTime();
    const createdAtMs = new Date(t.created_at).getTime();
    const hoursLeft = (ddlAtMs - nowMs) / (1000 * 60 * 60);
    const passedPct = ddlAtMs - createdAtMs > 0 ? ((nowMs - createdAtMs) / (ddlAtMs - createdAtMs)) * 100 : 100;

    const assignRows = db.all("SELECT * FROM task_assignments WHERE task_id = ?", [taskId]);
    for (const row of assignRows) {
      if (row.status === 'completed') continue;
      const band = classifyDeadlineCrisisBand(rules, hoursLeft, passedPct);
      if (band === 'p0') p0++;
      else if (band === 'p1') p1++;
      else if (band === 'p2') p2++;
    }

    const warningRates = {
      crisisP0Rate: total > 0 ? parseFloat(((100 * p0) / total).toFixed(2)) : 0,
      crisisP1Rate: total > 0 ? parseFloat(((100 * p1) / total).toFixed(2)) : 0,
      crisisP2Rate: total > 0 ? parseFloat(((100 * p2) / total).toFixed(2)) : 0,
    };

    // 漏斗相关：触达人数(pushUserCount) 与 阅读人数(totalReadCount)
    const pushRow = db.get("SELECT COUNT(DISTINCT target_user_id) AS cnt FROM notification_events WHERE task_id = ? AND event_type = 'task_assigned'", [taskId]);
    const pushUserCount = pushRow ? pushRow.cnt : 0;

    const readRow = db.get("SELECT COUNT(DISTINCT rr.user_id) AS cnt FROM read_receipts rr JOIN notification_events ne ON ne.id = rr.event_id WHERE ne.task_id = ? AND rr.source = 'task_detail_open'", [taskId]);
    const totalReadCount = readRow ? readRow.cnt : 0;

    // 催办转化率
    const nudgeRow = db.get(`
      SELECT
        COUNT(DISTINCT ne.target_user_id) AS total_nudged,
        COUNT(DISTINCT CASE 
          WHEN ta.status = 'completed' AND ta.completed_at > ne.created_at THEN ne.target_user_id 
          ELSE NULL 
        END) AS converted_nudged
      FROM notification_events ne
      LEFT JOIN task_assignments ta ON ta.id = ne.assignment_id
      WHERE ne.event_type IN ('nudge_red', 'nudge_orange', 'nudge_yellow') AND ne.task_id = ?
    `, [taskId]);
    const totalNudged = nudgeRow ? nudgeRow.total_nudged : 0;
    const convertedNudged = nudgeRow ? nudgeRow.converted_nudged : 0;
    const nudgeConversionRate = totalNudged > 0 ? parseFloat(((100 * convertedNudged) / totalNudged).toFixed(2)) : 0;

    tasksDataForAi.push({
      taskId,
      title: t.title,
      ddl_at: t.ddl_at,
      metrics: {
        total_assignments: total,
        completed: completedCnt,
        in_progress: inProgCnt,
        pending: pendingCnt,
        overdue: overdueCnt,
        completion_rate: completionRate,
        on_time_completion_rate: onTimeCompletionRate,
        avg_progress: avgProgress,
      },
      warningRates,
      funnel: {
        push_users: pushUserCount,
        read_users: totalReadCount,
        read_rate: pushUserCount > 0 ? parseFloat(((100 * totalReadCount) / pushUserCount).toFixed(2)) : 0
      },
      nudgeConversion: {
        total_nudged: totalNudged,
        converted: convertedNudged,
        rate: nudgeConversionRate
      }
    });
  }

  // 调用 Agent 框架执行诊断 Skill
  const parsed = await mainAgent.execute('dashboard_diagnose', { tasks: tasksDataForAi });

  // 校验并补充基础信息
  const taskMap = new Map(tasksDataForAi.map(t => [t.taskId, t]));
  let redCount = 0, orangeCount = 0, greenCount = 0;
  
  const allTasks = (parsed.topTasks || []).map(t => {
    if (t.severity === 'red') redCount++;
    else if (t.severity === 'orange') orangeCount++;
    else greenCount++;

    const aiTaskData = taskMap.get(t.taskId);
    return {
      taskId: t.taskId,
      title: aiTaskData ? aiTaskData.title : '未知任务',
      severity: t.severity || 'green',
      insight: t.insight || '',
      focusModule: t.focusModule || 'north_star',
      progress: aiTaskData ? aiTaskData.metrics.avg_progress : 0
    };
  });

  const resultData = {
    redCount,
    orangeCount,
    greenCount,
    topTasks: allTasks.slice(0, 3),
    overallSummary: parsed.overallSummary || '所有任务都在稳步推进中。',
    allTasks: allTasks
  };

  const id = nanoid();
  const now = formatNowSqliteLocal();
  db.run(`
    INSERT INTO dashboard_insights 
      (id, module_type, content, context_json, created_by, created_at)
    VALUES (?, 'global_agent', ?, ?, ?, ?)
  `, [
    id,
    'agent response',
    JSON.stringify(resultData),
    userId || 1, // 如果为定时的 null，写一个默认的 system ID
    now
  ]);

  return { ...resultData, generatedAt: now };
}

async function getDashboardAgentInsight(userId, refresh = false) {
  if (!refresh) {
    const latest = db.get(`
      SELECT context_json, created_at 
      FROM dashboard_insights 
      WHERE module_type = 'global_agent'
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    if (latest) {
      const data = JSON.parse(latest.context_json);
      data.generatedAt = latest.created_at;
      return data;
    }
  }

  return await generateDashboardAgentInsight(userId);
}

module.exports = {
  getDashboardAgentInsight,
  generateDashboardAgentInsight
};
