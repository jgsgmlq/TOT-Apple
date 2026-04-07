'use strict';

const { db } = require('../db');
const { evaluateAndTriggerAutoNudges } = require('../services/autoNudge');

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * 对「已下发且配置了 auto_nudge_rules」的任务各执行一轮自动预警扫描。
 */
async function runScheduledAutoNudges() {
  const rows = db.all(`
    SELECT id FROM tasks
    WHERE status = 'dispatched'
      AND auto_nudge_rules IS NOT NULL
      AND TRIM(auto_nudge_rules) != ''
      AND TRIM(auto_nudge_rules) != 'null'
  `);
  for (const row of rows) {
    try {
      const result = await evaluateAndTriggerAutoNudges(row.id);
      if (result.success && result.nudgedCount > 0) {
        console.log(`[auto-nudge scheduler] task=${row.id} nudgedCount=${result.nudgedCount}`);
      }
    } catch (err) {
      console.error(`[auto-nudge scheduler] task=${row.id}`, err.message || err);
    }
  }
}

/**
 * 每小时执行一次；可通过 AUTO_NUDGE_SCHEDULER=0 关闭。
 */
function startAutoNudgeScheduler() {
  if (process.env.AUTO_NUDGE_SCHEDULER === '0') {
    console.log('[auto-nudge scheduler] disabled (AUTO_NUDGE_SCHEDULER=0)');
    return;
  }
  const intervalMs = Number(process.env.AUTO_NUDGE_INTERVAL_MS) || ONE_HOUR_MS;
  setInterval(() => {
    runScheduledAutoNudges();
  }, intervalMs);
  console.log(`[auto-nudge scheduler] every ${intervalMs / 1000}s`);
}

module.exports = { startAutoNudgeScheduler, runScheduledAutoNudges };
