'use strict';

/**
 * 自动预警规则中与 dashboard 共用的临期（deadlineCrisis）口径。
 * 与 evaluateAndTriggerAutoNudges 内对 ddl、hoursLeft、p0/p1 窗口的判断保持一致。
 */

function parseAutoNudgeRules(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

/** @returns {{ p0Hours: number, p1Hours: number, p2Percent: number } | null} */
function getDeadlineCrisisHours(rules) {
  if (!rules || !rules.deadlineCrisis) return null;
  return {
    p0Hours: rules.deadlineCrisis.p0 || 24,
    p1Hours: rules.deadlineCrisis.p1 || 48,
    p2Percent: rules.deadlineCrisis.p2 || rules.startDelay || 50,
  };
}

/**
 * @param {object} rules 已 parse 的 auto_nudge_rules
 * @param {number} hoursLeft 与 autoNudge 一致：(ddlAt - Date.now()) / 3600000
 * @param {number} passedPercent 与 autoNudge 一致：已过时间百分比 (0-100)
 * @returns {'p0'|'p1'|'p2'|null}
 */
function classifyDeadlineCrisisBand(rules, hoursLeft, passedPercent) {
  if (hoursLeft <= 0) return null;
  const h = getDeadlineCrisisHours(rules);
  if (!h) return null;
  if (hoursLeft <= h.p0Hours) return 'p0';
  if (hoursLeft <= h.p1Hours) return 'p1';
  if (typeof passedPercent === 'number' && passedPercent >= h.p2Percent) return 'p2';
  return null;
}

module.exports = {
  parseAutoNudgeRules,
  getDeadlineCrisisHours,
  classifyDeadlineCrisisBand,
};
