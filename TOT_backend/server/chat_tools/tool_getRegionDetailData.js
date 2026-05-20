'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getRegionDetailData',
      description: '按区域下钻查询培训进度，包括区域汇总与门店表现排行',
      parameters: {
        type: 'object',
        required: ['region'],
        properties: {
          region: { type: 'string', description: '大区名称，如"华东"' },
          taskId: { type: 'string', description: '任务ID，不传则取已下发任务汇总' },
          topN: { type: 'number', description: '返回门店排行数量，默认 5' }
        }
      }
    }
  },
  meta: { enabled: true, requiredRole: ['executive', 'central', 'admin'], scopePolicy: 'regional_scoped' },
  handler: async (args, regionScope) => {
    const region = (args.region || '').trim();
    const taskId = args.taskId || null;
    const topN = Number.isFinite(args.topN) ? Math.max(1, Math.min(10, Math.floor(args.topN))) : 5;
    if (!region) {
      return {
        needDisambiguation: true,
        reason: 'region_required',
        message: '区域级下钻需要提供 region（例如：华东）。',
        candidates: []
      };
    }

    if (regionScope && regionScope.type === 'regional') {
      const authorized = Array.isArray(regionScope.regions) ? regionScope.regions : [];
      if (!authorized.includes(region)) {
        throw Object.assign(
          new Error(`Region ${region} is outside authorized regions`),
          { status: 403, code: 'AUTH_003' }
        );
      }
    }

    const filter = buildRegionFilter(regionScope);
    const taskFilter = taskId ? 'AND ta.task_id = ?' : "AND t.status = 'dispatched'";
    const baseParams = taskId ? [taskId, region] : [region];
    const scopedParams = [...baseParams, ...filter.params];
    const whereClause = `s.region = ? ${taskFilter} ${filter.sql}`;

    const summary = db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN ta.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN ta.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         AVG(CASE
             WHEN ta.status = 'completed'
              AND ta.completed_at IS NOT NULL
              AND t.created_at IS NOT NULL
             THEN (julianday(ta.completed_at) - julianday(t.created_at)) * 24
         END) AS avg_hours
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ${whereClause}`,
      scopedParams
    );

    const rankRows = db.all(
      `SELECT
         s.id AS store_id,
         s.name AS store_name,
         COUNT(*) AS total,
         SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM task_assignments ta
       JOIN stores s ON s.id = ta.store_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ${whereClause}
       GROUP BY s.id, s.name
       HAVING total > 0`,
      scopedParams
    );

    const totalAssignments = Number(summary?.total || 0);
    const completedAssignments = Number(summary?.completed || 0);
    const completionRate = totalAssignments > 0
      ? parseFloat(((completedAssignments / totalAssignments) * 100).toFixed(1))
      : 0;

    const ranked = rankRows
      .map((r) => {
        const total = Number(r.total || 0);
        const completed = Number(r.completed || 0);
        return {
          storeId: r.store_id,
          storeName: r.store_name,
          totalCount: total,
          completedCount: completed,
          completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => a.completionRate - b.completionRate);

    const laggards = ranked.slice(0, topN);
    const leaders = [...ranked].reverse().slice(0, topN);

    return {
      region,
      taskId,
      summary: {
        totalAssignments,
        completedAssignments,
        inProgressCount: Number(summary?.in_progress || 0),
        pendingCount: Number(summary?.pending || 0),
        completionRate,
        avgCompletionTimeHours: summary?.avg_hours ? parseFloat(Number(summary.avg_hours).toFixed(1)) : null,
      },
      storeLaggards: laggards,
      storeLeaders: leaders,
      dataSource: 'region_drilldown',
    };
  }
};
