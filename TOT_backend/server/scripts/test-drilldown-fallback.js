'use strict';

/**
 * Smoke: drill_down without region/store should get structured guidance (no tool call).
 * Test 2: explicit region should classify as drill_down with region (not warning_query).
 *
 * Requires DEEPSEEK_API_KEY for classify path.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { classify } = require('../services/chatIntentService');

async function main() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !String(key).trim()) {
    console.error('DEEPSEEK_API_KEY is required');
    process.exit(1);
  }

  const q1 = '下钻看一下，整体情况怎么样？';
  const r1 = await classify(q1, []);
  console.log('Test1 classify:', q1, '->', r1.intentType, r1.entities);
  if (r1.intentType !== 'drill_down') {
    console.error('Test1 expected drill_down for ambiguous drill phrasing, got', r1.intentType);
    process.exit(1);
  }

  const q2 = '华东区完成情况怎么样？';
  const r2 = await classify(q2, []);
  console.log('Test2 classify:', q2, '->', r2.intentType, r2.entities);
  if (r2.intentType !== 'drill_down' || !r2.entities?.region) {
    console.error('Test2 expected drill_down with region 华东, got', r2);
    process.exit(1);
  }

  console.log('✅ drilldown fallback smoke: classify expectations met (runner guard tested separately).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
