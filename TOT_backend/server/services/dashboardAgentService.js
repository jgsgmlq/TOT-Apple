'use strict';

const { db } = require('../db/index');
const mainAgent = require('../agent/index');
const { nanoid } = require('nanoid');
const { formatNowSqliteLocal } = require('../utils/ddlAt');

async function generateDashboardAgentInsight(userId) {
  const tasks = db.all(`
    SELECT 
      t.id, t.title, t.ddl_at,
      COUNT(ta.id) as total_count,
      SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      ROUND(SUM(ta.progress) * 1.0 / MAX(COUNT(ta.id), 1), 1) as avg_progress,
      SUM(CASE WHEN t.ddl_at < datetime('now', 'localtime') AND ta.status != 'completed' THEN 1 ELSE 0 END) as overdue_count,
      SUM(ta.nudge_count) as total_nudges
    FROM tasks t
    LEFT JOIN task_assignments ta ON t.id = ta.task_id
    WHERE t.status = 'dispatched'
    GROUP BY t.id
  `);

  if (!tasks || tasks.length === 0) {
    return {
      redCount: 0,
      orangeCount: 0,
      greenCount: 0,
      topTasks: [],
      overallSummary: "当前没有下发的活跃任务，大家都在休息中。",
      allTasks: []
    };
  }

  // 调用 Agent 框架执行诊断 Skill
  const parsed = await mainAgent.execute('dashboard_diagnose', { tasks });

  // 校验并补充基础信息
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  let redCount = 0, orangeCount = 0, greenCount = 0;
  
  const allTasks = (parsed.topTasks || []).map(t => {
    if (t.severity === 'red') redCount++;
    else if (t.severity === 'orange') orangeCount++;
    else greenCount++;

    const dbTask = taskMap.get(t.taskId);
    return {
      taskId: t.taskId,
      title: dbTask ? dbTask.title : '未知任务',
      severity: t.severity || 'green',
      insight: t.insight || '',
      focusModule: t.focusModule || 'north_star',
      progress: dbTask ? (dbTask.avg_progress || 0) : 0
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
  getDashboardAgentInsight
};
