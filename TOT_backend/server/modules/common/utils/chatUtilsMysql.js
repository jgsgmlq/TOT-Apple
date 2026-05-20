'use strict';

/**
 * Builds a SQL fragment + params array for region-scoped queries.
 * Target is MySQL `reseller_store` table, aliased as `rs`.
 * @param {object} regionScope  { type: 'national'|'regional'|'rtm', regions: string[]|null, rtm: string|null }
 * @returns {{ sql: string, params: any[] }}
 */
function buildRegionFilterMysql(regionScope) {
  if (!regionScope || regionScope.type === 'national') {
    return { sql: '', params: [] };
  }
  if (regionScope.type === 'regional') {
    if (!regionScope.regions || regionScope.regions.length === 0) {
      // 阻断：返回永假条件
      return { sql: 'AND 1=0', params: [] };
    }
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND rs.sub_region_code IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm') {
    return { sql: 'AND rs.rtm4_name = ?', params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

module.exports = {
  buildRegionFilterMysql
};