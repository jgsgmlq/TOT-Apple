'use strict';

const { db } = require('../db/index');
const mainAgent = require('../agent/index');
const { nanoid } = require('nanoid');
const { formatNowSqliteLocal } = require('../utils/ddlAt');
const { runRegionAnalyzers } = require('./dashboardSubAgents/runRegionAnalyzers');

const COARSE_FOCUS_KEYS = new Set([
  'north_star',
  'warning_details',
  'rtm_timezone',
  'crisis_p0',
  'funnel_read_rate',
  'nudge_conversion',
  'metrics_overdue',
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
  // 规则：主 Agent 给了粗粒度时，优先回填为同任务最严重区域的细粒度 focusHint。
  const fine = pickFineGrainedFocusFromInsights(taskData);
  return fine || focusModule;
}

/**
 * 完整生成一次看板诊断：
 *  1. 列出所有 dispatched 的活跃任务。
 *  2. 并行（全局并发上限 6）跑 4 个区域子 Agent 拿到 regionInsights。
 *  3. 把瘦身后的 tasks（仅 taskId/title/ddl_at + regionInsights）喂给主 Agent，
 *     由主 Agent 输出最终 topTasks / focusModule / overallSummary。
 *  4. 写入 dashboard_insights(global_agent) 作为主 Agent 自身的缓存。
 */
async function generateDashboardAgentInsight(userId) {
  // 跳过已过期任务（ddl_at < 当前本地时间）：避免对收尾或终结的任务再做 LLM 诊断，
  // 也省掉 4 个区域子 Agent 的 LLM 调用成本。时区口径与 dashboardQueryCore 中的
  // `datetime('now', 'localtime') > t.ddl_at` 严格一致。保留 ddl_at IS NULL 的任务
  // （视为不可判定过期，仍参与诊断）。
  const activeTasks = db.all(
    `SELECT * FROM tasks
       WHERE status = 'dispatched'
         AND (ddl_at IS NULL OR ddl_at >= datetime('now', 'localtime'))
       ORDER BY ddl_at ASC`
  );
  const skippedRow = db.get(
    `SELECT COUNT(*) AS cnt FROM tasks
       WHERE status = 'dispatched'
         AND ddl_at IS NOT NULL
         AND ddl_at < datetime('now', 'localtime')`
  );
  const skippedExpiredCount = (skippedRow && skippedRow.cnt) || 0;
  console.log(
    `[Dashboard Agent] activeTasks=${(activeTasks || []).length} skippedExpired=${skippedExpiredCount}`
  );

  if (!activeTasks || activeTasks.length === 0) {
    const overallSummary =
      skippedExpiredCount > 0
        ? `已自动跳过 ${skippedExpiredCount} 个过期任务，当前没有进行中的活跃任务。`
        : '当前没有下发的活跃任务，大家都在休息中。';
    return {
      redCount: 0,
      orangeCount: 0,
      greenCount: 0,
      topTasks: [],
      overallSummary,
      allTasks: [],
      skippedExpiredCount,
    };
  }

  const taskMeta = activeTasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    ddl_at: t.ddl_at,
    raw: t,
  }));

  // 1) 并行跑子 Agent
  const regionInsightsByTask = await runRegionAnalyzers(
    taskMeta.map(({ taskId, title, ddl_at }) => ({ taskId, title, ddl_at })),
    { concurrency: 6 }
  );

  // 2) 主 Agent 输入：4 段子 Agent 文案 + 关键 KPI（不含原始 boardView）
  const tasksDataForAi = taskMeta.map((m) => {
    const r = regionInsightsByTask[m.taskId] || {};
    const avgProgRow = db.get(
      `SELECT ROUND(AVG(ta.progress), 1) AS avg_progress FROM task_assignments ta WHERE ta.task_id = ?`,
      [m.taskId]
    );
    const avgProgress =
      avgProgRow && avgProgRow.avg_progress != null ? Number(avgProgRow.avg_progress) : 0;
    return {
      taskId: m.taskId,
      title: m.title,
      ddl_at: m.ddl_at,
      avgProgressPercent: avgProgress,
      regionInsights: {
        funnel: r.funnel || null,
        warning: r.warning || null,
        trend: r.trend || null,
        rtm: r.rtm || null,
      },
    };
  });

  // 3) 主 Agent
  const parsed = await mainAgent.execute('dashboard_diagnose', { tasks: tasksDataForAi });

  // 4) 整形 + 落库
  const taskMap = new Map(tasksDataForAi.map((t) => [t.taskId, t]));
  let redCount = 0;
  let orangeCount = 0;
  let greenCount = 0;

  const allTasks = (parsed.topTasks || []).map((t) => {
    if (t.severity === 'red') redCount++;
    else if (t.severity === 'orange') orangeCount++;
    else greenCount++;

    const aiTaskData = taskMap.get(t.taskId);
    const focusModule = normalizeFocusModule(t.focusModule, aiTaskData);
    return {
      taskId: t.taskId,
      title: aiTaskData ? aiTaskData.title : '未知任务',
      severity: t.severity || 'green',
      insight: t.insight || '',
      focusModule,
      focusReason: t.focusReason || '',
      progress: aiTaskData ? aiTaskData.avgProgressPercent || 0 : 0,
    };
  });

  const resultData = {
    redCount,
    orangeCount,
    greenCount,
    topTasks: allTasks.slice(0, 3),
    overallSummary: parsed.overallSummary || '所有任务都在稳步推进中。',
    allTasks,
    skippedExpiredCount,
  };

  const id = nanoid();
  const now = formatNowSqliteLocal();
  db.run(
    `
    INSERT INTO dashboard_insights 
      (id, module_type, content, context_json, created_by, created_at)
    VALUES (?, 'global_agent', ?, ?, ?, ?)
  `,
    [id, 'agent response', JSON.stringify(resultData), userId || 1, now]
  );

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
  generateDashboardAgentInsight,
};
