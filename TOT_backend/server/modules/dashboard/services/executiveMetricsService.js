'use strict';

const { getDb } = require('../../common/db/connection');
const logger = require('../../common/utils/logger');
const { parseStoreDrill } = require('../../common/utils/storeDrill');
const { parseAutoNudgeRules, classifyDeadlineCrisisBand } = require('../../../services/autoNudgeRules');
const { computeAssignmentWarningRates } = require('../../common/utils/dashboardWarningRates');

const db = {
  get(sql, params = []) { return getDb().prepare(sql).get(...params) ?? null; },
  all(sql, params = []) { return getDb().prepare(sql).all(...params); },
};

/**
 * Executive Metrics 统一查询服务 (v3.0)
 */

const DIMENSION_MAP = {
  all: null,
  channel_l3: 's.region',
  channel_l4: 's.format',
  dealer: 's.dealer_name',
  store: 's.id',
};

const METRIC_SELECTS = {
  completion_rate: `ROUND(100.0 * SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END) / COUNT(ta.id), 2)`,
  completed_count: `SUM(CASE WHEN ta.status='completed' THEN 1 ELSE 0 END)`,
  total_count: `COUNT(ta.id)`,
  avg_completion_time_hours: `AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END)`,
};

function resolveTaskId(taskName, productName) {
  const tasks = db.all('SELECT id, title, mypal_product_name FROM tasks ORDER BY created_at DESC');
  
  const searchFor = String(taskName || productName || '').toLowerCase().trim();
  if (!searchFor) return null;

  // 1. Exact or simple substring match first
  for (const t of tasks) {
    const tTitle = t.title.toLowerCase();
    if (tTitle.includes(searchFor) || searchFor.includes(tTitle)) {
      return t.id;
    }
  }

  // 2. Common aliases / AI hallucinations mapping
  const aliases = [
    { keys: ['phone', 'iphone', '17'], id: 'TASK_A' }, // iPhone 17 新品培训
    { keys: ['pod', 'airpods'], id: 'TASK_B' }, // AirPods 新品培训
    { keys: ['mac', 'macbook'], id: 'TASK_WARN_START' }, // MacBook 销售技巧起步异常
    { keys: ['watch', 'apple watch'], id: 'TASK_WARN_P0' }, // Apple Watch P0临期预警
    { keys: ['pad', 'ipad'], id: 'TASK_WARN_P1' }, // iPad Pro P1临期预警
    { keys: ['mono', '新春'], id: 'TASK_C' } // Mono 新春系列产品学习
  ];

  for (const alias of aliases) {
    for (const key of alias.keys) {
      if (searchFor.includes(key)) {
        return alias.id;
      }
    }
  }

  // 3. Token overlap match (e.g. "Phone新品销售技巧" and "iPhone 17 新品培训" share "新品")
  const searchTokens = searchFor.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  if (searchTokens.length > 0) {
    let bestMatch = null;
    let maxOverlap = 0;
    
    for (const t of tasks) {
      const tTitle = t.title.toLowerCase();
      let overlap = 0;
      for (const token of searchTokens) {
        if (token.length > 1 && tTitle.includes(token)) {
          overlap++;
        }
      }
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestMatch = t.id;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

function buildRegionFilter(regionScope) {
  if (!regionScope || regionScope.type === 'national') return { sql: '', params: [] };
  if (regionScope.type === 'regional' && Array.isArray(regionScope.regions)) {
    const placeholders = regionScope.regions.map(() => '?').join(',');
    return { sql: `AND s.region IN (${placeholders})`, params: regionScope.regions };
  }
  if (regionScope.type === 'rtm' && regionScope.rtm) {
    return { sql: `AND s.rtm = ?`, params: [regionScope.rtm] };
  }
  return { sql: '', params: [] };
}

/**
 * 执行矩阵查询
 */
async function query(params = {}, regionScope = null) {
  // P0: 强制任务定位
  const taskId = resolveTaskId(params.taskName, params.productName);
  if (!taskId) {
    return { error: 'INVALID_PARAMETERS', message: '请明确您要查询的培训任务名称或产品名称。' };
  }

  // 高优先级修复：metrics 必填且非空
  if (!Array.isArray(params.metrics) || params.metrics.length === 0) {
    return { error: 'INVALID_PARAMETERS', message: '请指定至少一个度量指标（如“完成率”）。' };
  }

  const dimensions = Array.isArray(params.dimensions) && params.dimensions.length > 0 ? params.dimensions : ['all'];
  const metrics = params.metrics;
  
  const drill = parseStoreDrill(params.filters || {});
  const scope = buildRegionFilter(regionScope);
  const whereSql = `WHERE ta.task_id = ? ${drill.sql} ${scope.sql}`;
  const whereParams = [taskId, ...drill.params, ...scope.params];

  const groupByCols = dimensions.map(d => DIMENSION_MAP[d]).filter(Boolean);
  const selectDimSql = groupByCols.length > 0 
    ? groupByCols.map((col, i) => `${col} AS dim_${i}`).join(', ') + ','
    : "'Total' AS dim_0,";
  const groupBySql = groupByCols.length > 0 ? `GROUP BY ${groupByCols.join(', ')}` : '';

  const selectMetricSql = metrics
    .filter(m => METRIC_SELECTS[m])
    .map(m => `${METRIC_SELECTS[m]} AS ${m}`)
    .concat(['COUNT(ta.id) AS _total'])
    .join(', ');

  const sql = `
    SELECT ${selectDimSql} ${selectMetricSql}
    FROM task_assignments ta
    JOIN stores s ON s.id = ta.store_id
    JOIN tasks t ON t.id = ta.task_id
    ${whereSql}
    ${groupBySql}
  `;

  const rows = db.all(sql, whereParams);
  const nowMs = Date.now();

  // ─── 性能优化：一次性拉取明细，避免 N+1 ───
  let allDetails = [];
  let readUserSet = new Set();

  const needsDetails = metrics.some(m => m.includes('rate') || m.includes('count') || m.includes('warning'));
  if (needsDetails) {
    // 1. 一次性获取所有相关的 assignments
    allDetails = db.all(
      `SELECT ta.id, ta.user_id, ta.status, ta.progress, t.created_at, t.ddl_at, t.auto_nudge_rules, ${groupByCols.length > 0 ? groupByCols.join(', ') : "'Total'"} AS _group_key
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       ${whereSql}`,
      whereParams
    );

    // 2. 如果需要读取率，一次性拉取所有已读用户 ID
    if (metrics.includes('read_rate')) {
      const readRows = db.all(
        `SELECT DISTINCT rr.user_id
         FROM read_receipts rr
         JOIN notification_events ne ON ne.id = rr.event_id
         JOIN stores s ON s.id = ne.store_id
         WHERE ne.task_id = ? AND rr.source = 'task_detail_open' ${drill.sql} ${scope.sql}`,
        [taskId, ...drill.params, ...scope.params]
      );
      readUserSet = new Set(readRows.map(r => r.user_id));
    }
  }

  // 内存内进行分组聚合计算
  const formattedRows = rows.map(row => {
    const groupVal = groupByCols.length > 0 ? row.dim_0 : 'Total'; // 简化：目前仅支持主维度聚合
    const result = {
      dimensions: dimensions.reduce((acc, d, i) => {
        acc[d] = row[`dim_${i}`] || 'Total';
        return acc;
      }, {}),
    };

    metrics.forEach(m => {
      if (row[m] !== undefined) result[m] = row[m];
    });

    if (needsDetails) {
      // 从内存中过滤出属于该分组的明细
      const groupKeyCol = groupByCols.length > 0 ? groupByCols[0].split('.').pop() : '_group_key';
      const myDetails = allDetails.filter(d => {
         // 这里的过滤逻辑根据维度动态匹配
         if (groupByCols.length === 0) return true;
         const val = row.dim_0;
         // 针对不同维度的简单匹配
         return String(d[groupByCols[0].replace('s.', '')] || d['_group_key']) === String(val);
      });

      const rates = computeAssignmentWarningRates(myDetails, row._total, nowMs);
      
      // 统一指标映射
      result.crisis_p0_rate = rates.crisisP0Rate;
      result.crisis_p1_rate = rates.crisisP1Rate;
      result.start_delay_rate = rates.startDelayRate;
      if (metrics.includes('crisis_p0_count')) result.crisis_p0_count = Math.round((rates.crisisP0Rate * row._total) / 100);
      if (metrics.includes('crisis_p1_count')) result.crisis_p1_count = Math.round((rates.crisisP1Rate * row._total) / 100);

      if (metrics.includes('read_rate')) {
        const readInGroup = myDetails.filter(d => readUserSet.has(d.user_id)).length;
        result.read_rate = row._total > 0 ? parseFloat(((100 * readInGroup) / row._total).toFixed(2)) : 0;
      }
    }

    return result;
  });

  // 排序
  const finalSort = params.sort && params.sort.sortBy ? params.sort : { sortBy: metrics[0], order: 'desc' };
  formattedRows.sort((a, b) => {
    const valA = a[finalSort.sortBy] ?? 0;
    const valB = b[finalSort.sortBy] ?? 0;
    return finalSort.order === 'desc' ? valB - valA : valA - valB;
  });

  return {
    taskId,
    dimensions,
    metrics,
    rows: formattedRows,
    summary: { totalRows: formattedRows.length, timestamp: new Date().toISOString() },
    appliedParams: { ...params, sort: finalSort }
  };
}

module.exports = { query };
