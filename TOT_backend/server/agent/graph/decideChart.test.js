'use strict';

const { decideChart } = require('./decideChart');

const assert = (cond, label) => {
  if (!cond) throw new Error(`[FAIL] ${label}`);
  console.log(`[PASS] ${label}`);
};

// ─── null cases ───────────────────────────────────────────────
assert(decideChart(null, 'query_metrics') === null, 'null toolResults → null');
assert(decideChart({}, 'query_metrics') === null, 'empty toolResults → null');
assert(decideChart({}, 'chat_only') === null, 'chat_only intent → null');

// ─── query_metrics with data ──────────────────────────────────
const metricEntry = {
  data: JSON.stringify([
    { dimensions: { channel_l3: '华东' }, completion_rate: 70, completed_count: 35 },
    { dimensions: { channel_l3: '华北' }, completion_rate: 56, completed_count: 28 },
  ]),
};
const chart = decideChart({ call_1: metricEntry }, 'query_metrics');
assert(chart !== null, 'query_metrics with dim data → chart');
assert(chart.type === 'bar', 'query_metrics → bar chart');
assert(chart.xAxis.length === 2, '2 groups → 2 xAxis labels');
assert(chart.series.length === 1, '1 metric → 1 series');

// ─── warning_query with data ──────────────────────────────────
const warningEntry = {
  data: JSON.stringify([
    { storeName: 'S008', completionRate: 20 },
    { storeName: 'S010', completionRate: 25 },
  ]),
};
const warnChart = decideChart({ call_1: warningEntry }, 'warning_query');
assert(warnChart !== null, 'warning_query with data → chart');
assert(warnChart.type === 'bar', 'warning_query → bar chart');
assert(warnChart.highlights !== undefined, 'low rates → highlights present');

// ─── drill_down with data ────────────────────────────────────
const drillEntry = {
  data: JSON.stringify([
    { storeName: 'S008', completionRate: 20, totalCount: 10 },
    { storeName: 'S006', completionRate: 30, totalCount: 10 },
    { storeName: 'S001', completionRate: 70, totalCount: 10 },
  ]),
};
const drillChart = decideChart({ call_1: drillEntry }, 'drill_down');
assert(drillChart !== null, 'drill_down with data → chart');
assert(drillChart.highlights.length > 0, 'drill_down < 30% → highlighted');

// ─── analytics_query with time data ────────────────────────────
const timeEntry = {
  data: JSON.stringify([
    { day: '2026-05-01', completedCount: 5 },
    { day: '2026-05-02', completedCount: 8 },
  ]),
};
const timeChart = decideChart({ call_1: timeEntry }, 'analytics_query');
assert(timeChart !== null, 'analytics with time data → chart');
assert(timeChart.type === 'line', 'time data → line chart');

console.log('\n✅ All decideChart tests passed.');
