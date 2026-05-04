'use strict';

/**
 * Intent classification checks. Use --golden for fixture-based regression (needs DEEPSEEK_API_KEY).
 *
 *   node scripts/test-intent-classify.js --golden
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { classify, normalizeMainIntent } = require('../services/chatIntentService');

async function runGolden() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !String(key).trim()) {
    console.error('DEEPSEEK_API_KEY is required for --golden');
    process.exit(1);
  }

  const fixturePath = path.join(__dirname, 'fixtures', 'intent-golden.json');
  const { cases } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const failures = [];
  let ok = 0;

  for (const c of cases) {
    const r = await classify(c.input, []);
    // v5.0：fixture 仍保留旧 7 类，断言时把 expectIntent 与 r.intentType 同时归一化到 5 主意图
    const expectMain = normalizeMainIntent(c.expectIntent);
    const gotMain = normalizeMainIntent(r.intentType);
    let pass = expectMain === gotMain;
    if (pass && c.expectAnalysisType != null) {
      pass = r.entities && r.entities.analysisType === c.expectAnalysisType;
    }
    if (pass) {
      ok++;
    } else {
      failures.push({
        input: c.input,
        expectIntent: c.expectIntent,
        expectMain,
        expectAnalysisType: c.expectAnalysisType,
        got: { intentType: r.intentType, mainIntent: gotMain, analysisType: r.entities?.analysisType },
      });
    }
  }

  const total = cases.length;
  console.log(JSON.stringify({ event: 'intent_golden_summary', ok, total, passRate: `${ok}/${total}` }));
  if (failures.length) {
    console.log(JSON.stringify({ event: 'intent_golden_failures', failures }, null, 2));
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes('--golden')) {
    await runGolden();
    return;
  }
  console.log('Usage: node scripts/test-intent-classify.js --golden');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
