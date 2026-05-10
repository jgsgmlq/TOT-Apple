'use strict';

/**
 * @typedef {Object} RegionResult
 * @property {'funnel'|'warning'|'trend'|'rtm'} region
 * @property {string} taskId
 * @property {'red'|'orange'|'green'} severity
 * @property {string} summary
 * @property {Record<string, number|string>} keyFindings
 * @property {string|null} focusHint
 * @property {boolean} [degraded] true 表示该区域走了模板降级
 * @property {string} [degradedReason]
 */

/**
 * focusHint / focusModule 允许值：
 * - 粗粒度板块：兼容旧值
 * - 细粒度下钻：命中具体卡片/指标位点
 * - none：无需跳转
 */
const ALLOWED_FOCUS = new Set([
  'none',
  // coarse
  'north_star',
  'warning_details',
  'rtm_timezone',
  'crisis_p0',
  'funnel_read_rate',
  'nudge_conversion',
  'metrics_overdue',
  // fine-grained drill targets
  'on_time_completion_rate',
  'avg_completion_time',
  'task_reach_rate',
  'task_read_rate',
  'warning_count_total',
  'warning_p2_rate',
  'warning_p1_rate',
  'warning_p0_rate',
  'warning_p2_stores',
  'warning_p1_stores',
  'warning_p0_stores',
  'nudge_red_conversion',
  'nudge_orange_conversion',
  'nudge_yellow_conversion',
  'nudge_total_conversion',
  'overdue_count',
  'deadline_risk',
  'trend_daily_drop',
  'trend_silent_days',
  'rtm_completion_gap',
  'rtm_worst_bucket',
  'store_worst_bucket',
]);

const ALLOWED_SEVERITY = new Set(['red', 'orange', 'green']);

/**
 * 从 LLM 文本中宽容提取 JSON 对象。
 */
function extractJsonSafely(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    /* try fenced block */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (_) {
      /* fall through */
    }
  }
  // 尝试取首个 { 到最后一个 } 之间
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch (_) {
      /* swallow */
    }
  }
  return null;
}

/**
 * 把 LLM 返回的对象规范化为 RegionResult。
 * @param {any} parsed
 * @param {{ region: string, taskId: string, fallbackKeyFindings?: Record<string, any> }} ctx
 * @returns {RegionResult}
 */
function mergeRegionResult(parsed, ctx) {
  const severity = ALLOWED_SEVERITY.has(parsed?.severity) ? parsed.severity : 'green';
  const focusHint = ALLOWED_FOCUS.has(parsed?.focusHint) ? parsed.focusHint : null;
  const summary =
    typeof parsed?.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 160)
      : '（子 Agent 未给出 summary）';
  let keyFindings =
    parsed && typeof parsed.keyFindings === 'object' && parsed.keyFindings
      ? parsed.keyFindings
      : ctx.fallbackKeyFindings || {};
  // 限制 keyFindings 数量（≤6）
  const entries = Object.entries(keyFindings).slice(0, 6);
  keyFindings = Object.fromEntries(entries);

  return {
    region: ctx.region,
    taskId: ctx.taskId,
    severity,
    summary,
    keyFindings,
    focusHint,
  };
}

/**
 * 顶层兜底（极少使用，目前各 analyzer 自身已有更具体的降级）。
 */
function fallbackOutput(region, taskId, reason) {
  return {
    region,
    taskId,
    severity: 'green',
    summary: `子 Agent 未返回有效结果（${reason}），按通用模板兜底。`,
    keyFindings: {},
    focusHint: null,
    degraded: true,
    degradedReason: reason,
  };
}

module.exports = {
  ALLOWED_FOCUS,
  ALLOWED_SEVERITY,
  extractJsonSafely,
  mergeRegionResult,
  fallbackOutput,
};
