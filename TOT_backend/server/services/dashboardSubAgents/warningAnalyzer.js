'use strict';

const { simpleChat } = require('../../utils/ai');
const {
  getOverviewBoardData,
  getWarningsBoardData,
  getNudgeConversionBoardData,
} = require('../dashboardQueryCore');
const { WARNING_SYSTEM_PROMPT } = require('./promptTemplates');
const { extractJsonSafely, mergeRegionResult } = require('./shared');

/**
 * 预警风险漏斗子 Agent：P2/P1/P0 + 红橙黄催办覆盖与转化。
 * @param {{ taskId: string, title: string, ddl_at: string }} task
 * @returns {Promise<import('./shared').RegionResult>}
 */
async function runWarningAnalyzer(task) {
  const overview = getOverviewBoardData({ taskId: task.taskId });

  // 取最差的 8 个 store（按 warningRate 倒序），按 warningLevel = p0/p1/p2 各取一页
  const collectTopStores = (level) =>
    getWarningsBoardData({ taskId: task.taskId, warningLevel: level, pageSize: 8, level: 'store' })
      .list.map((s) => ({
        store: s.storeName,
        level: s.warningLevel,
        riskCount: s.riskCount,
        totalCount: s.totalCount,
        warningRate: Number(s.warningRate.toFixed ? s.warningRate.toFixed(2) : s.warningRate),
        completionRate: s.completionRate,
      }));

  const p0Stores = safeCollect(() => collectTopStores('p0'));
  const p1Stores = safeCollect(() => collectTopStores('p1'));
  const p2Stores = safeCollect(() => collectTopStores('p2'));

  const nudgeConvTop = safeCollect(() =>
    getNudgeConversionBoardData({ taskId: task.taskId, level: 'store', pageSize: 8 }).list.map((r) => ({
      store: r.targetName,
      red: r.red,
      orange: r.orange,
      yellow: r.yellow,
      total: r.total,
    }))
  );

  const slice = {
    taskId: task.taskId,
    title: task.title,
    ddl_at: task.ddl_at,
    crisis: {
      p0Rate: overview.crisisP0Rate,
      p1Rate: overview.crisisP1Rate,
      p2Rate: overview.crisisP2Rate,
      warningCount: overview.warningCount,
    },
    overdueCount: overview.overdueCount,
    nudgeConversionRate: overview.nudgeConversionRate,
    topRiskStores: { p0: p0Stores, p1: p1Stores, p2: p2Stores },
    nudgeConvByStore: nudgeConvTop,
  };

  const userMsg = `请分析下列任务的预警风险漏斗（数据来自 /dashboard/overview + /warnings + /nudge-conversion 同源）：
${JSON.stringify(slice, null, 2)}`;

  let raw = '';
  try {
    raw = await simpleChat(
      [
        { role: 'system', content: WARNING_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { model: 'deepseek-v4-flash', maxTokens: 500, temperature: 0.2, disableThinking: true }
    );
  } catch (err) {
    console.error('[SubAgent warning] LLM error', task.taskId, err.message);
    return fallbackWarning(slice, err.message);
  }

  const parsed = extractJsonSafely(raw);
  if (!parsed) {
    console.error('[SubAgent warning] JSON parse failed', task.taskId, raw.slice(0, 200));
    return fallbackWarning(slice, 'JSON 解析失败');
  }
  return mergeRegionResult(parsed, {
    region: 'warning',
    taskId: task.taskId,
    fallbackKeyFindings: {
      P0占比: slice.crisis.p0Rate,
      P1占比: slice.crisis.p1Rate,
      P2占比: slice.crisis.p2Rate,
      逾期人数: slice.overdueCount,
    },
  });
}

function safeCollect(fn) {
  try {
    return fn();
  } catch (e) {
    return [];
  }
}

function fallbackWarning(slice, reason) {
  let severity = 'green';
  if (slice.crisis.p0Rate >= 30) severity = 'red';
  else if (slice.crisis.p0Rate >= 10 || slice.crisis.p1Rate >= 30) severity = 'orange';
  let focusHint = 'warning_p1_rate';
  if (slice.crisis.p0Rate >= 30) focusHint = 'warning_p0_rate';
  else if (slice.crisis.p2Rate >= 40) focusHint = 'warning_p2_rate';
  else if (slice.overdueCount > (slice.crisis.warningCount?.p0 || 0)) focusHint = 'overdue_count';
  else if (slice.nudgeConversionRate < 20) focusHint = 'nudge_total_conversion';
  return {
    region: 'warning',
    taskId: slice.taskId,
    severity,
    summary: `当前 P0 占比 ${slice.crisis.p0Rate}%、P1 ${slice.crisis.p1Rate}%、P2 ${slice.crisis.p2Rate}%；逾期 ${slice.overdueCount} 人。`,
    keyFindings: {
      P0占比: slice.crisis.p0Rate,
      P1占比: slice.crisis.p1Rate,
      P2占比: slice.crisis.p2Rate,
      逾期人数: slice.overdueCount,
    },
    focusHint,
    degraded: true,
    degradedReason: reason,
  };
}

module.exports = { runWarningAnalyzer };
