'use strict';

const taskCrud = require('../modules/task/crud/taskCrud');

module.exports = {
  schema: {
    type: 'function',
    function: {
      name: 'search_task',
      description: '按条件搜索任务元数据。当用户想查找任务但不确定具体名称时使用。返回任务列表而非指标数据。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '模糊搜索任务名称关键字' },
          status: { type: 'string', enum: ['active', 'ended', 'all'], description: '过滤任务状态，默认 all' },
          platform: { type: 'string', enum: ['MyPAL', 'SmartSell', 'AI Demo', 'Live Broadcast'], description: '平台过滤' },
          sort_by: { type: 'string', enum: ['deadline', 'completion_rate', 'priority', 'created_at'], description: '排序字段' },
          page_size: { type: 'integer', description: '每页条数，默认 20' },
          page: { type: 'integer', description: '页码，默认 1' }
        }
      }
    }
  },
  meta: {
    enabled: true,
    requiredRole: ['executive', 'central', 'admin'],
    scopePolicy: 'public',
    timeoutMs: 8000
  },
  handler: async (args, regionScope) => {
    const statuses = args.status === 'ended'
      ? ['ended'] : args.status === 'active'
      ? ['active'] : ['active', 'ended'];

    const pageSize = args.page_size || 20;
    const offset = ((args.page || 1) - 1) * pageSize;
    const tasks = await taskCrud.getTaskList({ statuses, limit: Math.min(pageSize, 100), offset });

    if (!tasks || tasks.length === 0) {
      return { success: true, data: { total_count: 0, rows: [] } };
    }

    let rows = tasks.map(t => ({
      task_id: t.id, task_name: t.name, platform: t.platform || null,
      priority: t.priority || null, status: t.publish_status || t.status,
      start_date: t.start_at || null, deadline: t.ddl_at || t.due_date,
      completion_rate: t.completionRate || 0, learning_count: t.learningCount || 0
    }));

    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      rows = rows.filter(r => String(r.task_name).toLowerCase().includes(kw));
    }

    if (args.platform) {
      rows = rows.filter(r => r.platform === args.platform);
    }

    return { success: true, data: { total_count: rows.length, rows } };
  }
};
