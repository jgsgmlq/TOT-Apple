'use strict';

/**
 * 时间与 SQLite 文本字段约定（全项目统一）：
 *
 * - 存储与 API 展示的 `YYYY-MM-DD HH:MM:SS` 均为 **进程本地时区墙钟**（依赖运行环境 `TZ`，生产建议 `TZ=Asia/Shanghai`）。
 * - 勿再用 `Date.prototype.toISOString()` 写入业务时间（其为 UTC）；请用 `formatNowSqliteLocal()` / `parseDateToSqliteLocal()`。
 * - SQLite 内比较请用 `datetime('now', 'localtime')`，与上述字符串一致。
 */

const { createError } = require('../middleware/errorHandler');

const pad = (n) => String(n).padStart(2, '0');

/**
 * 将任意可被 `Date` 解析的值规范为本地墙钟 `YYYY-MM-DD HH:MM:SS`（用于落库、返回）。
 * @param {string|number|Date} value
 * @returns {string}
 */
function parseDateToSqliteLocal(value) {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) {
    throw createError(400, '时间字段无法解析为有效时间', 'TASK_005');
  }
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

/**
 * 当前时刻的本地墙钟时间串（替代 `new Date().toISOString()` 用于 SQLite TEXT / JSON 业务时间）。
 * @param {Date} [d]
 * @returns {string}
 */
function formatNowSqliteLocal(d = new Date()) {
  return parseDateToSqliteLocal(d);
}

/**
 * 本地日历日期的 YYYY-MM-DD（用于默认「当天」等查询条件）。
 * @param {Date} [d]
 * @returns {string}
 */
function formatLocalDateYYYYMMDD(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @deprecated 历史命名；行为与 {@link parseDateToSqliteLocal} 相同（均为本地墙钟，非 UTC）。 */
const parseDateToSqliteUtc = parseDateToSqliteLocal;
const parseDdlAtToSqliteUtc = parseDateToSqliteLocal;

module.exports = {
  parseDateToSqliteLocal,
  formatNowSqliteLocal,
  formatLocalDateYYYYMMDD,
  parseDateToSqliteUtc,
  parseDdlAtToSqliteUtc,
};
