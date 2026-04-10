'use strict';

const { createError } = require('../middleware/errorHandler');

/**
 * 将任意可被 Date 解析的时间串转为与 SQLite datetime('now') 一致的 UTC 文本：
 * YYYY-MM-DD HH:MM:SS
 * @param {string|number|Date} value
 * @returns {string}
 */
function parseDateToSqliteUtc(value) {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) {
    throw createError(400, '时间字段无法解析为有效时间', 'TASK_005');
  }
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

module.exports = { parseDdlAtToSqliteUtc: parseDateToSqliteUtc, parseDateToSqliteUtc };
