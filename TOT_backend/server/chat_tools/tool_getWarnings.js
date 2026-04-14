'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getWarningsData',
      description: '查询存在风险的门店列表（完成率低或临近截止），即预警数据',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID，不传则扫描所有任务' }
        }
      }
    }
  },
  meta: { 
    enabled: true,
    requiredRole: ['executive'],
    scopePolicy: 'any',
    timeoutMs: 8000
  },
  handler: async (args, regionScope) => {
    const taskId = args.taskId || null;
    const filter = buildRegionFilter(regionScope);
    const taskFilter = taskId ? 'AND ta.task_id = ?' : "AND t.status = 'dispatched'";
    const taskParams = taskId ? [taskId] : [];

    const rows = db.all(
      `SELECT ta.task_id, s.id AS store_id, s.name AS store_name, s.region, t.ddl_at, COUNT(*) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed FROM task_assignments ta JOIN stores s ON s.id = ta.store_id JOIN tasks t ON t.id = ta.task_id WHERE 1=1 ${taskFilter} ${filter.sql} GROUP BY ta.task_id, ta.store_id HAVING CAST(completed AS FLOAT) / total < 0.8 ORDER BY CAST(completed AS FLOAT) / total ASC LIMIT 20`,
      [...taskParams, ...filter.params]
    );

    return rows.map((r) => ({
      taskId: r.task_id,
      storeId: r.store_id,
      storeName: r.store_name,
      region: r.region,
      ddlAt: r.ddl_at,
      totalCount: r.total,
      completedCount: r.completed,
      completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
    }));
  }
};
