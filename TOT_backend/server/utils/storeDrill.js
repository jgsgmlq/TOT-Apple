'use strict';

/**
 * 解析门店下钻过滤（与 stores 表 AND），供 dashboard / 智能洞察等复用。
 * @param {Record<string, string>} query req.query 或 body 字段
 * @returns {{ sql: string, params: string[], hasDrill: boolean }}
 */
function parseStoreDrill(query) {
  const rtm = query.rtm;
  const format = query.format;
  const dealerName = query.dealerName;
  const storeId = query.storeId;
  const conds = [];
  const params = [];
  if (rtm) {
    conds.push('LOWER(TRIM(s.rtm)) = LOWER(TRIM(?))');
    params.push(String(rtm));
  }
  if (format) {
    conds.push('(s.format IS NOT NULL AND LOWER(TRIM(s.format)) = LOWER(TRIM(?)))');
    params.push(String(format));
  }
  if (dealerName) {
    conds.push('(s.dealer_name IS NOT NULL AND LOWER(TRIM(s.dealer_name)) = LOWER(TRIM(?)))');
    params.push(String(dealerName));
  }
  if (storeId) {
    conds.push('s.id = ?');
    params.push(String(storeId));
  }
  const hasDrill = conds.length > 0;
  return {
    sql: hasDrill ? `AND ${conds.join(' AND ')}` : '',
    params,
    hasDrill,
  };
}

module.exports = { parseStoreDrill };
