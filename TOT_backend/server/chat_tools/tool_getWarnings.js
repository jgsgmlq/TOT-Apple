'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

const WARNING_COMPLETION_THRESHOLD = 0.8;

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getWarningsData',
      description: '查询存在风险（进度最慢、完成率低或临近截止）的门店列表，即预警数据。注：本工具只能查最差的门店，不能查进度最快的门店。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则扫描所有任务' }
        }
      }
    }
  },
  meta: { 
    enabled: false,
    requiredRole: ['executive'],
    scopePolicy: 'any',
    timeoutMs: 8000
  },
  handler: (args, regionScope) => {
    const taskId = args.taskId || null;
    const filter = buildRegionFilter(regionScope);
    const taskFilter = taskId ? 'AND ta.task_id = ?' : "AND t.status = 'dispatched'";
    const taskParams = taskId ? [taskId] : [];

    const warningRows = db.all(
      `SELECT ta.task_id, t.title AS task_name, s.id AS store_id, s.name AS store_name, s.region, t.ddl_at, COUNT(*) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed FROM task_assignments ta JOIN stores s ON s.id = ta.store_id JOIN tasks t ON t.id = ta.task_id WHERE 1=1 ${taskFilter} ${filter.sql} GROUP BY ta.task_id, ta.store_id HAVING CAST(completed AS FLOAT) / total < ${WARNING_COMPLETION_THRESHOLD} ORDER BY CAST(completed AS FLOAT) / total ASC LIMIT 20`,
      [...taskParams, ...filter.params]
    );

    if (warningRows.length) {
      return warningRows.map((r) => ({
        taskId: r.task_id,
        taskName: r.task_name,
        storeId: r.store_id,
        storeName: r.store_name,
        region: r.region,
        ddlAt: r.ddl_at,
        totalCount: r.total,
        completedCount: r.completed,
        completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
        dataSource: 'warning',
        caliberNote: `基于低完成率门店聚合（completionRate < ${WARNING_COMPLETION_THRESHOLD * 100}%）。`,
      }));
    }

    const rankRows = db.all(
      `SELECT ta.task_id, t.title AS task_name, s.id AS store_id, s.name AS store_name, s.region, COUNT(*) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE 1=1 ${taskFilter} ${filter.sql}
       GROUP BY ta.task_id, ta.store_id
       ORDER BY CAST(completed AS FLOAT) / total ASC
       LIMIT 10`,
      [...taskParams, ...filter.params]
    );

    if (rankRows.length) {
      return rankRows.map((r) => ({
        taskId: r.task_id,
        taskName: r.task_name,
        storeId: r.store_id,
        storeName: r.store_name,
        region: r.region,
        totalCount: r.total,
        completedCount: r.completed,
        completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
        dataSource: 'store_rank_fallback',
        caliberNote: '预警明细不足，已降级为低完成率门店排行。',
      }));
    }

    const overview = db.get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE 1=1 ${taskFilter} ${filter.sql}`,
      [...taskParams, ...filter.params]
    );

    if (overview && Number(overview.total) > 0) {
      return [{
        dataSource: 'overview_fallback',
        totalCount: Number(overview.total),
        completedCount: Number(overview.completed || 0),
        completionRate: parseFloat((((overview.completed || 0) / overview.total) * 100).toFixed(1)),
        caliberNote: '预警与排行明细不足，已降级为整体完成概览。',
      }];
    }

    const trend = db.all(
      `SELECT DATE(ta.completed_at) AS day, COUNT(*) AS completedCount
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE 1=1 ${taskFilter} ${filter.sql}
         AND ta.status = 'completed'
         AND ta.completed_at IS NOT NULL
       GROUP BY DATE(ta.completed_at)
       ORDER BY day DESC
       LIMIT 7`,
      [...taskParams, ...filter.params]
    );

    return trend.map((r) => ({
      day: r.day,
      completedCount: Number(r.completedCount),
      dataSource: 'trend_fallback',
      caliberNote: '预警、排行与概览数据不足，已降级为近期完成趋势。',
    }));
  }
};
