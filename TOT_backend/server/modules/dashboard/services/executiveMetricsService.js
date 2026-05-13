'use strict';

const crud = require('../crud/dashboardCrud');
const { parseStoreDrill } = require('../../common/utils/storeDrill');
const { computeAssignmentWarningRates } = require('../../common/utils/dashboardWarningRates');

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
  const searchFor = String(taskName || productName || '').toLowerCase().trim();
  if (!searchFor) return null;
  const tasks = crud.findTasksByName(searchFor);
  return tasks.length > 0 ? tasks[0].id : null;
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

async function query(params = {}, regionScope = null) {
  const taskId = resolveTaskId(params.taskName, params.productName);
  if (!taskId) {
    return { error: 'INVALID_PARAMETERS', message: '请明确您要查询的培训任务名称或产品名称。' };
  }

  if (!Array.isArray(params.metrics) || params.metrics.length === 0) {
    return { error: 'INVALID_PARAMETERS', message: '请指定至少一个度量指标（如"完成率"）。' };
  }

  const dimensions = Array.isArray(params.dimensions) && params.dimensions.length > 0 ? params.dimensions : ['all'];
  const metrics = params.metrics;

  const drill = parseStoreDrill(params.filters || {});
  const scope = buildRegionFilter(regionScope);
  const extraWhere = [drill.sql, scope.sql].filter(Boolean).join(' ');

  const groupByCols = dimensions.map(d => DIMENSION_MAP[d]).filter(Boolean);
  const selectDimSql = groupByCols.length > 0
    ? groupByCols.map((col, i) => `${col} AS dim_${i}`).join(', ') + ','
    : '';
  const groupBySql = groupByCols.length > 0 ? groupByCols.join(', ') : '';

  const selectMetricSql = metrics
    .filter(m => METRIC_SELECTS[m])
    .map(m => `${METRIC_SELECTS[m]} AS ${m}`)
    .concat(['COUNT(ta.id) AS _total'])
    .join(', ');

  const rows = crud.queryAssignmentGroupedAgg({
    taskId,
    drill: { hasDrill: false },
    selectDim: (selectDimSql + ' ' + selectMetricSql).trim(),
    groupByDim: groupBySql || '1',
    extraWhere: extraWhere ? ' ' + extraWhere.trim().replace(/^AND\s+/, 'AND ') : '',
  });

  const nowMs = Date.now();
  let allDetails = [];
  let readUserSet = new Set();

  const needsDetails = metrics.some(m => m.includes('rate') || m.includes('count') || m.includes('warning'));
  if (needsDetails) {
    allDetails = crud.queryAssignmentDetails({
      taskId,
      drill: { hasDrill: false },
      extraWhere: extraWhere ? ' ' + extraWhere.trim().replace(/^AND\s+/, 'AND ') : '',
    });

    if (metrics.includes('read_rate')) {
      if (drill.hasDrill && scope.sql) {
        // combine filters for read users
        readUserSet = crud.countReadUsersBySourceSet({
          taskId,
          drill: { hasDrill: true, sql: drill.sql, params: drill.params },
          source: 'task_detail_open',
        });
      } else if (drill.hasDrill) {
        readUserSet = crud.countReadUsersBySourceSet({
          taskId, drill, source: 'task_detail_open',
        });
      } else {
        readUserSet = crud.countReadUsersBySourceSet({
          taskId, drill: null, source: 'task_detail_open',
        });
      }
    }
  }

  const formattedRows = rows.map(row => {
    const result = {
      dimensions: dimensions.reduce((acc, d, i) => {
        acc[d] = groupByCols.length > 0 ? (row[`dim_${i}`] || 'Total') : 'Total';
        return acc;
      }, {}),
    };

    metrics.forEach(m => {
      if (row[m] !== undefined) result[m] = row[m];
    });

    if (needsDetails) {
      const myDetails = groupByCols.length === 0 ? allDetails
        : allDetails.filter(d => {
            const val = row.dim_0;
            const col = groupByCols[0].replace('s.', '');
            return String(d[col]) === String(val);
          });

      const rates = computeAssignmentWarningRates(myDetails, row._total, nowMs);
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
    appliedParams: { ...params, sort: finalSort },
  };
}

module.exports = { query };
