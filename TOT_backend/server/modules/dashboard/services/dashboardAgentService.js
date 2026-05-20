'use strict';

const { nanoid } = require('nanoid');
const mainAgent = require('../../../agent/index');
const { formatNowSqliteLocal } = require('../../../utils/ddlAt');
const { runRegionAnalyzers } = require('./analyzers/runRegionAnalyzers');
const mysqlCrud = require('../crud/dashboardMysqlCrud');
const { fetchTaskContext, classifyStatus } = require('./queryEngine');

const COARSE_FOCUS_KEYS = new Set([
  'north_star', 'warning_details', 'rtm_timezone',
  'crisis_p0', 'funnel_read_rate', 'nudge_conversion', 'metrics_overdue',
]);

const SEVERITY_RANK = { red: 3, orange: 2, green: 1 };

function pickFineGrainedFocusFromInsights(taskData) {
  if (!taskData || !taskData.regionInsights) return null;
  const items = Object.values(taskData.regionInsights).filter(Boolean);
  if (!items.length) return null;
  const maxRank = Math.max(...items.map((r) => SEVERITY_RANK[r.severity] || 0));
  const sameWorst = items.filter((r) => (SEVERITY_RANK[r.severity] || 0) === maxRank);
  for (const r of sameWorst) {
    const hint = r.focusHint;
    if (hint && hint !== 'none' && !COARSE_FOCUS_KEYS.has(hint)) return hint;
  }
  return null;
}

function normalizeFocusModule(focusModule, taskData) {
  if (!focusModule) return 'none';
  if (focusModule === 'none') return 'none';
  if (!COARSE_FOCUS_KEYS.has(focusModule)) return focusModule;
  const fine = pickFineGrainedFocusFromInsights(taskData);
  return fine || focusModule;
}

async function generateDashboardAgentInsight(userId) {
  const [activeTasks, skippedExpiredCount] = await Promise.all([
    mysqlCrud.getActiveDispatchedTasks(),
    mysqlCrud.getExpiredDispatchedTasksCount(),
  ]);

  if (activeTasks.length === 0) {
    const overallSummary = skippedExpiredCount > 0
      ? `已自动跳过 ${skippedExpiredCount} 个过期任务，当前没有进行中的活跃任务。`
      : '当前没有下发的活跃任务，大家都在休息中。';
    return {
      redCount: 0, orangeCount: 0, greenCount: 0,
      topTasks: [], overallSummary, allTasks: [], skippedExpiredCount,
    };
  }

  const taskMeta = activeTasks.map((t) => ({
    taskId: t.task_publish_id,
    title: t.task_title,
    ddl_at: t.due_date,
  }));

  const [regionInsightsByTask, contexts] = await Promise.all([
    runRegionAnalyzers(
      taskMeta.map(({ taskId, title, ddl_at }) => ({ taskId, title, ddl_at })),
      { concurrency: 6 }
    ),
    Promise.all(
      activeTasks.map((t) => fetchTaskContext(t.task_publish_id, {}))
    ),
  ]);

  const tasksDataForAi = activeTasks.map((t, i) => {
    const taskId = t.task_publish_id;
    const { queues, mpsRows } = contexts[i];

    let completedCount = 0;
    const total = queues.length || 1;
    for (const q of queues) {
      if (classifyStatus(q.email_id, mpsRows) === 'completed') completedCount++;
    }
    const avgProgressPercent = parseFloat(((completedCount / total) * 100).toFixed(1));

    const r = regionInsightsByTask[taskId] || {};
    return {
      taskId,
      title: t.task_title,
      ddl_at: t.due_date,
      avgProgressPercent,
      regionInsights: {
        funnel: r.funnel || null,
        warning: r.warning || null,
        trend: r.trend || null,
        rtm: r.rtm || null,
      },
    };
  });

  const parsed = await mainAgent.execute('dashboard_diagnose', { tasks: tasksDataForAi });

  const taskMap = new Map(tasksDataForAi.map((t) => [t.taskId, t]));
  let redCount = 0, orangeCount = 0, greenCount = 0;

  const parsedTasks = (parsed.topTasks || []).map((t) => {
    if (t.severity === 'red') redCount++;
    else if (t.severity === 'orange') orangeCount++;
    else greenCount++;
    const aiTaskData = taskMap.get(t.taskId);
    return {
      taskId: t.taskId,
      title: aiTaskData ? aiTaskData.title : '未知任务',
      severity: t.severity || 'green',
      insight: t.insight || '',
      focusModule: normalizeFocusModule(t.focusModule, aiTaskData),
      focusReason: t.focusReason || '',
      progress: aiTaskData ? aiTaskData.avgProgressPercent || 0 : 0,
    };
  });

  const resultData = {
    redCount, orangeCount, greenCount,
    topTasks: parsedTasks.slice(0, 3),
    overallSummary: parsed.overallSummary || '所有任务都在稳步推进中。',
    allTasks: parsedTasks, skippedExpiredCount,
  };

  const id = nanoid();
  const nowStr = formatNowSqliteLocal();
  await mysqlCrud.insertAgentInsight(id, 'global_agent', 'agent response', JSON.stringify(resultData), userId || 1);

  return { ...resultData, generatedAt: nowStr };
}

async function getDashboardAgentInsight(userId, refresh = false) {
  if (!refresh) {
    const latest = await mysqlCrud.getLatestAgentInsight();
    if (latest) {
      const data = JSON.parse(latest.context_json);
      data.generatedAt = latest.created_at;
      return data;
    }
  }
  return await generateDashboardAgentInsight(userId);
}

module.exports = { getDashboardAgentInsight, generateDashboardAgentInsight };
