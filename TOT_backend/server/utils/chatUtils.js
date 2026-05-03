'use strict';

const { db } = require('../db');

/**
 * Builds a SQL fragment + params array for region-scoped queries.
 * @param {object} regionScope  { type: 'national'|'regional'|'rtm', regions: string[]|null, rtm: string|null }
 * @returns {{ sql: string, params: any[] }}
 */
function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') {
    return { sql: '', params: [] };
  }
  if (regionScope.type === 'regional') {
    if (!regionScope.regions || regionScope.regions.length === 0) {
      // 阻断：返回永假条件，防止空 regions 意外暴露全局数据
      return { sql: 'AND 1=0', params: [] };
    }
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm') {
    return { sql: 'AND s.rtm = ?', params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

/**
 * Resolves a storeName string to stores.id using LIKE matching.
 * Returns the matched storeId or null if ambiguous/not found.
 * @param {string} storeName
 * @returns {string|null}
 */
function resolveStoreId(storeName) {
  if (!storeName) return null;
  const rows = db.all(
    'SELECT id FROM stores WHERE name LIKE ?',
    [`%${storeName}%`]
  );
  if (rows.length === 1) return rows[0].id;
  return null; // ambiguous or not found
}

module.exports = {
  buildRegionFilter,
  resolveStoreId
};