'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getOverviewData',
      description: '【总览专用】查询培训任务整体完成率、进度统计、预警率等汇总数据。当用户问"整体概况""总完成率怎么样"时使用。不适用于单门店或区域下钻。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则汇总所有已下发任务' },
          region: { type: 'string', description: '大区名称过滤，如"华东"' }
        }
      }
    }
  },
  meta: { enabled: true, scopePolicy: 'regional_scoped' },
  handler: async (args, regionScope) => {
    const taskId = args.taskId || null;
    const filter = buildRegionFilter(regionScope);
    const taConditions = ["t.status = 'dispatched'"];
    const params = [];
    if (taskId) {
      taConditions.push('ta.task_id = ?');
      params.push(taskId);
    }
    const joinStore = filter.sql ? 'JOIN stores s ON s.id = ta.store_id' : '';
    const whereClause = taConditions.join(' AND ') + (filter.sql ? ' ' + filter.sql : '');
    const allParams = [...params, ...filter.params];

    const row = db.get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress, SUM(CASE WHEN ta.status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN ta.status = 'completed' AND ta.completed_at <= t.ddl_at THEN 1 ELSE 0 END) AS on_time, AVG(CASE WHEN ta.status = 'completed' AND ta.completed_at IS NOT NULL AND t.created_at IS NOT NULL THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24 END) AS avg_hours, MAX(ta.updated_at) AS last_updated FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id ${joinStore} WHERE ${whereClause}`,
      allParams
    );

    const total = row ? (row.total ?? 0) : 0;
    return {
      totalAssignments: total,
      completedCount: row ? (row.completed ?? 0) : 0,
      inProgressCount: row ? (row.in_progress ?? 0) : 0,
      pendingCount: row ? (row.pending ?? 0) : 0,
      completionRate: total > 0 ? parseFloat(((row.completed / total) * 100).toFixed(1)) : 0,
      onTimeCompletionRate: total > 0 ? parseFloat(((row.on_time / total) * 100).toFixed(1)) : 0,
      avgCompletionTimeHours: row && row.avg_hours ? parseFloat(row.avg_hours.toFixed(1)) : null,
      updatedAt: row ? row.last_updated : null,
    };
  }
};
