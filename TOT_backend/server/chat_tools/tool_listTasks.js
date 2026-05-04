'use strict';

const { db } = require('../db');

/**
 * listTasks — 所有已下发任务列表
 * 原 getTaskListData，改名
 */

const schema = {
  type: 'function',
  function: {
    name: 'listTasks',
    description: '列出所有已下发培训任务及其完成率。',
    parameters: { type: 'object', properties: {} },
  },
};

const meta = {
  enabled: true,
  requiredRole: ['executive', 'central', 'admin'],
  scopePolicy: 'any',
  timeoutMs: 5000,
};

async function handler(_args, _regionScope) {
  const rows = db.all(
    `SELECT t.id, t.title, t.ddl_at, t.status, t.created_at,
            COUNT(ta.id) AS total_assignments,
            SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            ROUND(100.0 * SUM(CASE WHEN ta.status = 'completed' THEN 1 ELSE 0 END) / MAX(1, COUNT(ta.id)), 1) AS completion_rate
     FROM tasks t
     LEFT JOIN task_assignments ta ON ta.task_id = t.id
     WHERE t.status = 'dispatched'
     GROUP BY t.id
     ORDER BY t.created_at DESC`
  );
  return { success: true, data: rows };
}

module.exports = { schema, meta, handler };
