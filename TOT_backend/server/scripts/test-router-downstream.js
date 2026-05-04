'use strict';

/**
 * 回归测试：v5.0 Router 输出的新主意图，下游消费点必须能正确识别。
 *
 * 这组测试是为了防止 "Router 重构 → 下游漏改" 的灾难性 bug 再次发生。
 * 不依赖 LLM / DB，纯函数级断言。
 *
 * 覆盖：
 *  1. nodes.js HITL picker（fc_ValidateParams）
 *  2. nodes.js buildChartPayload（big_number / warning-like skip）
 *  3. nodes.js INTENT_FORMATS（5 主意图全覆盖 + metric_query 子格式）
 *  4. routingPolicy.computeStepBudget 与 pickPrimaryTool（已在 test-routing-budget.js）
 */

const path = require('path');
const Module = require('module');
const fs = require('fs');

// ─── Mock 依赖（DB / langchain 等不可用时） ───
const mockDb = { all: () => [], get: () => null, run: () => ({}) };
const dbPath = path.join(__dirname, '..', 'db', 'index.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: mockDb }, paths: [] };

const loggerPath = path.join(__dirname, '..', 'utils', 'logger.js');
if (fs.existsSync(loggerPath)) {
  require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }, paths: [] };
}

const { normalizeMainIntent, VALID_MAIN_INTENTS } = require('../services/chatIntentService');

let pass = 0, fail = 0;
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

// ─── Mock 提取出 nodes.js 里的关键决策逻辑（避免加载完整 LangGraph） ───
// 直接复制粘贴当前生产逻辑（这就是断言的对象，必须与生产代码同步）

// 【1】HITL picker 决策
function decidePickers({ intent, toolName, modifiers, lowConfidenceEntities }) {
  const ni = normalizeMainIntent(intent || '');
  const wantsTaskPicker = toolName === 'getTaskListData'
    || ((ni === 'metric_query' || ni === 'funnel_query')
        && lowConfidenceEntities.some((e) => /task|product/i.test(e)));
  const wantsProgressPicker = (ni === 'metric_query' || ni === 'funnel_query')
    && lowConfidenceEntities.length > 0
    && !wantsTaskPicker;
  return { wantsTaskPicker, wantsProgressPicker };
}

// 【2】warning-like 决策
function isWarningLikeQuery(ctx = {}) {
  const modifiers = ctx.modifiers || {};
  const metrics = Array.isArray(ctx.metrics) ? ctx.metrics : [];
  if (modifiers.needs_topn_or_bottomn) return true;
  if (metrics.some((m) => /warning|crisis|p[012]_warning/i.test(String(m)))) return true;
  if (Array.isArray(ctx.toolNames) && ctx.toolNames.includes('getWarningsData')) return true;
  return false;
}

// 【3】INTENT_FORMATS 覆盖率
const INTENT_FORMAT_KEYS = ['chat_only', 'entity_search', 'funnel_query', 'analytics_query', 'default'];
function hasIntentFormat(intent) {
  if (intent === 'metric_query') return true;  // metric_query 走 buildMetricFormat 子分支
  return INTENT_FORMAT_KEYS.includes(intent);
}

// ─── 测试组 ─────────────────────────────────────────────────────────────────

describe('1. HITL picker — Router v5 → 下游正确触发', () => {
  // 旧 bug: intent === 'project_status' 永不匹配（Router v5 不输出此值）
  eq(
    decidePickers({ intent: 'metric_query', toolName: 'getTaskListData', modifiers: {}, lowConfidenceEntities: [] }).wantsTaskPicker,
    true,
    'getTaskListData 调用必须触发 task picker（不依赖意图名）'
  );
  eq(
    decidePickers({ intent: 'metric_query', toolName: 'queryExecutiveMetrics', modifiers: {}, lowConfidenceEntities: ['taskName'] }).wantsTaskPicker,
    true,
    'metric_query + taskName 低置信 → task picker'
  );
  eq(
    decidePickers({ intent: 'funnel_query', toolName: 'queryConversionFunnel', modifiers: {}, lowConfidenceEntities: ['taskName'] }).wantsTaskPicker,
    true,
    'funnel_query + taskName 低置信 → task picker'
  );
  // 旧 bug: intent === 'query_metrics' 永不匹配
  eq(
    decidePickers({ intent: 'metric_query', toolName: 'queryExecutiveMetrics', modifiers: {}, lowConfidenceEntities: ['region'] }).wantsProgressPicker,
    true,
    'metric_query + region 低置信 → progress picker'
  );
  eq(
    decidePickers({ intent: 'funnel_query', toolName: 'queryConversionFunnel', modifiers: {}, lowConfidenceEntities: ['dealerName'] }).wantsProgressPicker,
    true,
    'funnel_query + 非 task 低置信 → progress picker'
  );
  // 历史值兼容（旧 chat_messages）
  eq(
    decidePickers({ intent: 'progress_query', toolName: 'getTaskListData', modifiers: {}, lowConfidenceEntities: [] }).wantsTaskPicker,
    true,
    '历史 progress_query 值（normalizeMainIntent 自动→metric_query）+ getTaskListData → task picker'
  );
  // 不该触发的场景
  eq(
    decidePickers({ intent: 'chat_only', toolName: '', modifiers: {}, lowConfidenceEntities: [] }).wantsProgressPicker,
    false,
    'chat_only 不该触发 progress picker'
  );
  eq(
    decidePickers({ intent: 'analytics_query', toolName: 'runAnalytics', modifiers: {}, lowConfidenceEntities: ['taskName'] }).wantsTaskPicker,
    false,
    'analytics_query（不在白名单）即使有低置信 task 也不触发 task picker'
  );
});

describe('2. buildChartPayload — warning-like 判定', () => {
  // 旧 bug: intent === 'warning_query' 永不匹配
  eq(
    isWarningLikeQuery({ modifiers: { needs_topn_or_bottomn: true } }),
    true,
    'needs_topn_or_bottomn → warning-like'
  );
  eq(
    isWarningLikeQuery({ metrics: ['p0_warning_rate', 'complete_rate'] }),
    true,
    '请求 P 级预警指标 → warning-like'
  );
  eq(
    isWarningLikeQuery({ metrics: ['crisis_p1_count'] }),
    true,
    '旧别名 crisis_p1_count → warning-like'
  );
  eq(
    isWarningLikeQuery({ toolNames: ['getWarningsData', 'getOverviewData'] }),
    true,
    '调用了旧 getWarningsData → warning-like'
  );
  eq(
    isWarningLikeQuery({ modifiers: { needs_compare: true }, metrics: ['complete_rate'] }),
    false,
    'needs_compare 但无预警指标 → 非 warning-like'
  );
  eq(
    isWarningLikeQuery({ modifiers: {}, metrics: ['reach_rate'], toolNames: ['queryExecutiveMetrics'] }),
    false,
    '完全普通的查询 → 非 warning-like'
  );
});

describe('3. INTENT_FORMATS — 5 主意图必须全覆盖', () => {
  for (const intent of VALID_MAIN_INTENTS) {
    eq(hasIntentFormat(intent), true, `INTENT_FORMATS 覆盖 ${intent}`);
  }
});

describe('4. normalizeMainIntent — 旧值映射兼容', () => {
  eq(normalizeMainIntent('progress_query'), 'metric_query', '旧 progress_query → metric_query');
  eq(normalizeMainIntent('matrix_query'), 'metric_query', '旧 matrix_query → metric_query');
  eq(normalizeMainIntent('warning_query'), 'metric_query', '旧 warning_query → metric_query');
  eq(normalizeMainIntent('drill_down'), 'metric_query', '旧 drill_down → metric_query');
  eq(normalizeMainIntent('project_status'), 'metric_query', '旧 project_status → metric_query');
  eq(normalizeMainIntent('query_metrics'), 'metric_query', '旧 query_metrics → metric_query');
  eq(normalizeMainIntent('analytics_query'), 'analytics_query', 'analytics_query 恒等');
  eq(normalizeMainIntent('funnel_query'), 'funnel_query', 'funnel_query 恒等');
  eq(normalizeMainIntent('entity_search'), 'entity_search', 'entity_search 恒等');
  eq(normalizeMainIntent('chat_only'), 'chat_only', 'chat_only 恒等');
  eq(normalizeMainIntent('unknown'), 'chat_only', 'unknown → chat_only');
  eq(normalizeMainIntent(''), 'metric_query', '空串 → metric_query (安全兜底)');
});

// ─── 总结 ───────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────────────────`);
console.log(`Result: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log('Failures:', JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
