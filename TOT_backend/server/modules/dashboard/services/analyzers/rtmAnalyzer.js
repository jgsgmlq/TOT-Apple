'use strict';

const { simpleChat } = require('../../../common/utils/ai');
const { getHeatmapBoardData } = require('../queryEngine');
const { RTM_SYSTEM_PROMPT } = require('./promptTemplates');
const { extractJsonSafely, mergeRegionResult } = require('./shared');

/**
 * RTM/门店进度排行子 Agent。
 * @param {{ taskId: string, title: string, ddl_at: string }} task
 * @returns {Promise<import('./shared').RegionResult>}
 */
async function runRtmAnalyzer(task) {
  const rtmHeat = await getHeatmapBoardData({ taskId: task.taskId, rtmLevel: 'rtm' });
  const storeHeat = await getHeatmapBoardData({ taskId: task.taskId, rtmLevel: 'store' });

  const rtmBuckets = (rtmHeat.heatmapData || []).map((r) => ({
    rtm: r.rtmValue,
    completionRate: r.completionRate,
    assignmentCount: r.assignmentCount,
    completedCount: r.completedCount,
  }));

  const storeAll = storeHeat.heatmapData || [];
  const worstStores = [...storeAll]
    .sort((a, b) => a.completionRate - b.completionRate)
    .slice(0, 10)
    .map((s) => ({
      store: s.rtmValue,
      completionRate: s.completionRate,
      assignmentCount: s.assignmentCount,
      completedCount: s.completedCount,
    }));

  const max = rtmBuckets.length ? Math.max(...rtmBuckets.map((r) => r.completionRate || 0)) : 0;
  const min = rtmBuckets.length ? Math.min(...rtmBuckets.map((r) => r.completionRate || 0)) : 0;

  const slice = {
    taskId: task.taskId,
    title: task.title,
    ddl_at: task.ddl_at,
    rtmCount: rtmBuckets.length,
    rtmCompletionRange: { min, max, gap: Number((max - min).toFixed(2)) },
    rtmBuckets,
    worstStores,
    storeTotal: storeAll.length,
  };

  const userMsg = `请分析下列任务在 RTM/门店维度的完成率分化（来自 GET /dashboard/heatmap 同源）：
${JSON.stringify(slice, null, 2)}`;

  let raw = '';
  try {
    raw = await simpleChat(
      [
        { role: 'system', content: RTM_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { model: 'deepseek-v4-flash', maxTokens: 500, temperature: 0.2, disableThinking: true }
    );
  } catch (err) {
    logger.error(`[SubAgent rtm] LLM error: ${err.message}`, { taskId: task.taskId });
    return fallbackRtm(slice, err.message);
  }

  const parsed = extractJsonSafely(raw);
  if (!parsed) {
    logger.error(`[SubAgent rtm] JSON parse failed: ${raw.slice(0, 200)}`, { taskId: task.taskId });
    return fallbackRtm(slice, 'JSON 解析失败');
  }
  return mergeRegionResult(parsed, {
    region: 'rtm',
    taskId: task.taskId,
    fallbackKeyFindings: {
      RTM数: slice.rtmCount,
      最高完成率: slice.rtmCompletionRange.max,
      最低完成率: slice.rtmCompletionRange.min,
      RTM完成率差: slice.rtmCompletionRange.gap,
    },
  });
}

function fallbackRtm(slice, reason) {
  let severity = 'green';
  if (slice.rtmCompletionRange.gap >= 30) severity = 'orange';
  if (slice.worstStores.some((s) => s.completionRate === 0 && s.assignmentCount >= 5))
    severity = 'red';
  return {
    region: 'rtm',
    taskId: slice.taskId,
    severity,
    summary: `${slice.rtmCount} 个 RTM 完成率范围 ${slice.rtmCompletionRange.min}%~${slice.rtmCompletionRange.max}%；最差 ${slice.worstStores.length} 家门店人均完成率较低。`,
    keyFindings: {
      RTM数: slice.rtmCount,
      最高完成率: slice.rtmCompletionRange.max,
      最低完成率: slice.rtmCompletionRange.min,
      RTM完成率差: slice.rtmCompletionRange.gap,
    },
    focusHint: slice.rtmCompletionRange.gap >= 30 ? 'rtm_completion_gap' : 'store_worst_bucket',
    degraded: true,
    degradedReason: reason,
  };
}

module.exports = { runRtmAnalyzer };
