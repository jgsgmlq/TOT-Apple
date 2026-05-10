'use strict';

/**
 * buildToolSignature 单测 — 锁死 F4 三个不变量：
 *   1. 同 args + 同 scope + 同时间桶 → 同签名
 *   2. 同 args + 同 scope + 跨时间桶 → 不同签名
 *   3. 同 args + 不同 scope → 不同签名
 */

const { buildToolSignature } = require('./toolCallUtils');

const assertEquals = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
  console.log(`[PASS] ${label}`);
};

const assertNotEquals = (actual, expected, label) => {
  if (actual === expected) {
    throw new Error(`[FAIL] ${label}\n  signatures should differ but both are: ${actual}`);
  }
  console.log(`[PASS] ${label}`);
};

// ─── Case 1: same args + same scope + same time bucket → same signature ───
{
  const t = 1_700_000_000_000; // arbitrary fixed timestamp
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
  const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 30_000 });
  assertEquals(sig1, sig2, 'same args + same scope + same 60s bucket → same signature');
}

// ─── Case 2: same args + same scope + different time bucket → different signature ───
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t, bucketMs: 60_000 });
  const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t + 90_000 });
  assertNotEquals(sig1, sig2, 'same args + same scope + cross 60s bucket → different signature');
}

// ─── Case 3: same args + different scope → different signature ───
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
  const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_shanghai', { nowMs: t, bucketMs: 60_000 });
  assertNotEquals(sig1, sig2, 'same args + different scope → different signature');
}

// ─── Case 4: args order independence (canonicalizeArgs should sort keys) ───
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1', region: '华东' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
  const sig2 = buildToolSignature('getOverviewData', { region: '华东', taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 60_000 });
  assertEquals(sig1, sig2, 'args key order independent → same signature');
}

// ─── Case 5: bucketMs=0 treated as falsy → falls back to global default (60s) ───
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 0 });
  const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 30_000 });
  assertEquals(sig1, sig2, 'bucketMs=0 → falls back to default 60s bucket → same signature');
}
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 0 });
  const sig2 = buildToolSignature('getOverviewData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 90_000 });
  assertNotEquals(sig1, sig2, 'bucketMs=0 → falls back to default 60s bucket → cross bucket differs');
}

// ─── Case 6: per-tool freshness bucketMs affects signature ───
{
  const t = 1_700_000_000_000;
  // daily tool: 3600s bucket, both calls use the same bucketMs
  const sig1 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 3_600_000 });
  const sig2 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 1_800_000, bucketMs: 3_600_000 });
  assertEquals(sig1, sig2, 'daily tool: same hour bucket → same signature');
}
{
  const t = 1_700_000_000_000;
  const sig1 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t, bucketMs: 3_600_000 });
  const sig2 = buildToolSignature('getTaskListData', { taskId: 'T1' }, 'fp_beijing', { nowMs: t + 3_600_001, bucketMs: 3_600_000 });
  assertNotEquals(sig1, sig2, 'daily tool: cross hour bucket → different signature');
}

console.log('\n✅ All toolCallUtils tests passed.');
