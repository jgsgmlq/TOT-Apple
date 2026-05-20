'use strict';

const { simpleChat } = require('../../../common/utils/ai');
const { getOverviewBoardData } = require('../queryEngine');
const { FUNNEL_SYSTEM_PROMPT } = require('./promptTemplates');
const { extractJsonSafely, mergeRegionResult } = require('./shared');
const logger = require('../../../common/utils/logger');

/**
 * 转化漏斗子 Agent：聚焦 reach -> read -> completion -> nudge 链路。
 * @param {{ taskId: string, title: string, ddl_at: string }} task
 * @returns {Promise<import('./shared').RegionResult>}
 */
async function runFunnelAnalyzer(task) {
  const overview = await getOverviewBoardData({ taskId: task.taskId });
  const slice = {
    taskId: task.taskId,
    title: task.title,
    ddl_at: task.ddl_at,
    pushUserCount: overview.pushUserCount,
    employeeReadCount: overview.employeeReadCount,
    totalAssignments: overview.totalAssignments,
    completedCount: overview.completedCount,
    inProgressCount: overview.inProgressCount,
    pendingCount: overview.pendingCount,
    overdueCount: overview.overdueCount,
    taskReachRate: overview.taskReachRate,
    taskReadRate: overview.taskReadRate,
    completionRate: overview.completionRate,
    onTimeCompletionRate: overview.onTimeCompletionRate,
    nudgeConversionRate: overview.nudgeConversionRate,
  };

  const userMsg = `请分析下列任务的转化漏斗（来自 GET /dashboard/overview 同源数据）：
${JSON.stringify(slice, null, 2)}`;

  let raw = '';
  try {
    raw = await simpleChat(
      [
        { role: 'system', content: FUNNEL_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { model: 'deepseek-v4-flash', maxTokens: 400, temperature: 0.2, disableThinking: true }
    );
  } catch (err) {
    logger.error(`[SubAgent funnel] LLM error: ${err.message}`, { taskId: task.taskId });
    return fallbackFunnel(slice, err.message);
  }

  const parsed = extractJsonSafely(raw);
  if (!parsed) {
    logger.error(`[SubAgent funnel] JSON parse failed: ${raw.slice(0, 200)}`, { taskId: task.taskId });
    return fallbackFunnel(slice, 'JSON 解析失败');
  }
  return mergeRegionResult(parsed, {
    region: 'funnel',
    taskId: task.taskId,
    fallbackKeyFindings: {
      触达率: slice.taskReachRate,
      阅读率: slice.taskReadRate,
      完成率: slice.completionRate,
      催办转化率: slice.nudgeConversionRate,
    },
  });
}

function fallbackFunnel(slice, reason) {
  let severity = 'green';
  if (slice.taskReachRate < 60 || slice.taskReadRate < 30) severity = 'red';
  else if (slice.taskReadRate < 60 || slice.completionRate < 40) severity = 'orange';
  let focusHint = 'on_time_completion_rate';
  if (slice.taskReachRate < 70) focusHint = 'task_reach_rate';
  if (slice.taskReadRate < 60) focusHint = 'task_read_rate';
  if (slice.nudgeConversionRate < 20 && slice.totalAssignments > 0) focusHint = 'nudge_total_conversion';
  return {
    region: 'funnel',
    taskId: slice.taskId,
    severity,
    summary:
      `触达${slice.taskReachRate}%、阅读${slice.taskReadRate}%、完成${slice.completionRate}%；` +
      (slice.nudgeConversionRate ? `催办转化${slice.nudgeConversionRate}%。` : '催办尚未充分开展。'),
    keyFindings: {
      触达率: slice.taskReachRate,
      阅读率: slice.taskReadRate,
      完成率: slice.completionRate,
      催办转化率: slice.nudgeConversionRate,
    },
    focusHint,
    degraded: true,
    degradedReason: reason,
  };
}

module.exports = { runFunnelAnalyzer };
