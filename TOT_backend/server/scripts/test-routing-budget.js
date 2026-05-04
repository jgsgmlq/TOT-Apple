'use strict';

/**
 * 单元测试：routingPolicy.computeStepBudget + pickPrimaryTool（v5.0）
 *
 * 全部确定性规则，不依赖 LLM / DB；可直接 `node scripts/test-routing-budget.js`。
 */

const RoutingPolicy = require('../agent/graph/routingPolicy');
const { computeStepBudget, pickPrimaryTool, getCandidateTools } = RoutingPolicy;

let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  [PASS] ${label}`);
  } else {
    fail++;
    failures.push({ label, expected, actual });
    console.log(`  [FAIL] ${label}\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
  }
}

function describe(group, fn) {
  console.log(`\n=== ${group} ===`);
  fn();
}

// ─── computeStepBudget ────────────────────────────────────────────────────────
describe('computeStepBudget — 边界与等级映射', () => {
  // 1. 风险一票否决 → L_DENY
  eq(
    computeStepBudget({ main_intent: 'metric_query', risk_flags: true, modifiers: { needs_compare: true } }).tier,
    'L_DENY',
    'risk_flags=true 必须 → L_DENY'
  );

  // 2. chat_only → L1_chat_only
  eq(
    computeStepBudget({ main_intent: 'chat_only' }).tier,
    'L1_chat_only',
    'chat_only → L1_chat_only'
  );
  eq(
    computeStepBudget({ main_intent: 'chat_only' }).max_super_steps,
    0,
    'L1_chat_only steps = 0'
  );

  // 3. 最简 metric_query (无修饰、置信度高) → score=2 → L2_fast
  const simpleMetric = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: {},
    entities_confidence: 0.9,
    risk_flags: false,
  });
  eq(simpleMetric.tier, 'L2_fast', '最简 metric_query → L2_fast (score=2)');
  eq(simpleMetric.signalScore, 2, 'simpleMetric signalScore = base(1) + buffer(1) = 2');
  eq(simpleMetric.max_super_steps, 2, 'L2_fast = 2 步');

  // 4. metric_query + 1 修饰 → score=3 → L3_normal
  const metricWithDrilldown = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: { needs_drilldown: true },  // 注意：drilldown 不增分（只影响参数，不增加步数）
    entities_confidence: 0.9,
  });
  eq(metricWithDrilldown.signalScore, 2, 'needs_drilldown 不增分（只影响参数填充）');

  // 5. metric_query + needs_compare → score=3 → L3_normal
  const metricCompare = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: { needs_compare: true },
    entities_confidence: 0.9,
  });
  eq(metricCompare.tier, 'L3_normal', 'metric_query + needs_compare → L3_normal');
  eq(metricCompare.signalScore, 3, 'compare +1 → score=3');

  // 6. metric_query + 消歧 + 时间序列 + 低置信度 → score=5 → L4_heavy
  const heavyMetric = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: {
      needs_disambiguation: true,
      needs_timeseries: true,
      needs_compare: false,
    },
    entities_confidence: 0.7,  // 低置信度 +1
  });
  eq(heavyMetric.tier, 'L4_heavy', 'disambig + timeseries + low_conf → L4_heavy (score=5)');
  eq(heavyMetric.signalScore, 5, 'score = 1+1+1+1+1 = 5');
  eq(heavyMetric.max_super_steps, 5, 'L4_heavy = 5 步');

  // 7. 极端：metric_query + 全部修饰 + 低置信度 → score=6 → L4_heavy 边界
  const extremeMetric = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: {
      needs_disambiguation: true,
      needs_timeseries: true,
      needs_compare: true,
      needs_topn_or_bottomn: true,
      needs_drilldown: true,
    },
    entities_confidence: 0.7,
  });
  eq(extremeMetric.signalScore, 6, '全修饰+低置信度 score=6 (drilldown/topn 不增分)');
  eq(extremeMetric.tier, 'L4_heavy', 'score=6 → L4_heavy 上界');

  // 8. funnel_query 无修饰 → L2_fast
  const simpleFunnel = computeStepBudget({
    main_intent: 'funnel_query',
    modifiers: {},
    entities_confidence: 0.9,
  });
  eq(simpleFunnel.tier, 'L2_fast', 'simple funnel_query → L2_fast');

  // 9. funnel_query + 消歧 → L3_normal
  const funnelWithDisambig = computeStepBudget({
    main_intent: 'funnel_query',
    modifiers: { needs_disambiguation: true },
    entities_confidence: 0.6,  // 触发 low_conf
  });
  eq(funnelWithDisambig.signalScore, 4, 'funnel + disambig + low_conf = 4');
  eq(funnelWithDisambig.tier, 'L3_normal', 'score=4 → L3_normal');

  // 10. analytics_query 自带 +1 overhead
  const simpleAnalytics = computeStepBudget({
    main_intent: 'analytics_query',
    modifiers: {},
    entities_confidence: 0.9,
  });
  eq(simpleAnalytics.signalScore, 3, 'analytics_query 自带 overhead +1, +base +buffer = 3');
  eq(simpleAnalytics.tier, 'L3_normal', 'analytics 起步 L3_normal');

  // 11. analytics + compare + timeseries + low_conf → score=6 → L4_heavy
  const heavyAnalytics = computeStepBudget({
    main_intent: 'analytics_query',
    modifiers: { needs_compare: true, needs_timeseries: true },
    entities_confidence: 0.7,
  });
  eq(heavyAnalytics.signalScore, 6, 'analytics(1)+overhead(1)+compare(1)+ts(1)+low_conf(1)+buffer(1) = 6');
  eq(heavyAnalytics.tier, 'L4_heavy', 'analytics heavy → L4_heavy');

  // 12. entity_search 简单 → L2_fast
  const entitySearch = computeStepBudget({
    main_intent: 'entity_search',
    modifiers: { needs_disambiguation: true },
    entities_confidence: 0.5,  // low_conf
  });
  eq(entitySearch.tier, 'L3_normal', 'entity_search + disambig + low_conf → L3_normal (score=4)');
});

describe('scoreBreakdown 可解释性', () => {
  const r = computeStepBudget({
    main_intent: 'metric_query',
    modifiers: { needs_compare: true, needs_timeseries: true },
    entities_confidence: 0.7,
  });
  console.log(`  breakdown: ${JSON.stringify(r.scoreBreakdown)}`);
  eq(r.scoreBreakdown.base, 1, 'base = 1');
  eq(r.scoreBreakdown.compare, 1, 'compare = 1');
  eq(r.scoreBreakdown.timeseries, 1, 'timeseries = 1');
  eq(r.scoreBreakdown.low_confidence, 1, 'low_confidence = 1');
  eq(r.scoreBreakdown.buffer, 1, 'buffer = 1');
});

describe('pickPrimaryTool — 修饰标签覆盖优先级', () => {
  eq(pickPrimaryTool('metric_query', {}), 'queryExecutiveMetrics', 'metric_query 默认主工具');
  eq(pickPrimaryTool('metric_query', { needs_compare: true }), 'compareMetrics', 'needs_compare → compareMetrics');
  eq(pickPrimaryTool('metric_query', { needs_timeseries: true }), 'queryMetricsTimeseries', 'needs_timeseries → queryMetricsTimeseries');
  eq(
    pickPrimaryTool('metric_query', { needs_compare: true, needs_timeseries: true }),
    'compareMetrics',
    'compare 优先级高于 timeseries'
  );
  eq(pickPrimaryTool('funnel_query', {}), 'queryConversionFunnel', 'funnel_query → queryConversionFunnel');
  eq(pickPrimaryTool('entity_search', {}), 'searchEntities', 'entity_search → searchEntities');
  eq(pickPrimaryTool('chat_only', {}), null, 'chat_only → null（不调工具）');
});

describe('getCandidateTools — 意图候选工具集', () => {
  eq(getCandidateTools('chat_only'), [], 'chat_only candidates = []');
  eq(getCandidateTools('entity_search'), ['searchEntities'], 'entity_search 仅 searchEntities');
  eq(
    getCandidateTools('metric_query'),
    ['queryExecutiveMetrics', 'queryMetricsTimeseries', 'compareMetrics', 'searchEntities'],
    'metric_query 4 个候选'
  );
  eq(getCandidateTools('funnel_query'), ['queryConversionFunnel', 'searchEntities'], 'funnel_query 2 个候选');
  eq(
    getCandidateTools('analytics_query'),
    ['runAnalytics', 'fetchRawDataset', 'executeCode'],
    'analytics_query 3 个候选'
  );
});

// ─── 总结 ─────────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────────────────`);
console.log(`Result: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log('Failures:', JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
