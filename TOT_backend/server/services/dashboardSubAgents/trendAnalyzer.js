'use strict';

const { simpleChat } = require('../../utils/ai');
const { getTrendBoardData, getOverviewBoardData } = require('../dashboardQueryCore');
const { TREND_SYSTEM_PROMPT } = require('./promptTemplates');
const { extractJsonSafely, mergeRegionResult } = require('./shared');

/**
 * 完成趋势子 Agent：按日新增完成 + 累计完成。
 * @param {{ taskId: string, title: string, ddl_at: string }} task
 * @returns {Promise<import('./shared').RegionResult>}
 */
async function runTrendAnalyzer(task) {
  const overview = getOverviewBoardData({ taskId: task.taskId });
  const trend = getTrendBoardData({ taskId: task.taskId, type: 'daily' });
  const trendData = (trend.trendData || []).slice(-30);

  const ddlMs = new Date(task.ddl_at).getTime();
  const nowMs = Date.now();
  const hoursLeft = (ddlMs - nowMs) / (1000 * 60 * 60);

  const slice = {
    taskId: task.taskId,
    title: task.title,
    ddl_at: task.ddl_at,
    hoursLeft: Number(hoursLeft.toFixed(1)),
    totalAssignments: overview.totalAssignments,
    completionRate: overview.completionRate,
    pendingCount: overview.pendingCount,
    overdueCount: overview.overdueCount,
    trend_daily_last30: trendData,
  };

  const userMsg = `请分析下列任务的完成趋势（来自 GET /dashboard/trend?type=daily 同源；最多最近 30 个日历日）：
${JSON.stringify(slice, null, 2)}`;

  let raw = '';
  try {
    raw = await simpleChat(
      [
        { role: 'system', content: TREND_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { model: 'deepseek-v4-flash', maxTokens: 400, temperature: 0.2, disableThinking: true }
    );
  } catch (err) {
    console.error('[SubAgent trend] LLM error', task.taskId, err.message);
    return fallbackTrend(slice, err.message);
  }

  const parsed = extractJsonSafely(raw);
  if (!parsed) {
    console.error('[SubAgent trend] JSON parse failed', task.taskId, raw.slice(0, 200));
    return fallbackTrend(slice, 'JSON 解析失败');
  }
  return mergeRegionResult(parsed, {
    region: 'trend',
    taskId: task.taskId,
    fallbackKeyFindings: {
      剩余小时数: slice.hoursLeft,
      完成率: slice.completionRate,
      未开始人数: slice.pendingCount,
      逾期人数: slice.overdueCount,
    },
  });
}

function fallbackTrend(slice, reason) {
  let severity = 'green';
  if (slice.hoursLeft <= 48 && slice.completionRate < 70) severity = 'red';
  else if (slice.completionRate < 50) severity = 'orange';
  const focusHint =
    slice.overdueCount > 0 ? 'overdue_count' : slice.completionRate < 50 ? 'deadline_risk' : 'trend_daily_drop';
  return {
    region: 'trend',
    taskId: slice.taskId,
    severity,
    summary: `距 ddl 还有 ${slice.hoursLeft} 小时，完成率 ${slice.completionRate}%，待开始 ${slice.pendingCount} 人。`,
    keyFindings: {
      剩余小时数: slice.hoursLeft,
      完成率: slice.completionRate,
      未开始人数: slice.pendingCount,
      逾期人数: slice.overdueCount,
    },
    focusHint,
    degraded: true,
    degradedReason: reason,
  };
}

module.exports = { runTrendAnalyzer };
