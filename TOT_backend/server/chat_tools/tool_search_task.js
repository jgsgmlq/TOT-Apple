'use strict';

const mysqlCrud = require('../modules/dashboard/crud/dashboardMysqlCrud');

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
      ? ['dispatched'] : ['dispatched', 'ended'];

    const limit = Math.min(args.page_size || 20, 100);

    const rows = await mysqlCrud.searchTasks({
      name: args.keyword || null,
      platform: args.platform || null,
      statuses,
      limit,
    });

    return {
      success: true,
      data: {
        total_count: rows.length,
        rows: rows.map(t => ({
          task_id: t.task_publish_id, task_name: t.task_title,
          platform: (() => { try { return JSON.parse(t.platform_scope || '[]')[0] || null; } catch (_) { return null; } })(),
          priority: t.urgency_level || null, status: t.publish_status,
          start_date: t.start_date || null, deadline: t.due_date,
          completion_rate: 0, learning_count: 0
        }))
      }
    };
  }
};
