'use strict';

const { db } = require('../db');
const { buildRegionFilter } = require('../utils/chatUtils');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'getTaskListData',
      description: '查询当前所有已下发培训任务的列表、截止时间与完成情况',
      parameters: { type: 'object', properties: {} }
    }
  },
  meta: { enabled: true, scopePolicy: 'regional_scoped' },
  handler: async (args, regionScope) => {
    const filter = buildRegionFilter(regionScope);

    const rows = db.all(
      `SELECT t.id, t.title, t.ddl_at, COUNT(ta.id) AS total, SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed FROM tasks t LEFT JOIN task_assignments ta ON ta.task_id = t.id ${filter.sql ? 'LEFT JOIN stores s ON s.id = ta.store_id' : ''} WHERE t.status = 'dispatched' ${filter.sql} GROUP BY t.id ORDER BY t.ddl_at ASC`,
      filter.params
    );

    return rows.map((r) => ({
      taskId: r.id,
      title: r.title,
      ddlAt: r.ddl_at,
      totalAssignments: r.total || 0,
      completedCount: r.completed || 0,
      completionRate: r.total > 0 ? parseFloat(((r.completed / r.total) * 100).toFixed(1)) : 0,
    }));
  }
};
