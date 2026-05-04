'use strict';

/**
 * RoutingPolicy v7.0
 *
 * 简化原则：
 * - Router 只输出 intent + modifiers + risk_flags
 * - tier 不再有 6 级，直接根据 modifiers 计算步数
 * - 修饰标签精确激活工具
 */

// ─── 3 主意图 → 基础候选工具 ──────────────────────────────────────────────────
const INTENT_TOOL_MAP = {
  chat_only:  [],
  data_query: ['queryMetrics', 'searchEntities'],
  deny:       [],
};

// 修饰标签 → 激活的工具（排在 queryMetrics 之前）
const MODIFIER_TOOL_MAP = {
  needs_lookup:        'searchEntities',
  needs_ranking:       'rank',
  needs_comparison:    'compare',
  needs_distribution:  'distribution',
  needs_timeseries:    'timeseries',
  needs_funnel:        'funnel',
  needs_analytics:     'analyze',
  needs_detail:        'listRecords',
};

/**
 * 步数计算（v7.0 简化版）
 * @param {Object} modifiers
 * @returns {number} max_super_steps
 */
function getMaxSteps(modifiers = {}) {
  let steps = 2;                        // 基础：消歧 + 查询
  if (modifiers.needs_comparison) steps += 1;   // compare 两次子查询
  if (modifiers.needs_analytics)  steps += 1;   // analyze + fetchData
  steps += 1;                           // buffer
  return steps;                         // 3 / 4 / 5
}

/**
 * 根据主意图与修饰标签推荐工具列表（按优先级排序）
 */
function getCandidateTools(main_intent, modifiers = {}) {
  if (main_intent === 'chat_only' || main_intent === 'deny') return [];

  const activated = [];
  for (const [key, tool] of Object.entries(MODIFIER_TOOL_MAP)) {
    if (modifiers[key]) activated.push(tool);
  }
  const base = INTENT_TOOL_MAP[main_intent] || ['queryMetrics', 'searchEntities'];
  const result = [...activated];
  for (const t of base) { if (!result.includes(t)) result.push(t); }
  for (const extra of ['listTasks', 'timeseries', 'compare', 'distribution', 'funnel', 'listRecords', 'rank']) {
    if (!result.includes(extra)) result.push(extra);
  }
  return result;
}

function pickPrimaryTool(main_intent, modifiers = {}) {
  const candidates = getCandidateTools(main_intent, modifiers);
  return candidates.length > 0 ? candidates[0] : null;
}

// ─── 向后兼容旧常量（nodes.js / graph.js 仍引用 tiers / thresholds） ─────────
const tiers = {
  L2_intent_fastpath: { max_super_steps: 3, tool_top_k: 5, max_repair_attempts: 1 },
  L3_fc_guarded:      { max_super_steps: 4, tool_top_k: 5, max_repair_attempts: 2 },
  L4_heavy_fc:        { max_super_steps: 5, tool_top_k: 5, max_repair_attempts: 3 },
};

const thresholds = {
  ner_confidence: 0.85,
  complexity_score_l2_max: 0.20,
  complexity_score_l4_min: 0.60,
  topk_min_score: 0.60,
};

const RoutingPolicy = { thresholds, tiers, getMaxSteps, pickPrimaryTool, getCandidateTools, INTENT_TOOL_MAP, MODIFIER_TOOL_MAP };

module.exports = RoutingPolicy;
module.exports.getMaxSteps = getMaxSteps;
module.exports.pickPrimaryTool = pickPrimaryTool;
module.exports.getCandidateTools = getCandidateTools;
module.exports.INTENT_TOOL_MAP = INTENT_TOOL_MAP;
module.exports.MODIFIER_TOOL_MAP = MODIFIER_TOOL_MAP;

// 保持旧导出（向后兼容）
module.exports.computeStepBudget = (routerOutput = {}) => {
  const main_intent = routerOutput.main_intent || 'data_query';
  const modifiers = routerOutput.modifiers || {};
  const risk = routerOutput.risk_flags === true;
  if (risk || main_intent === 'deny') return { tier: 'L_DENY', max_super_steps: 0, tool_top_k: 0, max_repair_attempts: 0, signalScore: 0, scoreBreakdown: { reason: 'deny' } };
  if (main_intent === 'chat_only') return { tier: 'L1_chat_only', max_super_steps: 0, tool_top_k: 0, max_repair_attempts: 0, signalScore: 0, scoreBreakdown: { reason: 'chat_only' } };
  const steps = getMaxSteps(modifiers);
  const tier = steps <= 3 ? 'L2_intent_fastpath' : steps <= 4 ? 'L3_fc_guarded' : 'L4_heavy_fc';
  return { tier, max_super_steps: steps, tool_top_k: 5, max_repair_attempts: 2, signalScore: steps, scoreBreakdown: {} };
};
