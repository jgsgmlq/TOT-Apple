#!/usr/bin/env node
'use strict';

/**
 * runEval.js — Executive Chat Agent Eval Runner
 *
 * Usage:
 *   node server/agent/eval/runEval.js --baseline  → Record current agent performance
 *   node server/agent/eval/runEval.js --compare   → Compare against baseline, output diff report
 *   node server/agent/eval/runEval.js --quick     → Run unit cases only, print summary to stdout
 *
 * Reports: server/agent/eval/reports/
 * Baseline: server/agent/eval/baseline.json
 */

const path = require('path');
const fs = require('fs');

const EVAL_DIR = __dirname;
const REPORTS_DIR = path.join(EVAL_DIR, 'reports');
const CASES_PATH = path.join(EVAL_DIR, 'evalCases.json');
const BASELINE_PATH = path.join(EVAL_DIR, 'baseline.json');

function loadCases() {
  return JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
}

function pct(n, total) {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

async function runUnitCases(cases) {
  const { contextAnalyzerRouter: routerFn } = require('../graph/nodes/routerNode');
  const { normalizeIntent } = require('../graph/intents');
  const { HumanMessage, AIMessage } = require('@langchain/core/messages');

  const results = [];
  for (const tc of cases) {
    const historyMsgs = (tc.history || []).map(h =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage({ content: h.content })
    );

    const state = {
      userMessage: tc.userMessage,
      userId: 'eval_user',
      sessionId: `eval_${tc.id}`,
      messages: historyMsgs,
      regionScope: { type: 'national', regions: null, rtm: null, userRoles: ['executive'] },
      memory_snippets: [],
      meta_trace_id: '',
      meta_fallback_count: 0,
      intent: '',
      mode: 'tool_action'
    };

    try {
      const routerResult = await routerFn(state, { configurable: {} });

      const actualIntent = routerResult.intent || '';
      const actualMode = routerResult.mode || '';
      const canonicalIntent = normalizeIntent(actualIntent);

      const expectedIntents = tc.expected.intent;
      const intentMatch = !expectedIntents || expectedIntents.length === 0
        ? true
        : expectedIntents.includes(canonicalIntent) || expectedIntents.includes(actualIntent);

      const expectedMode = tc.expected.mode;
      const modeMatch = !expectedMode ? true : (actualMode === expectedMode);

      results.push({
        caseId: tc.id,
        type: tc.type,
        category: tc.category,
        userMessage: tc.userMessage,
        actual: { intent: canonicalIntent, rawIntent: actualIntent, mode: actualMode },
        expected: {
          intent: expectedIntents || null,
          mode: expectedMode || null,
          topKIncludes: tc.expected.topKIncludes || null,
          topKExcludes: tc.expected.topKExcludes || null
        },
        intentMatch,
        modeMatch,
        passed: intentMatch && modeMatch
      });
    } catch (err) {
      results.push({
        caseId: tc.id,
        type: tc.type,
        category: tc.category,
        userMessage: tc.userMessage,
        error: err.message,
        actual: { intent: '', rawIntent: '', mode: '' },
        expected: { intent: tc.expected.intent || null, mode: tc.expected.mode || null },
        intentMatch: false,
        modeMatch: false,
        passed: false
      });
    }
  }
  return results;
}

function summarize(results) {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const intentPassed = results.filter(r => r.intentMatch).length;
  const modePassed = results.filter(r => r.modeMatch).length;
  const errors = results.filter(r => r.error).length;

  const byCategory = {};
  for (const r of results) {
    const cat = r.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, intentOk: 0, modeOk: 0 };
    byCategory[cat].total += 1;
    if (r.passed) byCategory[cat].passed += 1;
    if (r.intentMatch) byCategory[cat].intentOk += 1;
    if (r.modeMatch) byCategory[cat].modeOk += 1;
  }

  return {
    total,
    passed,
    failed: total - passed,
    errors,
    intentAccuracy: { passed: intentPassed, total, rate: pct(intentPassed, total) },
    modeAccuracy: { passed: modePassed, total, rate: pct(modePassed, total) },
    overallRate: pct(passed, total),
    byCategory,
    failures: results.filter(r => !r.passed).map(r => ({
      caseId: r.caseId,
      userMessage: r.userMessage,
      category: r.category,
      actual: r.actual,
      expected: { intent: r.expected.intent, mode: r.expected.mode },
      intentMatch: r.intentMatch,
      modeMatch: r.modeMatch,
      error: r.error || null
    }))
  };
}

function compareSummaries(current, baseline) {
  const regressions = [];
  const improvements = [];

  for (const cr of current) {
    const br = baseline.results?.find(r => r.caseId === cr.caseId);
    if (!br) continue;
    if (cr.passed && !br.passed) improvements.push({ caseId: cr.caseId, userMessage: cr.userMessage, before: br.actual, after: cr.actual });
    else if (!cr.passed && br.passed) regressions.push({ caseId: cr.caseId, userMessage: cr.userMessage, before: br.actual, after: cr.actual });
  }

  const curSummary = summarize(current);
  const baseSummary = summarize(baseline.results || []);

  return {
    baseline: { intentAccuracy: baseSummary.intentAccuracy.rate, modeAccuracy: baseSummary.modeAccuracy.rate, overall: baseSummary.overallRate },
    current: { intentAccuracy: curSummary.intentAccuracy.rate, modeAccuracy: curSummary.modeAccuracy.rate, overall: curSummary.overallRate },
    delta: { intent: `${curSummary.intentAccuracy.passed - baseSummary.intentAccuracy.passed}`, mode: `${curSummary.modeAccuracy.passed - baseSummary.modeAccuracy.passed}`, overall: `${curSummary.passed - baseSummary.passed}` },
    regressions,
    improvements,
    regressionsCount: regressions.length,
    improvementsCount: improvements.length
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--baseline') ? 'baseline'
    : args.includes('--compare') ? 'compare'
    : 'quick';

  const allCases = loadCases();
  const unitCases = allCases.filter(c => c.type === 'unit');

  console.log(`\nExecutive Chat Eval — ${mode} mode`);
  console.log(`Cases: ${unitCases.length} unit\n`);

  const results = await runUnitCases(unitCases);
  const summary = summarize(results);

  if (mode === 'baseline') {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ recordedAt: new Date().toISOString(), summary, results }, null, 2));
    console.log(`Baseline saved → ${BASELINE_PATH}`);
  }

  if (mode === 'compare') {
    if (!fs.existsSync(BASELINE_PATH)) {
      console.error('No baseline found. Run --baseline first.');
      process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
    const cmp = compareSummaries(results, baseline);
    const rp = path.join(REPORTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-compare.json`);
    fs.writeFileSync(rp, JSON.stringify(cmp, null, 2));
    console.log(`Compare report → ${rp}`);
  }

  console.log('\n── Summary ────────────────────────────────────');
  console.log(`  Intent accuracy: ${summary.intentAccuracy.rate} (${summary.intentAccuracy.passed}/${summary.intentAccuracy.total})`);
  console.log(`  Mode accuracy:   ${summary.modeAccuracy.rate} (${summary.modeAccuracy.passed}/${summary.modeAccuracy.total})`);
  console.log(`  Overall pass:    ${summary.overallRate} (${summary.passed}/${summary.total})`);
  console.log(`  Errors:          ${summary.errors}`);
  console.log('\n── By Category ────────────────────────────────');
  for (const [cat, stats] of Object.entries(summary.byCategory).sort()) {
    console.log(`  ${cat.padEnd(25)} ${stats.passed}/${stats.total}  (intent: ${pct(stats.intentOk, stats.total)}, mode: ${pct(stats.modeOk, stats.total)})`);
  }

  if (summary.failures.length > 0) {
    console.log(`\n── Failures (${summary.failures.length}) ─────────────────────────`);
    for (const f of summary.failures) {
      console.log(`  ${f.caseId}  "${f.userMessage}"`);
      console.log(`    Expected: intent=${JSON.stringify(f.expected.intent)} mode=${f.expected.mode}`);
      console.log(`    Actual:   intent=${f.actual.intent||'(none)'} mode=${f.actual.mode||'(none)'}`);
      if (f.error) console.log(`    Error:    ${f.error}`);
    }
  }

  if (mode === 'compare') {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
    const cmp = compareSummaries(results, baseline);
    if (cmp.regressionsCount > 0) {
      console.log(`\n⚠️  REGRESSIONS (${cmp.regressionsCount})`);
      for (const r of cmp.regressions) console.log(`  ${r.caseId} "${r.userMessage}"`);
    }
    if (cmp.improvementsCount > 0) {
      console.log(`\n✅ IMPROVEMENTS (${cmp.improvementsCount})`);
      for (const i of cmp.improvements) console.log(`  ${i.caseId} "${i.userMessage}"`);
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error('Eval failed:', err.stack || err.message); process.exit(1); });
