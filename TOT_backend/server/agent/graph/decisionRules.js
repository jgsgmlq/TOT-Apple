'use strict';

/**
 * Decision Rules — Executive Chat 集中业务规则（纯函数，无副作用）
 *
 * 所有 intent 纠偏、tier 选择、HITL 触发判断等逻辑集中在此文件。
 * 不再散落在 nodes.js / chatService.js 各处。
 *
 * 文件组织：
 *   §1 Intent 纠偏
 *   §2 Tier 选择
 *   §3 HITL 触发判断
 *   §4 工具名称规范化
 */

const RoutingPolicy = require('./routingPolicy');

// ─── §1 Intent 纠偏 ──────────────────────────────────────────────────

/** mode 为 chat_only 但 intent 是非闲聊的工具意图时，强制覆盖为 tool_action */
const TOOL_INTENTS = new Set([
  'query_metrics', 'progress_query', 'drill_down',
  'project_status', 'warning_query', 'analytics_query',
]);

function correctMode(mode, intent, riskFlags) {
  if (riskFlags === true) return 'deny';
  if (mode === 'chat_only' && TOOL_INTENTS.has(intent)) return 'tool_action';
  return mode;
}

// ─── §2 Tier 选择 ────────────────────────────────────────────────────

function selectTier(complexityScore, riskFlags) {
  if (riskFlags) return 'L3_fc_guarded'; // 风险场景保守

  const cScore = complexityScore || 0.5;
  const { thresholds } = RoutingPolicy;

  if (cScore >= thresholds.complexity_score_l4_min) return 'L4_heavy_fc';
  if (cScore <= thresholds.complexity_score_l2_max) return 'L2_intent_fastpath';
  return 'L3_fc_guarded';
}

function getMaxSuperSteps(tier) {
  return RoutingPolicy.tiers[tier]?.max_super_steps || 3;
}

function getToolTopK(tier) {
  return RoutingPolicy.tiers[tier]?.tool_top_k || 3;
}

function getMaxRepairAttempts(tier) {
  return RoutingPolicy.tiers[tier]?.max_repair_attempts || 2;
}

// ─── §3 HITL 触发判断 ─────────────────────────────────────────────────

/** 实体置信度低于阈值 → 触发 HITL */
function getLowConfidenceEntities(entitiesConfidence) {
  const threshold = RoutingPolicy.thresholds.ner_confidence;
  const low = [];
  for (const [field, confidence] of Object.entries(entitiesConfidence || {})) {
    if (typeof confidence === 'number' && confidence < threshold) {
      low.push([field, confidence]);
    }
  }
  return low;
}

/** 检测用户消息中是否含紧急信号词 */
const URGENT_SIGNALS = [
  '紧急', '危机', 'P0', '马上', '立即', '立刻',
  '严重', '告警', '报警', '临界', '高风险',
];

function hasUrgentSignal(text) {
  if (typeof text !== 'string') return false;
  return URGENT_SIGNALS.some(s => text.includes(s));
}

// ─── §4 意图规范化 ──────────────────────────────────────────────────

const { normalizeIntent, INTENT_ALIAS_MAP } = require('./intents');

function canonicalIntent(rawIntent) {
  return normalizeIntent(rawIntent);
}

module.exports = {
  // §1
  correctMode,
  TOOL_INTENTS,
  // §2
  selectTier,
  getMaxSuperSteps,
  getToolTopK,
  getMaxRepairAttempts,
  // §3
  getLowConfidenceEntities,
  hasUrgentSignal,
  URGENT_SIGNALS,
  // §4
  canonicalIntent,
  INTENT_ALIAS_MAP,
};
