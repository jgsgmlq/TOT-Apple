'use strict';

const mysqlCrud = require('../crud/dashboardMysqlCrud');
const { fetchTaskContext, classifyStatus, completionTimeHours, resolveDrillFilter } = require('./queryEngine');
const { createError } = require('../../common/middleware/errorHandler');

const DIMENSION_MAP = {
  all: null,
  channel_l3: 'sub_region_code',
  channel_l4: 'rtm4_name',
  dealer: 'reseller_name',
  store: 'store_apple_id',
};

async function resolveTaskId(taskName, productName) {
  const searchFor = String(taskName || productName || '').toLowerCase().trim();
  if (!searchFor) return null;
  const tasks = await mysqlCrud.searchTasks(searchFor);
  return tasks.length > 0 ? tasks[0].task_publish_id : null;
}

function filterByRegionScope(queues, regionScope) {
  if (!regionScope || regionScope.type === 'national') return queues;
  if (regionScope.type === 'regional') {
    if (!regionScope.regions || regionScope.regions.length === 0) return [];
    const allowed = new Set(regionScope.regions);
    return queues.filter(q => allowed.has(q.sub_region_code));
  }
  if (regionScope.type === 'rtm' && regionScope.rtm) {
    return queues.filter(q => q.rtm4_name === regionScope.rtm);
  }
  return queues;
}

async function query(params = {}, regionScope = null) {
  const taskId = await resolveTaskId(params.taskName, params.productName);
  if (!taskId) {
    return { error: 'INVALID_PARAMETERS', message: '请明确您要查询的培训任务名称或产品名称。' };
  }

  if (!Array.isArray(params.metrics) || params.metrics.length === 0) {
    return { error: 'INVALID_PARAMETERS', message: '请指定至少一个度量指标（如"完成率"）。' };
  }

  const dimensions = Array.isArray(params.dimensions) && params.dimensions.length > 0 ? params.dimensions : ['all'];
  const metrics = params.metrics;

  const drill = resolveDrillFilter(params.filters || {});
  const ctx = await fetchTaskContext(taskId, drill);
  let { task, queues, mpsRows, confirmedSet, reminderMap } = ctx;

  if (!task) {
    return { error: 'NOT_FOUND', message: '任务不存在' };
  }

  queues = filterByRegionScope(queues, regionScope);

  const dimProp = DIMENSION_MAP[dimensions[0]] || null;
  const grouped = new Map();

  if (!dimProp) {
    grouped.set('Total', queues);
  } else {
    for (const q of queues) {
      const key = q[dimProp] || '未知';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(q);
    }
  }

  const needsDetails = metrics.some(m => m.includes('rate') || m.includes('count') || m.includes('warning'));
  const formattedRows = [];

  for (const [dimKey, groupQueues] of grouped.entries()) {
    const row = {
      dimensions: dimensions.reduce((acc, d, i) => {
        acc[d] = i === 0 && dimProp ? dimKey : 'Total';
        return acc;
      }, {})
    };

    const total = groupQueues.length;
    row._total = total;

    let inProgress = 0;
    let completed = 0;
    let notStarted = 0;
    let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
    let sumCompletionHours = 0;
    let validCompletionTimes = 0;

    for (const q of groupQueues) {
      const status = classifyStatus(q.email_id, mpsRows);
      if (status === 'completed') completed++;
      else if (status === 'pending') notStarted++;
      else inProgress++;

      if (needsDetails) {
        const level = reminderMap.get(q.email_id) || 'new';
        if (level === 'P0') p0++;
        else if (level === 'P1') p1++;
        else if (level === 'P2') p2++;
        else if (level === 'P3') p3++;
      }

      if (metrics.includes('avg_completion_time_hours')) {
         if (status === 'completed') {
           const hrs = completionTimeHours(task, mpsRows, q.email_id);
           if (hrs !== null) {
             sumCompletionHours += hrs;
             validCompletionTimes++;
           }
         }
      }
    }

    if (metrics.includes('completion_rate')) {
      row.completion_rate = total > 0 ? parseFloat(((completed / total) * 100).toFixed(2)) : 0;
    }
    if (metrics.includes('completed_count')) {
      row.completed_count = completed;
    }
    if (metrics.includes('total_count')) {
      row.total_count = total;
    }
    if (metrics.includes('avg_completion_time_hours')) {
      row.avg_completion_time_hours = validCompletionTimes > 0 ? parseFloat((sumCompletionHours / validCompletionTimes).toFixed(2)) : null;
    }

    if (needsDetails) {
      row.crisis_p0_rate = total > 0 ? parseFloat(((p0 / total) * 100).toFixed(2)) : 0;
      row.crisis_p1_rate = total > 0 ? parseFloat(((p1 / total) * 100).toFixed(2)) : 0;
      row.crisis_p2_rate = total > 0 ? parseFloat(((p2 / total) * 100).toFixed(2)) : 0;
      row.crisis_p3_rate = total > 0 ? parseFloat(((p3 / total) * 100).toFixed(2)) : 0;

      if (metrics.includes('crisis_p0_count')) row.crisis_p0_count = p0;
      if (metrics.includes('crisis_p1_count')) row.crisis_p1_count = p1;
      if (metrics.includes('crisis_p2_count')) row.crisis_p2_count = p2;
      if (metrics.includes('crisis_p3_count')) row.crisis_p3_count = p3;

      if (metrics.includes('read_rate')) {
        const participated = inProgress + completed;
        row.read_rate = total > 0 ? parseFloat(((participated / total) * 100).toFixed(2)) : 0;
      }
    }

    formattedRows.push(row);
  }

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