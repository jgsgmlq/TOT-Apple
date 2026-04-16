'use strict';

const { parseAutoNudgeRules, classifyDeadlineCrisisBand } = require('../services/autoNudgeRules');

/**
 * 与 evaluateAndTriggerAutoNudges / GET dashboard/warnings 一致：按 assignment 计数，再除以总人数。
 * 概览 = 全量汇总；下钻门店 = 同一公式在单店分子分母上计算。
 */
function computeAssignmentWarningRates(assignRows, total, nowMs = Date.now()) {
  let startDelayN = 0;
  let p0N = 0;
  let p1N = 0;
  for (const row of assignRows) {
    const rules = parseAutoNudgeRules(row.auto_nudge_rules);
    const createdAt = new Date(row.created_at).getTime();
    const ddlAt = new Date(row.ddl_at).getTime();
    const totalDur = ddlAt - createdAt;
    const passedPct = totalDur > 0 ? ((nowMs - createdAt) / totalDur) * 100 : 100;
    const hoursLeft = (ddlAt - nowMs) / (1000 * 60 * 60);
    const incomplete = row.status !== 'completed';
    const prog = row.progress != null ? Number(row.progress) : 0;

    if (rules.startDelay && passedPct >= rules.startDelay && incomplete && prog === 0) {
      startDelayN++;
    }
    if (incomplete) {
      const band = classifyDeadlineCrisisBand(rules, hoursLeft);
      if (band === 'p0') p0N++;
      else if (band === 'p1') p1N++;
    }
  }
  const t = total || 0;
  return {
    startDelayRate: t > 0 ? parseFloat(((100 * startDelayN) / t).toFixed(2)) : 0,
    crisisP0Rate: t > 0 ? parseFloat(((100 * p0N) / t).toFixed(2)) : 0,
    crisisP1Rate: t > 0 ? parseFloat(((100 * p1N) / t).toFixed(2)) : 0,
  };
}

/**
 * 门店维度预警率（与概览同一含义，仅范围缩到该店该任务）
 * @param {'startDelay'|'p0'|'p1'} kind
 * @param {object} row aggregate 行须含 total_count、zero_prog_incomplete、uncompleted_count
 */
function ruleBasedStoreWarningRate(kind, row) {
  const tot = row.total_count || 0;
  if (!tot) return 0;
  if (kind === 'startDelay') {
    return parseFloat(((100 * (row.zero_prog_incomplete || 0)) / tot).toFixed(2));
  }
  return parseFloat(((100 * (row.uncompleted_count || 0)) / tot).toFixed(2));
}

module.exports = {
  computeAssignmentWarningRates,
  ruleBasedStoreWarningRate,
};
