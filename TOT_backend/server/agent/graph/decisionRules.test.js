'use strict';

const { correctMode, selectTier, getLowConfidenceEntities, hasUrgentSignal, canonicalIntent } = require('./decisionRules');

const assert = (cond, label) => {
  if (!cond) throw new Error(`[FAIL] ${label}`);
  console.log(`[PASS] ${label}`);
};

// ─── correctMode ──────────────────────────────────────────────
assert(correctMode('chat_only', 'query_metrics', false) === 'tool_action', 'chat_only + tool intent → tool_action');
assert(correctMode('chat_only', 'chat_only', false) === 'chat_only', 'chat_only + chat intent → chat_only');
assert(correctMode('tool_action', 'query_metrics', false) === 'tool_action', 'tool_action + tool intent → tool_action');
assert(correctMode('chat_only', 'query_metrics', true) === 'deny', 'riskFlags=true → deny regardless');
assert(correctMode('tool_action', 'warning_query', false) === 'tool_action', 'tool_action + warning_query → tool_action');

// ─── selectTier ───────────────────────────────────────────────
assert(selectTier(0.1, false) === 'L2_intent_fastpath', 'complexity 0.1 → L2');
assert(selectTier(0.5, false) === 'L3_fc_guarded', 'complexity 0.5 → L3');
assert(selectTier(0.8, false) === 'L4_heavy_fc', 'complexity 0.8 → L4');
assert(selectTier(0.5, true) === 'L3_fc_guarded', 'riskFlags=true → L3 conservative');
assert(selectTier(undefined, false) === 'L3_fc_guarded', 'undefined complexity → default L3');

// ─── getLowConfidenceEntities ─────────────────────────────────
assert(getLowConfidenceEntities({}).length === 0, 'empty entities → empty');
assert(getLowConfidenceEntities({ metric: 0.9 }).length === 0, '0.9 confidence → not low');
assert(getLowConfidenceEntities({ metric: 0.8 }).length === 1, '0.8 confidence → low');
assert(getLowConfidenceEntities({ metric: 0.9, region: 0.7 }).length === 1, 'only region is low');
assert(getLowConfidenceEntities({ metric: 'high', region: null }).length === 0, 'non-numeric confidence → skipped');

// ─── hasUrgentSignal ──────────────────────────────────────────
assert(hasUrgentSignal('这个任务很紧急需要关注') === true, '紧急 → urgent');
assert(hasUrgentSignal('P0预警门店') === true, 'P0 → urgent');
assert(hasUrgentSignal('正常查询完成率') === false, 'no signal → not urgent');
assert(hasUrgentSignal(null) === false, 'null → not urgent');
assert(hasUrgentSignal(123) === false, 'number → not urgent');

// ─── canonicalIntent ──────────────────────────────────────────
assert(canonicalIntent('matrix_query') === 'query_metrics', 'alias matrix_query → query_metrics');
assert(canonicalIntent('query_metrics') === 'query_metrics', 'canonical passes through');
assert(canonicalIntent('') === 'chat_only', 'empty → chat_only');
assert(canonicalIntent(null) === 'chat_only', 'null → chat_only');

console.log('\n✅ All decisionRules tests passed.');
