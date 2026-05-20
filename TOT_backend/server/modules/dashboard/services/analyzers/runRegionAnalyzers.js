'use strict';

const { runFunnelAnalyzer } = require('./funnelAnalyzer');
const { runWarningAnalyzer } = require('./warningAnalyzer');
const { runTrendAnalyzer } = require('./trendAnalyzer');
const { runRtmAnalyzer } = require('./rtmAnalyzer');
const logger = require('../../../common/utils/logger');

/**
 * 极简并发限流器：保证同时在飞的 Promise ≤ limit。
 * @template T
 * @param {() => Promise<T>} fn
 */
function makeLimiter(limit) {
  let active = 0;
  const queue = [];
  const schedule = () => {
    if (active >= limit) return;
    const next = queue.shift();
    if (!next) return;
    active++;
    next.fn().then(
      (val) => {
        active--;
        next.resolve(val);
        schedule();
      },
      (err) => {
        active--;
        next.reject(err);
        schedule();
      }
    );
  };
  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      schedule();
    });
  };
}

const ANALYZERS = [
  ['funnel', runFunnelAnalyzer],
  ['warning', runWarningAnalyzer],
  ['trend', runTrendAnalyzer],
  ['rtm', runRtmAnalyzer],
];

/**
 * 对若干活跃任务并行执行 4 个子 Agent。全局并发上限默认 6。
 * 返回 { [taskId]: { funnel, warning, trend, rtm } }。
 *
 * @param {Array<{ taskId: string, title: string, ddl_at: string }>} tasks
 * @param {{ concurrency?: number }} [opts]
 */
async function runRegionAnalyzers(tasks, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 6);
  const limit = makeLimiter(concurrency);
  const t0 = Date.now();

  const jobs = [];
  for (const task of tasks) {
    for (const [region, fn] of ANALYZERS) {
      jobs.push(
        limit(() =>
          fn(task)
            .then((result) => ({ status: 'ok', region, taskId: task.taskId, result }))
            .catch((err) => {
              logger.error(`[SubAgent ${region}] crashed: ${err.message}`, { taskId: task.taskId });
              return {
                status: 'err',
                region,
                taskId: task.taskId,
                result: {
                  region,
                  taskId: task.taskId,
                  severity: 'green',
                  summary: `子 Agent 异常，已降级（${err.message}）`,
                  keyFindings: {},
                  focusHint: null,
                  degraded: true,
                  degradedReason: err.message,
                },
              };
            })
        )
      );
    }
  }

  const settled = await Promise.all(jobs);
  const out = {};
  for (const t of tasks) out[t.taskId] = {};
  for (const item of settled) {
    out[item.taskId][item.region] = item.result;
  }

  logger.info(
    `[DashboardAgent] runRegionAnalyzers tasks=${tasks.length} jobs=${jobs.length} elapsedMs=${Date.now() - t0}`
  );
  return out;
}

module.exports = { runRegionAnalyzers };
