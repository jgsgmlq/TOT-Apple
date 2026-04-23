'use strict';

/**
 * Test script for Executive Chat v3.0: Unified Matrix Tool (Final Assertion Fix)
 */

const executiveMetricsQueryService = require('./services/executiveMetricsQueryService');
const { db } = require('./db');

async function test() {
  console.log("=== Executive Chat v3.0: Unified Matrix Tool (Strict Verification) ===\n");

  // 动态寻找一个真实的任务名，确保测试用例能真正“通过”
  const realTask = db.get("SELECT title FROM tasks LIMIT 1");
  const taskName = realTask ? realTask.title : "新款";

  const testCases = [
    {
      name: "Valid Query: National Completion Rate by Region",
      params: {
        dimensions: ["channel_l3"],
        metrics: ["completion_rate", "read_rate", "crisis_p0_rate"],
        taskName: taskName
      },
      scope: { type: 'national' },
      expectedStatus: "SUCCESS"
    },
    {
      name: "Invalid Query: Missing Task/Product",
      params: {
        dimensions: ["channel_l3"],
        metrics: ["completion_rate"]
      },
      scope: { type: 'national' },
      expectedStatus: "ERROR_INVALID_PARAMETERS"
    },
    {
      name: "Valid Query: Multi-metric with Sorting",
      params: {
        dimensions: ["channel_l4"],
        metrics: ["completion_rate", "crisis_p1_count"],
        taskName: taskName,
        sort: { sortBy: "crisis_p1_count", order: "desc" }
      },
      scope: { type: 'national' },
      expectedStatus: "SUCCESS"
    }
  ];

  let failedCount = 0;

  for (const tc of testCases) {
    console.log(`[Test Case] ${tc.name}`);
    try {
      const result = await executiveMetricsQueryService.query(tc.params, tc.scope);
      
      let actualStatus = "SUCCESS";
      if (result.error === 'INVALID_PARAMETERS') {
        actualStatus = "ERROR_INVALID_PARAMETERS";
      } else if (result.error) {
        actualStatus = `ERROR_${result.error}`;
      }

      // 严格断言
      if (actualStatus === tc.expectedStatus) {
        console.log(`[Result] PASS: Got ${actualStatus}`);
        if (actualStatus === "SUCCESS") {
          console.log(`  - Rows: ${result.rows.length}, TaskID: ${result.taskId}`);
          if (result.rows.length === 0) {
            console.warn("  - WARNING: Result is empty (but query was successful)");
          } else {
            console.log(`  - Sample Row: ${JSON.stringify(result.rows[0])}`);
          }
        } else {
          console.log(`  - Message: ${result.message}`);
        }
      } else {
        console.error(`[Result] FAIL: Expected ${tc.expectedStatus}, but got ${actualStatus}`);
        if (result.message) console.error(`  - Error Detail: ${result.message}`);
        failedCount++;
      }
    } catch (err) {
      console.error(`[Result] CRASH: ${err.message}`);
      failedCount++;
    }
    console.log("-" .repeat(60));
  }

  if (failedCount === 0) {
    console.log("\n✅ ALL TESTS PASSED STRICTLY.");
  } else {
    console.error(`\n❌ ${failedCount} TEST(S) FAILED.`);
    process.exit(1);
  }
}

test().catch(console.error);
