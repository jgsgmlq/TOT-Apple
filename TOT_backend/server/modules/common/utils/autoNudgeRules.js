'use strict';

/**
 * 自动预警规则中的纯计算函数（零 DB 访问）。
 * 供 dashboard、task 等模块共用。
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

function getDeadlineCrisisHours(rules) {
  if (!rules || !rules.deadlineCrisis) return null;
  return {
    p0Hours: rules.deadlineCrisis.p0 || 24,
    p1Hours: rules.deadlineCrisis.p1 || 48,
    p2Percent: rules.deadlineCrisis.p2 || rules.startDelay || 50,
  };
}

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
